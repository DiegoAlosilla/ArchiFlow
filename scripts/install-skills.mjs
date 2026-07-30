#!/usr/bin/env node
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Instala las skills de ArchiFlow en `~/.claude/skills/`, que es donde Claude
 * Code las descubre para poder invocarlas como `/archiflow-design`.
 *
 * El repositorio sigue siendo la fuente de verdad: esto copia, no enlaza. En
 * Windows los enlaces simbólicos exigen permisos de administrador o el modo
 * desarrollador, así que copiar es lo que funciona sin fricción. A cambio, hay
 * que volver a ejecutarlo tras editar una skill.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '..', 'skills');
const target = path.join(homedir(), '.claude', 'skills');

const entries = await readdir(source, { withFileTypes: true });
const skills = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

if (skills.length === 0) {
  console.error(`No se encontró ninguna skill en ${source}`);
  process.exit(1);
}

await mkdir(target, { recursive: true });

for (const skill of skills) {
  const destination = path.join(target, skill);
  // `cp` con recursive no borra ficheros que ya no existan en el origen.
  if (existsSync(destination)) await rm(destination, { recursive: true, force: true });
  await cp(path.join(source, skill), destination, { recursive: true });
  console.log(`  ✓ /${skill}`);
}

console.log(`\n${skills.length} skill(s) instaladas en ${target}`);
console.log('Reinicia Claude Code para que aparezcan en la lista de comandos.');
