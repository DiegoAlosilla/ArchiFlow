import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runtimeRoot = join(repoRoot, '.drawio-runtime');
const webRoot = join(runtimeRoot, 'src', 'main', 'webapp');
const yamlBrowserRoot = join(repoRoot, 'node_modules', 'yaml', 'browser');
const upstreamPlugin = join(webRoot, 'plugins', 'animation.js');
const archiflowPlugin = join(repoRoot, 'integrations', 'drawio', 'archiflow-plugin.js');
const marker = '/* ARCHIFLOW_DRAWIO_PLUGIN */';
const host = '127.0.0.1';
const port = Number(process.env.ARCHIFLOW_DRAWIO_PORT || 4130);

function ensureRuntime() {
  if (!existsSync(join(runtimeRoot, '.git'))) {
    const clone = spawnSync(
      'git',
      ['clone', '--depth', '1', '--branch', 'dev', 'https://github.com/jgraph/drawio.git', runtimeRoot],
      { cwd: repoRoot, stdio: 'inherit' },
    );

    if (clone.status !== 0) {
      throw new Error('No se pudo preparar la copia local de diagrams.net.');
    }
  }

  const original = spawnSync(
    'git',
    ['show', 'HEAD:src/main/webapp/plugins/animation.js'],
    { cwd: runtimeRoot, encoding: 'utf8' },
  );

  if (original.status !== 0) {
    throw new Error('No se pudo recuperar el plugin original de animación.');
  }

  const extension = readFileSync(archiflowPlugin, 'utf8');
  writeFileSync(upstreamPlugin, `${original.stdout.trimEnd()}\n\n${marker}\n${extension}\n`, 'utf8');
}

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml; charset=utf-8',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);

  if (decoded.startsWith('/archiflow-vendor/yaml/')) {
    const relative = decoded.slice('/archiflow-vendor/yaml/'.length);
    const vendorTarget = normalize(join(yamlBrowserRoot, relative));
    return vendorTarget.startsWith(yamlBrowserRoot) ? vendorTarget : null;
  }

  const requested = decoded === '/' ? '/index.html' : decoded;
  const target = normalize(join(webRoot, requested));
  return target.startsWith(webRoot) ? target : null;
}

ensureRuntime();

const server = createServer((request, response) => {
  const target = safePath(request.url || '/');

  if (target == null || !existsSync(target)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('No encontrado');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': mime[extname(target).toLowerCase()] || 'application/octet-stream',
  });
  createReadStream(target).pipe(response);
});

server.listen(port, host, () => {
  const demoUrl = `http://${host}:${port}/?local=1&plugins=1&p=anim&lang=es&splash=0&archiflowDemo=1&ui=kennedy`;
  process.stdout.write(`ArchiFlow sobre diagrams.net listo en ${demoUrl}\n`);
});
