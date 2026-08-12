#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith('--'));
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

if (!input) {
  console.error('Uso: node inventory.mjs <diagrama.arch.yaml> [--source MBBK] [--target NHBK] [--out archivo.md]');
  process.exit(2);
}

const source = option('--source', 'por-validar');
const target = option('--target', 'por-validar');
const output = option('--out');
const doc = YAML.parse(fs.readFileSync(input, 'utf8')) ?? {};
const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
const zones = Array.isArray(doc.zones) ? doc.zones : [];
const edges = Array.isArray(doc.edges) ? doc.edges : [];
const flows = Array.isArray(doc.flows) ? doc.flows : [];

const clean = (value) => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const key = (value) => clean(value).toLowerCase().replace(/[«»]/g, '').replace(/\bv\d+\b/g, '').replace(/\s+/g, ' ').trim();
const servicePattern = /\b(api\s*(ux|bs)|ms\s*ux|msux|microservicio|service|servicio)\b/i;
const infraPattern = /cache|redis|firebase|database|base de datos|kafka|mq|broker|storage|datalake/i;
const httpMethodPattern = '(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)';

const parseEndpoint = (label) => {
  let text = clean(label).replace(/[\u200B-\u200D\uFEFF]/g, ' ');
  const stereotype = text.match(new RegExp(`^«${httpMethodPattern}»\\s*`, 'i'));
  const stereotypeMethod = stereotype?.[1]?.toUpperCase();
  if (stereotype) text = text.slice(stereotype[0].length).trim();
  const leading = text.match(new RegExp(`^${httpMethodPattern}\\b\\s*:?[>»\\s-]*`, 'i'));
  const method = leading?.[1]?.toUpperCase() || stereotypeMethod;
  if (leading) text = text.slice(leading[0].length).trim();
  const endpointPath = text.match(/(?:\/|\{|[a-z][\w-]*\/)[^\s<]*/i)?.[0]?.replace(/["'»>]+$/g, '');
  return method && endpointPath ? { method, path: endpointPath } : undefined;
};

const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
const appearances = [...zones, ...nodes].map((item) => ({
  id: item.id,
  label: clean(item.label || item.id),
  kind: item.kind || 'container',
  zone: item.zone,
  provides: Array.isArray(item.provides) ? item.provides : [],
}));

const serviceAppearances = appearances.filter((item) => servicePattern.test(item.label) && !infraPattern.test(item.label));
const serviceMap = new Map();
for (const item of serviceAppearances) {
  const identity = key(item.label);
  const existing = serviceMap.get(identity) || { label: item.label, ids: [] };
  existing.ids.push(item.id);
  serviceMap.set(identity, existing);
}

const endpointMap = new Map();
for (const item of appearances) {
  const parentLabel = clean(zoneById.get(item.zone)?.label);
  const owner = servicePattern.test(parentLabel) ? parentLabel : item.label;
  for (const operation of item.provides) {
    const method = clean(operation?.method || '?').toUpperCase();
    const endpointPath = clean(operation?.path || '?');
    endpointMap.set(`${key(owner)}|${method}|${endpointPath}`, { owner, method, path: endpointPath, evidence: item.id });
  }
  const parsed = parseEndpoint(item.label);
  if (parsed) {
    const { method, path: endpointPath } = parsed;
    endpointMap.set(`${key(owner)}|${method}|${endpointPath}`, { owner, method, path: endpointPath, evidence: item.id });
  }
}

const infra = appearances.filter((item) => infraPattern.test(item.label) || ['cache', 'database', 'broker', 'storage'].includes(item.kind));
const edgeDegree = new Map();
for (const edge of edges) {
  for (const endpoint of [edge.from, edge.to]) edgeDegree.set(endpoint, (edgeDegree.get(endpoint) || 0) + 1);
}

const complexity = [...serviceMap.values()].map((service) => {
  const endpointCount = [...endpointMap.values()].filter((endpoint) => service.ids.includes(endpoint.evidence) || key(endpoint.owner).includes(key(service.label))).length;
  const relations = service.ids.reduce((sum, id) => sum + (edgeDegree.get(id) || 0), 0);
  return { ...service, endpointCount, relations, score: endpointCount * 3 + relations };
}).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

const lines = [];
lines.push(`# Inventario técnico — ${clean(doc.name) || path.basename(input)}`, '');
lines.push('## Ficha', '');
lines.push(`- Fuente: \`${path.resolve(input)}\``);
lines.push(`- Canal origen: **${source}**`);
lines.push(`- Canal objetivo: **${target}**`);
lines.push('- Estado: inventario determinista; propósito, ownership y adaptación requieren interpretación del LLM.', '');
lines.push('## Conteos observados', '');
lines.push(`- ${nodes.length} nodos y ${zones.length} contenedores.`);
lines.push(`- ${edges.length} conectores explícitos.`);
lines.push(`- ${flows.length} flujos declarados.`);
lines.push(`- ${serviceMap.size} servicios únicos candidatos en ${serviceAppearances.length} apariciones visuales.`);
lines.push(`- ${endpointMap.size} operaciones HTTP candidatas.`);
lines.push(`- ${infra.length} elementos candidatos de infraestructura/datos.`);
if (!flows.length) lines.push('- **Advertencia:** la fuente no declara orden ejecutable; todos los flujos animados deberán quedar marcados como inferidos hasta validación.');
lines.push('', '## Servicios candidatos', '', '| Servicio observado | Apariciones | Endpoints candidatos | Decisión NHBK | Confianza |', '|---|---:|---:|---|---|');
for (const service of complexity) lines.push(`| ${service.label.replace(/\|/g, '\\|')} | ${service.ids.length} | ${service.endpointCount} | por-validar | observado |`);
lines.push('', '## Endpoints observados', '', '| Propietario/etiqueta | Método | Path | Descripción funcional | Flujo(s) | Estado | Evidencia |', '|---|---|---|---|---|---|---|');
for (const endpoint of [...endpointMap.values()].sort((a, b) => a.owner.localeCompare(b.owner) || a.path.localeCompare(b.path))) {
  lines.push(`| ${endpoint.owner.replace(/\|/g, '\\|')} | ${endpoint.method} | \`${endpoint.path}\` | por inferir | por asignar | observado | \`${endpoint.evidence}\` |`);
}
lines.push('', '## Infraestructura y datos candidatos', '', '| Elemento | Tipo | Necesidad para NHBK | Evidencia |', '|---|---|---|---|');
for (const item of infra) lines.push(`| ${item.label.replace(/\|/g, '\\|')} | ${item.kind} | por-validar | \`${item.id}\` |`);
lines.push('', '## Ranking preliminar de complejidad', '', '| Posición | Servicio | Endpoints | Relaciones | Puntaje heurístico |', '|---:|---|---:|---:|---:|');
complexity.forEach((service, index) => lines.push(`| ${index + 1} | ${service.label.replace(/\|/g, '\\|')} | ${service.endpointCount} | ${service.relations} | ${service.score} |`));
lines.push('', '> Puntaje base = 3 × endpoints + relaciones visuales. Debe enriquecerse con asincronía, persistencia, seguridad, documentos y ambigüedad antes de estimar esfuerzo.', '');
lines.push('## Pendientes obligatorios del LLM', '', '- Deduplicar identidad semántica y asignar ownership.', '- Segregar flujos de negocio y técnicos con el mismo `flow_id`.', '- Clasificar construir, adaptar, reutilizar o por-validar.', '- Proponer descripciones funcionales sin ocultar que son inferidas.', '- Comparar la propuesta NHBK con los contratos Swagger/OpenAPI.', '');

const markdown = `${lines.join('\n')}\n`;
if (output) fs.writeFileSync(output, markdown, 'utf8');
else process.stdout.write(markdown);
