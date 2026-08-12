#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith('--'));
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

if (!input) {
  console.error('Uso: node flow-inventory.mjs <inventario.json> --evidence <evidencias.json> [--out inventario-flujos.json]');
  process.exit(2);
}

const evidencePath = option('--evidence');
const output = option('--out');
const inventory = JSON.parse(fs.readFileSync(input, 'utf8'));
const evidence = evidencePath ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : { shapes: [], links: [] };

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const slug = (value) => clean(value)
  .toLocaleLowerCase('es')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'componente';
const unique = (values) => [...new Set(values.filter(Boolean))];

const serviceByName = new Map(inventory.services.map((service) => [service.service, service]));
const frontend = evidence.shapes?.find((shape) => shape.kind === 'frontend' && /miniapp|lending/i.test(shape.label))
  ?? evidence.shapes?.find((shape) => shape.kind === 'frontend');
const gateway = evidence.shapes?.find((shape) => shape.kind === 'gateway' && /apim/i.test(shape.label))
  ?? evidence.shapes?.find((shape) => shape.kind === 'gateway');
const frontendName = clean(frontend?.label) || 'Canal de entrada';
const gatewayName = clean(gateway?.label) || 'APIM UX';

function componentType(layer, name) {
  if (name === frontendName) return 'frontend';
  if (name === gatewayName) return 'gateway';
  if (layer === 'Redis') return 'cache';
  if (layer === 'Datos') return 'database';
  return 'service';
}

function componentZone(type, layer) {
  if (type === 'frontend') return 'Canal';
  if (type === 'gateway' || layer === 'APIM UX') return 'APIM UX';
  if (type === 'cache') return 'Cache';
  if (type === 'database') return 'Datos';
  return layer || 'Servicios';
}

function endpointSignature(endpoint) {
  return `${endpoint.method} ${endpoint.route}`;
}

const flowNames = unique(inventory.inventory.map((endpoint) => endpoint.flow)).sort((a, b) => a.localeCompare(b, 'es'));
const flows = [];
const flowComponents = [];
const flowDependencies = [];

