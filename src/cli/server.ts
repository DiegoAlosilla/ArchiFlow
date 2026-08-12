import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import sirv from 'sirv';
import pc from 'picocolors';
import { WebSocketServer, type WebSocket } from 'ws';
import { applyMutations } from '../edit/mutations.js';
import { importDiagram, toDraft } from '../import/index.js';
import { parseDiagram } from '../schema/parse.js';
import type { DiagramsPayload, ImportRequest, ImportResponse, MutateRequest, MutateResponse, ServerMessage } from '../shared/index.js';
import { isDiagramFile, loadAllDiagrams, revisionOf } from './loader.js';

/**
 * Servidor local de ArchiFlow.
 *
 * El bucle que queremos: un agente escribe el `.arch.yaml` y el navegador se
 * actualiza solo, sin recargar ni perder el flujo seleccionado. Por eso el
 * servidor reenvía el conjunto completo de diagramas en cada cambio (son
 * ficheros de kilobytes; optimizar el diff no compensa la complejidad).
 */

/** Los editores escriben en varios pasos; se espera a que amaine. */
const DEBOUNCE_MS = 120;

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export interface ServeOptions {
  root: string;
  port: number;
  open: boolean;
}

export async function serve({ root, port, open }: ServeOptions): Promise<void> {
  type History = { stack: string[]; index: number };
  const histories = new Map<string, History>();
  // Toda escritura comparte una única cola. Un Ctrl+Z que llegue mientras se
  // está guardando un arrastre no puede restaurar una instantánea a mitad de
  // la mutación ni competir con el watcher del fichero.
  let editQueue: Promise<void> = Promise.resolve();
  const serializeEdit = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = editQueue.then(operation, operation);
    editQueue = next.then(() => undefined, () => undefined);
    return next;
  };
  const historyState = (): DiagramsPayload['history'] =>
    Object.fromEntries([...histories].map(([id, history]) => [id, { canUndo: history.index > 0, canRedo: history.index < history.stack.length - 1 }]));
  let payload: DiagramsPayload = { root, diagrams: [], history: {}, updatedAt: Date.now() };

  /**
   * Recarga y difunde. `force` sirve para el arranque; en el resto de casos se
   * omite la difusión si ningún fichero cambió de revisión.
   *
   * La deduplicación importa: el editor gráfico escribe en disco, el vigilante
   * lo detecta y volvería a difundir el mismo contenido, provocando un
   * recálculo de layout y un salto visual justo mientras se arrastra un nodo.
   */
  const reload = async (force = false): Promise<void> => {
    const diagrams = await loadAllDiagrams(root);

    const unchanged =
      !force &&
      diagrams.length === payload.diagrams.length &&
      diagrams.every((entry, i) => payload.diagrams[i]?.revision === entry.revision);

    payload = { root, diagrams, history: historyState(), updatedAt: Date.now() };
    if (unchanged) return;

    const errors = diagrams.filter((entry) => !entry.ok);
    const stamp = pc.dim(new Date().toLocaleTimeString());
    if (errors.length === 0) {
      console.log(`${stamp} ${pc.green('✓')} ${diagrams.length} diagrama(s) cargados`);
    } else {
      console.log(
        `${stamp} ${pc.yellow('!')} ${diagrams.length} diagrama(s), ${pc.red(`${errors.length} con errores`)}`,
      );
      for (const entry of errors) {
        for (const issue of entry.issues.filter((candidate) => candidate.level === 'error')) {
          const where = issue.line !== undefined ? `:${issue.line}` : '';
          console.log(`    ${pc.red('×')} ${pc.dim(entry.file + where)} ${issue.message}`);
        }
      }
    }
    broadcast();
  };

  const clients = new Set<WebSocket>();
  const broadcast = () => {
    const message: ServerMessage = { type: 'diagrams', payload };
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(data);
    }
  };

  const webDir = path.join(packageRoot(), 'dist', 'web');
  const hasWebBuild = existsSync(path.join(webDir, 'index.html'));
  // `dev: true` hace que sirv resuelva cada fichero en el momento en vez de
  // cachear el listado al arrancar. Sin esto, reconstruir la web mientras el
  // servidor está levantado devuelve 404 en el bundle nuevo.
  const serveStatic = hasWebBuild ? sirv(webDir, { single: true, dev: true }) : null;

  /**
   * Aplica mutaciones venidas del editor gráfico.
   *
   * Tres cosas que este flujo no puede saltarse: comprobar la revisión (para
   * no pisar una edición hecha a mano en el editor de texto), validar el
   * resultado ANTES de escribir (nunca dejar en disco un diagrama inválido), y
   * escribir a través del motor de mutaciones sobre el AST (para conservar
   * comentarios y formato).
   */
  const mutate = async (request: MutateRequest): Promise<MutateResponse> => {
    const entry = payload.diagrams.find((candidate) => candidate.id === request.id);
    if (!entry) return { ok: false, reason: 'not-found', error: `no existe el diagrama '${request.id}'` };

    const file = path.join(root, entry.file);
    const current = await readFile(file, 'utf8').catch(() => null);
    if (current === null) {
      return { ok: false, reason: 'not-found', error: `no se pudo leer ${entry.file}` };
    }

    const currentRevision = revisionOf(current);
    if (currentRevision !== request.baseRevision) {
      return {
        ok: false,
        reason: 'stale',
        error: 'el fichero cambió por fuera desde que se cargó; recarga antes de volver a editar',
      };
    }

    const result = applyMutations(current, request.mutations);
    if (!result.ok || result.source === undefined) {
      return { ok: false, reason: 'failed', error: result.error };
    }

    const validated = parseDiagram(result.source);
    if (!validated.ok) {
      return {
        ok: false,
        reason: 'invalid',
        error: 'la edición habría dejado el diagrama inválido, no se ha escrito nada',
        issues: validated.issues.filter((issue) => issue.level === 'error'),
      };
    }

    const history = histories.get(entry.id);
    if (!history || history.stack[history.index] !== current) {
      histories.set(entry.id, { stack: [current, result.source], index: 1 });
    } else {
      history.stack.splice(history.index + 1);
      history.stack.push(result.source);
      if (history.stack.length > 50) history.stack.shift();
      history.index = history.stack.length - 1;
    }
    await writeFile(file, result.source, 'utf8');
    await reload();

    return { ok: true, revision: revisionOf(result.source) };
  };

  const restoreHistory = async (id: string, direction: -1 | 1): Promise<MutateResponse> => {
    const entry = payload.diagrams.find((candidate) => candidate.id === id);
    const history = histories.get(id);
    if (!entry || !history) return { ok: false, reason: 'not-found', error: 'no hay historial para este diagrama' };
    const next = history.index + direction;
    if (next < 0 || next >= history.stack.length) return { ok: false, reason: 'failed', error: 'no hay más cambios en el historial' };
    const source = history.stack[next]!;
    if (!parseDiagram(source).ok) return { ok: false, reason: 'invalid', error: 'la instantánea del historial no es válida' };
    await writeFile(path.join(root, entry.file), source, 'utf8');
    history.index = next;
    await reload();
    return { ok: true, revision: revisionOf(source) };
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        // Un diagrama no ocupa megas; cortar aquí evita agotar memoria.
        if (body.length > 2_000_000) reject(new Error('cuerpo demasiado grande'));
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/api/diagrams') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.url === '/api/mutate' && req.method === 'POST') {
      void (async () => {
        const json = (value: MutateResponse, status: number) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(value));
        };
        try {
          const request = JSON.parse(await readBody(req)) as MutateRequest;
          const result = await serializeEdit(() => mutate(request));
          json(result, result.ok ? 200 : result.reason === 'stale' ? 409 : 422);
        } catch (error) {
          json({ ok: false, reason: 'failed', error: (error as Error).message }, 400);
        }
      })();
      return;
    }

    if (req.url === '/api/import' && req.method === 'POST') {
      void (async () => {
        const json = (value: ImportResponse, status: number) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(value));
        };
        try {
          const request = JSON.parse(await readBody(req)) as ImportRequest;
          if (!request.name || !request.source) throw new Error('falta el nombre o el contenido del diagrama');
          const evidence = importDiagram(request.source);
          const draft = toDraft(evidence, { name: path.basename(request.name).replace(/\.(?:drawio|xml)$/i, '') });
          const parsed = parseDiagram(draft.yaml);
          if (!parsed.ok) {
            json({ ok: false, error: 'la importación produjo un borrador inválido' }, 422);
            return;
          }

          const stem = path
            .basename(request.name)
            .replace(/\.(?:drawio|xml)$/i, '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'diagrama-importado';
          let file = `${stem}.arch.yaml`;
          let suffix = 2;
          while (existsSync(path.join(root, file))) file = `${stem}-${suffix++}.arch.yaml`;
          await writeFile(path.join(root, file), draft.yaml, 'utf8');
          await reload(true);
          json({
            ok: true,
            file,
            warnings: draft.warnings,
            summary: {
              pages: evidence.pages.length,
              shapes: evidence.shapes.length,
              containers: evidence.shapes.filter((shape) => shape.container).length,
              links: evidence.links.length,
            },
          }, 200);
        } catch (error) {
          json({ ok: false, error: (error as Error).message }, 400);
        }
      })();
      return;
    }

    if ((req.url === '/api/undo' || req.url === '/api/redo') && req.method === 'POST') {
      void (async () => {
        try {
          const { id } = JSON.parse(await readBody(req)) as { id?: string };
          if (!id) throw new Error('falta id');
          const result = await serializeEdit(() => restoreHistory(id, req.url === '/api/undo' ? -1 : 1));
          res.writeHead(result.ok ? 200 : 422, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, reason: 'failed', error: (error as Error).message }));
        }
      })();
      return;
    }

    if (serveStatic) {
      serveStatic(req, res, () => {
        res.writeHead(404).end('No encontrado');
      });
      return;
    }

    // Sin build de la web, el CLI sigue sirviendo la API: es el modo en el que
    // Vite (puerto 4124) hace de front y este proceso solo aporta los datos.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><meta charset="utf-8"><title>ArchiFlow</title>' +
        '<body style="font-family:system-ui;background:#060910;color:#e2e8f0;padding:40px;line-height:1.6">' +
        '<h1>Falta el build de la web</h1>' +
        '<p>Ejecuta <code>npm run build:web</code>, o arranca <code>npm run dev</code> ' +
        'y abre <a style="color:#818cf8" href="http://localhost:4124">http://localhost:4124</a>.</p>' +
        '<p style="color:#7c8aa5">La API ya está sirviendo en <code>/api/diagrams</code>.</p>',
    );
  };

  const server = createServer(handler);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: 'diagrams', payload } satisfies ServerMessage));
    socket.on('close', () => clients.delete(socket));
  });

  await reload(true);

  let debounce: NodeJS.Timeout | null = null;
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (target) => /(^|[\\/])(node_modules|\.git|dist|target)([\\/]|$)/.test(target),
  });

  const onChange = (file: string) => {
    if (!isDiagramFile(file)) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      void reload();
    }, DEBOUNCE_MS);
  };

  watcher.on('add', onChange).on('change', onChange).on('unlink', onChange);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });

  const url = `http://localhost:${port}`;
  console.log();
  console.log(`  ${pc.bold(pc.magenta('ArchiFlow'))} ${pc.dim('· diagramas de arquitectura animados')}`);
  console.log();
  console.log(`  ${pc.dim('Web')}       ${hasWebBuild ? pc.cyan(url) : pc.yellow('sin build — ejecuta npm run build:web')}`);
  console.log(`  ${pc.dim('API')}       ${pc.cyan(`${url}/api/diagrams`)}`);
  console.log(`  ${pc.dim('Vigilando')} ${pc.cyan(root)}`);
  console.log();

  if (open && hasWebBuild) {
    const command =
      process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const { exec } = await import('node:child_process');
    exec(`${command} ${url}`);
  }

  const shutdown = () => {
    void watcher.close();
    wss.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
