import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { compile } from '../schema/compile.js';
import { parseDiagram } from '../schema/parse.js';
import type { DiagramEntry } from '../shared/index.js';

/** Extensiones que se consideran diagramas de ArchiFlow. */
const DIAGRAM_PATTERN = /\.arch\.(ya?ml)$/i;

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.idea', '.vscode']);

export function isDiagramFile(file: string): boolean {
  return DIAGRAM_PATTERN.test(file);
}

/** Slug estable a partir de la ruta relativa, para que la selección de la UI sobreviva a las recargas. */
export function diagramIdFor(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(DIAGRAM_PATTERN, '').replace(/[^a-zA-Z0-9/_-]/g, '-');
}

export async function findDiagramFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // un directorio ilegible no debe tumbar el servidor
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(full);
      } else if (entry.isFile() && isDiagramFile(entry.name)) {
        found.push(full);
      }
    }
  };

  await walk(root);
  return found.sort();
}

/** Huella del contenido, para detectar ediciones concurrentes. */
export function revisionOf(source: string): string {
  return createHash('sha1').update(source, 'utf8').digest('hex').slice(0, 12);
}

export async function loadDiagram(root: string, file: string): Promise<DiagramEntry> {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  const id = diagramIdFor(relative);

  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    return {
      id,
      file: relative,
      name: relative,
      revision: '',
      ok: false,
      issues: [{ level: 'error', message: `no se pudo leer el fichero: ${(error as Error).message}` }],
    };
  }

  const result = parseDiagram(source);

  // Un diagrama con avisos sigue siendo utilizable; solo los errores impiden
  // compilarlo. Que un nodo esté suelto no debe dejar la pantalla en blanco.
  return {
    id,
    file: relative,
    name: result.diagram?.name ?? relative,
    revision: revisionOf(source),
    ok: result.ok,
    issues: result.issues,
    ir: result.ok && result.diagram ? compile(result.diagram) : undefined,
  };
}

export async function loadAllDiagrams(root: string): Promise<DiagramEntry[]> {
  const files = await findDiagramFiles(root);
  return Promise.all(files.map((file) => loadDiagram(root, file)));
}