for (const flowName of flowNames) {
  const flowId = slug(flowName);
  const endpoints = inventory.inventory.filter((endpoint) => endpoint.flow === flowName);
  const endpointSignatures = new Set(endpoints.map(endpointSignature));
  const components = new Map();
  const dependencies = [];

  const addComponent = ({ name, layer, type, purpose, endpoint = '', resource = '', evidenceIds = [], confidence = 'inferido' }) => {
    const id = slug(name);
    const current = components.get(id) || {
      flowId,
      flow: flowName,
      componentId: id,
      component: name,
      type: type || componentType(layer, name),
      layer: layer || componentZone(type, layer),
      role: '',
      endpoints: [],
      resources: [],
      purpose: purpose || '',
      evidenceIds: [],
      confidence,
      order: 99,
      branch: 'principal',
    };
    if (endpoint) current.endpoints.push(endpoint);
    if (resource) current.resources.push(resource);
    current.evidenceIds.push(...evidenceIds);
    current.endpoints = unique(current.endpoints);
    current.resources = unique(current.resources);
    current.evidenceIds = unique(current.evidenceIds);
    components.set(id, current);
    return current;
  };

  const addDependency = ({ from, fromEndpoint = '', to, toEndpoint = '', type = 'servicio', protocol = 'http', branch = 'principal', evidenceId = '', confidence = 'inferido' }) => {
    const relation = {
      flowId,
      flow: flowName,
      dependencyId: `${flowId}-${dependencies.length + 1}`,
      fromComponentId: slug(from),
      fromComponent: from,
      fromEndpoint,
      toComponentId: slug(to),
      toComponent: to,
      toEndpoint,
      dependencyType: type,
      protocol,
      branch,
      evidenceId,
      confidence,
    };
    const key = `${relation.fromComponentId}|${fromEndpoint}|${relation.toComponentId}|${toEndpoint}|${type}`;
    if (!dependencies.some((item) => item._key === key)) dependencies.push({ ...relation, _key: key });
  };

  const apiUxEndpoints = endpoints.filter((endpoint) => endpoint.layer === 'APIM UX');
  addComponent({ name: frontendName, layer: 'Canal', type: 'frontend', purpose: 'Dispara el flujo desde la experiencia móvil.', evidenceIds: frontend ? [frontend.id] : [] });
  addComponent({ name: gatewayName, layer: 'APIM UX', type: 'gateway', purpose: 'Punto de entrada y enrutamiento de las APIs UX.', evidenceIds: gateway ? [gateway.id] : [] });
  const preferredEntry = apiUxEndpoints[0]
    || endpoints.find((endpoint) => endpoint.layer === 'MS UX')
    || endpoints.find((endpoint) => endpoint.layer === 'API BS')
    || endpoints[0];
  const firstEntry = preferredEntry ? endpointSignature(preferredEntry) : 'Por validar';
  addDependency({ from: frontendName, to: gatewayName, toEndpoint: firstEntry, type: 'entrada', protocol: 'https', confidence: 'inferido' });

  for (const endpoint of endpoints) {
    const service = serviceByName.get(endpoint.service);
    addComponent({
      name: endpoint.service,
      layer: endpoint.layer,
      type: 'service',
      purpose: endpoint.servicePurpose,
      endpoint: endpointSignature(endpoint),
      evidenceIds: endpoint.evidenceIds,
      confidence: endpoint.confidence,
    });
    if (endpoint.layer === 'APIM UX' && gatewayName) {
      addDependency({
        from: gatewayName,
        fromEndpoint: endpointSignature(endpoint),
        to: endpoint.service,
        toEndpoint: endpointSignature(endpoint),
        type: 'entrada',
        protocol: 'http',
        confidence: 'inferido',
      });
    }

    const signature = endpointSignature(endpoint);
    const endpointDependencies = inventory.dependencies.filter((dependency) =>
      dependency.consumerService === endpoint.service && dependency.consumerEndpoint === signature);
    for (const dependency of endpointDependencies) {
      const provider = serviceByName.get(dependency.providerService);
      addComponent({
        name: dependency.providerService,
        layer: provider?.layer || 'Por validar',
        type: 'service',
        purpose: provider?.purpose || 'Dependencia del flujo por validar.',
        endpoint: dependency.providerEndpoint !== 'PENDIENTE' ? dependency.providerEndpoint : '',
        evidenceIds: provider?.evidenceIds || [],
        confidence: dependency.confidence,
      });
      addDependency({
        from: endpoint.service,
        fromEndpoint: signature,
        to: dependency.providerService,
        toEndpoint: dependency.providerEndpoint,
        type: 'servicio',
        protocol: dependency.protocol || 'http',
        branch: 'servicios',
        evidenceId: dependency.evidenceId,
        confidence: dependency.confidence,
      });
    }

    for (const map of endpoint.maps || []) {
      addComponent({ name: map, layer: 'Redis', type: 'cache', purpose: 'Mapa Redis consumido por el flujo.', resource: map, confidence: 'observado' });
      addDependency({
        from: endpoint.service,
        fromEndpoint: signature,
        to: map,
        toEndpoint: map,
        type: 'cache',
        protocol: 'redis',
        branch: 'cache',
        confidence: 'observado',
      });
    }

    if (endpoint.database?.startsWith('Sí — ')) {
      for (const database of endpoint.database.slice(5).split('; ').filter(Boolean)) {
        addComponent({ name: database, layer: 'Datos', type: 'database', purpose: 'Almacén de datos utilizado por el flujo.', resource: database, confidence: 'observado' });
        addDependency({
          from: endpoint.service,
          fromEndpoint: signature,
          to: database,
          toEndpoint: database,
          type: 'base de datos',
          protocol: /datalake/i.test(database) ? 'file' : 'jdbc',
          branch: 'datos',
          confidence: 'observado',
        });
      }
    }
  }

  if (!apiUxEndpoints.length && preferredEntry) {
    addDependency({
      from: gatewayName,
      fromEndpoint: firstEntry,
      to: preferredEntry.service,
      toEndpoint: firstEntry,
      type: 'entrada',
      protocol: 'http',
      confidence: 'por-validar',
    });
  }

  const connectedIds = new Set(dependencies.flatMap((dependency) => [dependency.fromComponentId, dependency.toComponentId]));
  for (const [id, component] of components) {
    if (component.type === 'service' && !connectedIds.has(id)) components.delete(id);
  }

  const outgoing = new Map();
  const incoming = new Map();
  for (const dependency of dependencies) {
    if (!outgoing.has(dependency.fromComponentId)) outgoing.set(dependency.fromComponentId, []);
    outgoing.get(dependency.fromComponentId).push(dependency);
    if (!incoming.has(dependency.toComponentId)) incoming.set(dependency.toComponentId, []);
    incoming.get(dependency.toComponentId).push(dependency);
  }
  const entryId = components.has(slug(frontendName)) ? slug(frontendName)
    : [...components.keys()].find((id) => !incoming.has(id)) || [...components.keys()][0];
  const queue = entryId ? [{ id: entryId, distance: 1 }] : [];
  const distances = new Map();
  while (queue.length) {
    const item = queue.shift();
    if (distances.has(item.id) && distances.get(item.id) <= item.distance) continue;
    distances.set(item.id, item.distance);
    for (const edge of outgoing.get(item.id) || []) queue.push({ id: edge.toComponentId, distance: item.distance + 1 });
  }

  for (const component of components.values()) {
    component.order = distances.get(component.componentId) || 99;
    component.branch = component.type === 'cache' ? 'cache' : component.type === 'database' ? 'datos' : component.order >= 5 ? 'servicios' : 'principal';
    const outCount = outgoing.get(component.componentId)?.length || 0;
    if (component.type === 'frontend') component.role = 'Disparador';
    else if (component.type === 'gateway') component.role = 'Gateway';
    else if (component.type === 'cache') component.role = 'Mapa Redis';
    else if (component.type === 'database') component.role = 'Persistencia';
    else if (outCount > 1) component.role = 'Orquestador';
    else if (component.layer === 'APIM UX') component.role = 'Fachada API UX';
    else component.role = 'Dependencia de servicio';
    component.hasCache = (outgoing.get(component.componentId) || []).some((edge) => edge.dependencyType === 'cache') ? 'Sí' : 'No';
    component.hasDatabase = (outgoing.get(component.componentId) || []).some((edge) => edge.dependencyType === 'base de datos') ? 'Sí' : 'No';
  }

  const cleanDependencies = dependencies.map(({ _key, ...dependency }) => dependency)
    .sort((a, b) => (distances.get(a.fromComponentId) || 99) - (distances.get(b.fromComponentId) || 99) || a.branch.localeCompare(b.branch, 'es'));
  const cleanComponents = [...components.values()]
    .sort((a, b) => a.order - b.order || a.branch.localeCompare(b.branch, 'es') || a.component.localeCompare(b.component, 'es'));
  const maps = cleanComponents.filter((component) => component.type === 'cache').flatMap((component) => component.resources);
  const databases = cleanComponents.filter((component) => component.type === 'database').map((component) => component.component);
  const primaryEntry = firstEntry;
  const diagramFile = `${flowId}.arch.yaml`;

  flows.push({
    flowId,
    flow: flowName,
    trigger: flowName,
    entryEndpoint: primaryEntry,
    componentCount: cleanComponents.length,
    dependencyCount: cleanDependencies.length,
    endpointCount: unique(cleanComponents.flatMap((component) => component.endpoints)).length,
    serviceCount: cleanComponents.filter((component) => component.type === 'service').length,
    hasCache: maps.length ? 'Sí' : 'No',
    maps: unique(maps),
    hasDatabase: databases.length ? 'Sí' : 'No',
    databases: unique(databases),
    diagramFile,
    confidence: 'inferido',
    reviewStatus: 'Por validar con OpenAPI/código',
  });
  flowComponents.push(...cleanComponents);
  flowDependencies.push(...cleanDependencies);
}

const result = {
  ...inventory,
  counts: {
    ...inventory.counts,
    flows: flows.length,
    flowComponents: flowComponents.length,
    flowDependencies: flowDependencies.length,
    flowsWithCache: flows.filter((flow) => flow.hasCache === 'Sí').length,
    flowsWithDatabase: flows.filter((flow) => flow.hasDatabase === 'Sí').length,
  },
  flows,
  flowComponents,
  flowDependencies,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (output) fs.writeFileSync(output, json, 'utf8');
else process.stdout.write(json);
