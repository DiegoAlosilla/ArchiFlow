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
  console.error('Uso: node generate-flow-diagrams.mjs <inventario-flujos.json> --out <directorio>');
  process.exit(2);
}

const outputDir = path.resolve(option('--out', 'flows'));
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
fs.mkdirSync(outputDir, { recursive: true });

const slug = (value) => String(value ?? '')
  .toLocaleLowerCase('es')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'item';

const colors = {
  Canal: '#0ea5e9',
  'APIM UX': '#2563eb',
  'MS UX': '#7c3aed',
  'MS UX asíncrono': '#8b5cf6',
  'API BS': '#10b981',
  Cache: '#f59e0b',
  Redis: '#f59e0b',
  Datos: '#ef4444',
  'Por validar': '#64748b',
};

function parseOperation(signature) {
  const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i.exec(signature || '');
  if (!match) return undefined;
  return { id: slug(signature), method: match[1].toUpperCase(), path: match[2] };
}

for (const flow of data.flows) {
  const components = data.flowComponents.filter((component) => component.flowId === flow.flowId);
  const dependencies = data.flowDependencies.filter((dependency) => dependency.flowId === flow.flowId);
  const zoneLabels = [...new Set(components.map((component) => {
    if (component.type === 'cache') return 'Cache';
    if (component.type === 'database') return 'Datos';
    return component.layer || 'Por validar';
  }))];
  const zones = zoneLabels.map((label) => ({ id: slug(label), label, color: colors[label] || '#64748b' }));
  const nodes = components.map((component) => {
    const provides = component.endpoints.map(parseOperation).filter(Boolean);
    const zoneLabel = component.type === 'cache' ? 'Cache' : component.type === 'database' ? 'Datos' : component.layer || 'Por validar';
    return {
      id: component.componentId,
      label: component.component,
      kind: component.type === 'frontend' ? 'frontend'
        : component.type === 'gateway' ? 'gateway'
          : component.type === 'cache' ? 'cache'
            : component.type === 'database' ? 'database'
              : 'service',
      zone: slug(zoneLabel),
      description: `${component.role}. ${component.purpose}`.trim(),
      tags: [component.branch, component.confidence],
      ...(provides.length ? { expanded: true, provides } : {}),
    };
  });
  const steps = dependencies.map((dependency) => ({
    from: dependency.fromComponentId,
    to: dependency.toComponentId,
    op: dependency.toEndpoint || dependency.fromEndpoint || dependency.dependencyType,
    label: dependency.dependencyType === 'cache' ? `Redis ${dependency.toComponent}`
      : dependency.dependencyType === 'base de datos' ? `Datos ${dependency.toComponent}`
        : dependency.toEndpoint && dependency.toEndpoint !== 'PENDIENTE' ? dependency.toEndpoint
          : dependency.dependencyType,
    protocol: ['http', 'https', 'redis', 'file', 'jdbc'].includes(dependency.protocol) ? dependency.protocol : 'http',
    ...(dependency.branch !== 'principal' ? { condition: `rama ${dependency.branch}` } : {}),
    note: `${dependency.confidence}${dependency.evidenceId ? ` · evidencia ${dependency.evidenceId}` : ''}`,
  }));
  const entry = components.find((component) => component.type === 'frontend')?.componentId
    || dependencies[0]?.fromComponentId
    || components[0]?.componentId;
  const diagram = {
    archiflow: 1,
    name: flow.flow,
    description: `Diagrama individual inferido desde ${data.source}. Muestra componentes, endpoints y ramas de servicios, caché y datos del flujo.`,
    view: 'sequence',
    layoutMode: 'auto',
    updated: '2026-08-12',
    animation: { mode: 'paso', speed: 1, packetsPerEdge: 3, trail: 3, direction: 'normal', cycleMs: 3000 },
    zones,
    nodes,
    edges: [],
    flows: [{
      id: flow.flowId,
      label: flow.flow,
      description: `Entrada ${flow.entryEndpoint}; ${flow.componentCount} componentes y ${flow.dependencyCount} dependencias.`,
      level: 'component',
      entry,
      trigger: flow.trigger,
      steps,
    }],
  };
  const yaml = YAML.stringify(diagram, { lineWidth: 120 });
  fs.writeFileSync(path.join(outputDir, flow.diagramFile), yaml, 'utf8');
}

console.log(`${data.flows.length} diagrama(s) en ${outputDir}`);
