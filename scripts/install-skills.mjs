#!/usr/bin/env node
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Instala las skills de ArchiFlow en Claude Code y Codex. El repositorio queda
 * como única fuente de verdad y ambos agentes reciben la misma versión.
 *
 * El repositorio sigue siendo la fuente de verdad: esto copia, no enlaza. En
 * Windows los enlaces simbólicos exigen permisos de administrador o el modo
 * desarrollador, así que copiar es lo que funciona sin fricción. A cambio, hay
 * que volver a ejecutarlo tras editar una skill.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '..', 'skills');
const targets = [
  { label: 'Claude Code', path: path.join(homedir(), '.claude', 'skills') },
  { label: 'Codex', path: path.join(homedir(), '.codex', 'skills') },
];

const entries = await readdir(source, { withFileTypes: true });
const skills = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

if (skills.length === 0) {
  console.error(`No se encontró ninguna skill en ${source}`);
  process.exit(1);
}

for (const target of targets) {
  await mkdir(target.path, { recursive: true });
  console.log(`\n${target.label} · ${target.path}`);
  for (const skill of skills) {
    const destination = path.join(target.path, skill);
    // `cp` con recursive no borra ficheros que ya no existan en el origen.
    if (existsSync(destination)) await rm(destination, { recursive: true, force: true });
    await cp(path.join(source, skill), destination, { recursive: true });
    console.log(`  ✓ /${skill}`);
  }
}

console.log(`\n${skills.length} skill(s) instaladas en ${targets.length} agentes.`);
console.log('Reinicia Claude Code o Codex para cargar la versión nueva.');
