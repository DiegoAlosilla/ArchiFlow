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
  console.error('Uso: node xml-inventory.mjs <evidencias.json> [--source diagrama.xml] [--out inventario.json]');
  process.exit(2);
}

const output = option('--out');
const source = option('--source', path.basename(input));
const evidence = JSON.parse(fs.readFileSync(input, 'utf8'));
const shapes = Array.isArray(evidence.shapes) ? evidence.shapes : [];
const links = Array.isArray(evidence.links) ? evidence.links : [];

const clean = (value) => String(value ?? '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const key = (value) => clean(value).toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const area = (shape) => Number(shape.width || 0) * Number(shape.height || 0);
const center = (shape) => ({ x: Number(shape.x || 0) + Number(shape.width || 0) / 2, y: Number(shape.y || 0) + Number(shape.height || 0) / 2 });
const contains = (box, point, tolerance = 2) =>
  point.x >= Number(box.x || 0) - tolerance && point.x <= Number(box.x || 0) + Number(box.width || 0) + tolerance &&
  point.y >= Number(box.y || 0) - tolerance && point.y <= Number(box.y || 0) + Number(box.height || 0) + tolerance;

const SERVICE_PATTERN = /«\s*(API\s+UX|API\s+BS|MS\s*UX|MSUX)\s*»/i;
const HTTP_PATTERN = '(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)';
const CACHE_PATTERN = /cache|redis/i;
const DATA_PATTERN = /database|base de datos|firestore|datalake|data lake|oracle|postgres|mysql|sql server|db2|mongo|cosmos/i;

function serviceName(label) {
  return clean(label).replace(/^«\s*(?:API\s+UX|API\s+BS|MS\s*UX|MSUX)\s*»\s*/i, '').trim();
}

function layerOf(label) {
  if (/«\s*API\s+UX\s*»/i.test(label)) return 'APIM UX';
  if (/«\s*API\s+BS\s*»/i.test(label)) return 'API BS';
  if (/«\s*(?:MS\s*UX|MSUX)\s*»/i.test(label)) return /\basync\b/i.test(label) ? 'MS UX asíncrono' : 'MS UX';
  return 'Por validar';
}

function parseEndpoint(label) {
  let text = clean(label);
  const stereotype = text.match(new RegExp(`^«\\s*${HTTP_PATTERN}\\s*»\\s*`, 'i'));
  const stereotypeMethod = stereotype?.[1]?.toUpperCase();
  if (stereotype) text = text.slice(stereotype[0].length).trim();
  const leading = text.match(new RegExp(`^${HTTP_PATTERN}\\b\\s*`, 'i'));
  const method = leading?.[1]?.toUpperCase() || stereotypeMethod;
  if (leading) text = text.slice(leading[0].length).trim();
  text = text.replace(/^[:>»\s-]+/, '').trim();
  if (!method || !text || (!text.includes('/') && !/^[a-z][\w-]*(?:\?|$)/i.test(text))) return undefined;
  return { method, route: text };
}

function purposeFor(name, layer) {
  const value = key(name);
  if (value.includes('product directory consumer loan')) return layer === 'MS UX'
    ? 'Entrega reglas, características y motivos del préstamo personal al canal móvil.'
    : 'Expone reglas, características y motivos configurados del préstamo personal.';
  if (value.includes('customer offer loan visualization')) return 'Consulta, valida y presenta ofertas de crédito y cuentas elegibles.';
  if (value.includes('customer offer loan orders')) return 'Registra solicitudes de crédito y coordina sus validaciones iniciales.';
  if (value.includes('customer offer loan simulation')) return 'Orquesta la simulación y cotización del préstamo personal.';
  if (value.includes('customer offer loan evaluation')) return 'Consulta y coordina la evaluación de riesgo de la oferta.';
  if (value.includes('customer offer loan confirmation')) return 'Coordina la confirmación, documentos y consentimiento del crédito.';
  if (value.includes('customer offer loan execution')) return 'Ejecuta el desembolso y consulta el resultado del crédito.';
  if (value.includes('customer offer consumer loan')) return layer === 'APIM UX'
    ? 'Fachada UX del ciclo de ofertas y contratación de crédito personal.'
    : 'Expone las capacidades de negocio para gestionar ofertas de crédito personal.';
  if (value.includes('customer agreement')) return 'Valida y registra acuerdos o consentimientos del cliente.';
  if (value.includes('customer lead')) return 'Consulta prospectos y ofertas comerciales asociadas al cliente.';
  if (value.includes('document directory')) return 'Recupera documentos y contratos asociados al crédito.';
  if (value.includes('customer product and service')) return 'Consulta productos, cuentas y servicios asociados al cliente.';
  if (value.includes('consumer loan information profile')) return 'Recupera perfiles de información requeridos por el préstamo personal.';
  if (value.includes('loans v3')) return 'Consulta información de préstamos vigentes del cliente.';
  if (value.includes('cache manager session')) return 'Administra datos temporales de sesión compartidos por el canal.';
  if (value.includes('cache manager product')) return 'Administra datos temporales de producto compartidos por el canal.';
  if (value.includes('firebase notifier')) return 'Publica actualizaciones asíncronas del crédito hacia Firebase.';
  return layer === 'API BS'
    ? 'Expone una capacidad de negocio reutilizable para el flujo de crédito.'
    : layer.startsWith('MS UX')
      ? 'Orquesta una parte del flujo de crédito para el canal móvil.'
      : 'Expone operaciones del flujo de crédito personal al canal móvil.';
}

const FLOW_DESCRIPTIONS = new Map([
  ['obtener reglas y caracteristicas del producto', 'Obtiene las reglas y características aplicables al producto.'],
  ['visualizar oferta', 'Obtiene la información necesaria para presentar la oferta al cliente.'],
  ['validar oferta', 'Valida la vigencia y elegibilidad de la oferta del cliente.'],
  ['lista ofertas', 'Obtiene y ordena las ofertas de préstamo disponibles para el cliente.'],
  ['verificacion y registro de prestamo', 'Verifica las condiciones iniciales y registra la solicitud de préstamo.'],
  ['simular prestamo', 'Genera una simulación o cotización del préstamo solicitado.'],
  ['obtener simulacion', 'Recupera el resultado de una simulación de préstamo.'],
  ['obtener cuentas de desembolso', 'Obtiene las cuentas elegibles para desembolsar el préstamo.'],
  ['consultar evaluacion de riesgo', 'Consulta el resultado de la evaluación de riesgo del crédito.'],
  ['consulta y validacion de consentimiento de datos personales', 'Consulta y valida el consentimiento de datos personales del cliente.'],
  ['guardado de consentimiento de datos personales al confirmar', 'Registra el consentimiento de datos personales al confirmar el crédito.'],
  ['obtener url de descarga de documentos', 'Obtiene la URL de descarga de los documentos contractuales.'],
  ['confirmar credito', 'Confirma la cotización y la solicitud del crédito.'],
  ['autorizar operacion', 'Evalúa la autorización requerida para ejecutar la operación.'],
  ['ejecutar prestamo', 'Ejecuta el desembolso del préstamo confirmado.'],
  ['obtener datalle del credito', 'Recupera el detalle y estado del crédito ejecutado.'],
  ['actualizar motivo de prestamo', 'Actualiza el motivo declarado para el préstamo.'],
  ['obtener motivos de prestamo', 'Obtiene el catálogo de motivos disponibles para el préstamo.'],
]);

function descriptionFor(flow, method) {
  const explicit = FLOW_DESCRIPTIONS.get(key(flow));
  if (explicit) return explicit;
  const action = clean(flow).replace(/^[A-ZÁÉÍÓÚÑ]+\s+/, '').replace(/[.]$/, '');
  if (method === 'GET') return `Consulta ${action.charAt(0).toLocaleLowerCase('es')}${action.slice(1)}.`;
  if (method === 'POST') return `Registra o ejecuta ${action.charAt(0).toLocaleLowerCase('es')}${action.slice(1)}.`;
  if (method === 'PATCH' || method === 'PUT') return `Actualiza ${action.charAt(0).toLocaleLowerCase('es')}${action.slice(1)}.`;
  if (method === 'DELETE') return `Elimina ${action.charAt(0).toLocaleLowerCase('es')}${action.slice(1)}.`;
  return 'Propósito funcional por validar con el contrato o el código.';
}

const serviceAppearances = shapes.filter((shape) => SERVICE_PATTERN.test(clean(shape.label)));
const serviceByKey = new Map();
for (const appearance of serviceAppearances) {
  const name = serviceName(appearance.label);
  const identity = key(name);
  const current = serviceByKey.get(identity) || {
    key: identity,
    name,
    layer: layerOf(appearance.label),
    purpose: '',
    appearances: [],
  };
  current.appearances.push(appearance);
  if (current.layer === 'Por validar') current.layer = layerOf(appearance.label);
  serviceByKey.set(identity, current);
}
for (const service of serviceByKey.values()) service.purpose = purposeFor(service.name, service.layer);

const services = [...serviceByKey.values()];
const serviceForShape = (shape) => {
  const point = center(shape);
  return services
    .flatMap((service) => service.appearances.filter((appearance) => contains(appearance, point)).map((appearance) => ({ service, appearance })))
    .sort((a, b) => area(a.appearance) - area(b.appearance))[0]?.service;
};
const serviceByAppearanceId = new Map(services.flatMap((service) => service.appearances.map((appearance) => [appearance.id, service])));
const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));

const actionCandidates = shapes.filter((shape) => {
  const label = clean(shape.label);
  if (!label || Number(shape.y) > 330 || parseEndpoint(label)) return false;
  if (/^inputs?\b|^outputs?\b/i.test(label)) return false;
  return Number(shape.width) >= 80 && Number(shape.width) <= 260 && Number(shape.height) <= 80;
});
function flowFor(shape, parsed) {
  const route = key(parsed?.route);
  if (route.includes('offers-validation')) return 'Validar Oferta';
  if (route.includes('rule-sets') || route.includes('/features/retrieve')) return 'Obtener reglas y características del producto';
  if (route.includes('/personal-loans-product-directory/purposes')) return 'Obtener motivos de prestamo';
  if (route.includes('/consumer-loans/offers') || route.includes('/customer-offers/offers')) return 'Lista ofertas';
  if (route.includes('/accounts') || route === 'accounts' || route === '/products') return 'Obtener cuentas de desembolso';
  if (route.includes('customer-agreements/validate')) return 'Consulta y Validación de Consentimiento de Datos Personales';
  if (route === '/customer-agreements') return 'Guardado de Consentimiento de Datos Personales al Confirmar';
  if (route.includes('contract-documents') || route.includes('documents-directory')) return 'Obtener URL de descarga de Documentos';
  if (route.includes('transaction-authorizations')) return 'Autorizar operación';
  if (route.includes('/execute')) return 'Ejecutar prestamo';
  if (route.includes('/purpose')) return 'Actualizar Motivo de préstamo';
  if (route.includes('/confirm') || (route.includes('/quotes/') && route.includes('/update'))) return 'Confirmar crédito';
  if (route.includes('/quote-orders') && parsed?.method === 'POST') return 'Simular prestamo';
  if (route.includes('/quote-orders') || route.includes('/quotes/retrieve')) return 'Obtener Simulación';
  if (route.includes('/credits/') || route.includes('/credit/')) return 'Consultar Evaluación de Riesgo';
  if (/^\/loan-orders(?:\?|$)/.test(route) && parsed?.method === 'POST') return 'Verificación y registro de prestamo';
  if (/^\/loan-orders\/\{[^}]+\}$/.test(route) && parsed?.method === 'GET') return 'Obtener datalle del crédito';
  if (route.includes('/loans-deposits/') || route.includes('/customer-offers/initiate')) return 'Verificación y registro de prestamo';
  if (route.includes('/customer-leads/')) return 'Validar Oferta';
  if (route.includes('/customer-leads')) return 'Lista ofertas';
  const point = center(shape);
  const candidate = actionCandidates
    .map((action) => ({ action, distance: Math.abs(center(action).x - point.x) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return candidate && candidate.distance <= 240 ? clean(candidate.action.label) : 'Por asignar';
}

const endpointByShapeId = new Map();
const endpointMap = new Map();
for (const shape of shapes) {
  const parsed = parseEndpoint(shape.label);
  if (!parsed) continue;
  const service = serviceForShape(shape);
  if (!service) continue;
  const identity = `${service.key}|${parsed.method}|${parsed.route}`;
  const current = endpointMap.get(identity) || {
    id: identity,
    serviceKey: service.key,
    service: service.name,
    layer: service.layer,
    method: parsed.method,
    route: parsed.route,
    flow: flowFor(shape, parsed),
    description: '',
    servicePurpose: service.purpose,
    dependencyServices: [],
    dependencyEndpoints: [],
    redis: 'No',
    maps: [],
    database: 'No',
    evidenceIds: [],
    appearanceIds: [],
    confidence: 'inferido',
    reviewStatus: 'Por validar con OpenAPI/código',
  };
  current.evidenceIds.push(shape.id);
  const ownerAppearance = service.appearances
    .filter((appearance) => contains(appearance, center(shape)))
    .sort((a, b) => area(a) - area(b))[0];
  if (ownerAppearance) current.appearanceIds.push(ownerAppearance.id);
  if (current.flow === 'Por asignar') current.flow = flowFor(shape, parsed);
  endpointMap.set(identity, current);
  endpointByShapeId.set(shape.id, current);
}
for (const endpoint of endpointMap.values()) endpoint.description = descriptionFor(endpoint.flow, endpoint.method);

function infraForShape(shape) {
  const label = clean(shape?.label);
  if (!label) return undefined;
  if (shape.kind === 'cache' || CACHE_PATTERN.test(label)) {
    const maps = [...label.matchAll(/\b[A-Z][A-Z0-9_]*_MAP\b/g)].map((match) => match[0]);
    return { type: 'Redis', name: label.replace(/^«[^»]+»\s*/, '').trim(), maps };
  }
  if (shape.kind === 'database' || DATA_PATTERN.test(label)) return { type: 'Base de Datos', name: label.replace(/^«[^»]+»\s*/, '').trim(), maps: [] };
  return undefined;
}

function semanticFor(id) {
  const shape = shapeById.get(id);
  if (!shape) return undefined;
  const endpoint = endpointByShapeId.get(id);
  if (endpoint) return { type: 'endpoint', service: serviceByKey.get(endpoint.serviceKey), endpoint, shape };
  const directService = serviceByAppearanceId.get(id);
  if (directService) return { type: 'service', service: directService, shape };
  const infra = infraForShape(shape);
  if (infra) return { type: 'infra', infra, shape };
  const service = serviceForShape(shape);
  if (service) return { type: 'service-detail', service, shape };
  return { type: 'other', shape };
}

const dependencies = [];
const serviceFacts = new Map(services.map((service) => [service.key, { redis: new Set(), databases: new Set(), dependencies: [] }]));
const endpointFacts = new Map([...endpointMap.values()].map((endpoint) => [endpoint.id, { redis: new Set(), databases: new Set(), dependencies: [] }]));

function endpointsForSemantic(semantic) {
  if (!semantic?.service) return [];
  if (semantic.endpoint) return [semantic.endpoint];
  const serviceEndpoints = [...endpointMap.values()].filter((endpoint) => endpoint.serviceKey === semantic.service.key);
  const directAppearanceId = semantic.type === 'service' ? semantic.shape.id : undefined;
  const containingAppearances = directAppearanceId
    ? [directAppearanceId]
    : semantic.service.appearances.filter((appearance) => contains(appearance, center(semantic.shape))).map((appearance) => appearance.id);
  const local = serviceEndpoints.filter((endpoint) => endpoint.appearanceIds.some((id) => containingAppearances.includes(id)));
  if (!local.length) return serviceEndpoints;
  if (semantic.type === 'service-detail' && local.length > 1) {
    const x = center(semantic.shape).x;
    return [local.map((endpoint) => {
      const shape = shapeById.get(endpoint.evidenceIds[0]);
      return { endpoint, distance: shape ? Math.abs(center(shape).x - x) : Number.POSITIVE_INFINITY };
    }).sort((a, b) => a.distance - b.distance)[0].endpoint];
  }
  return local;
}

for (const link of links) {
  const provider = semanticFor(link.source);
  const consumer = semanticFor(link.target);
  if (!provider || !consumer?.service || provider.service?.key === consumer.service.key) continue;
  const facts = serviceFacts.get(consumer.service.key);
  const consumerEndpoints = endpointsForSemantic(consumer);
  if (provider.type === 'infra') {
    const targets = consumerEndpoints.length ? consumerEndpoints.map((endpoint) => endpointFacts.get(endpoint.id)) : [facts];
    for (const target of targets) {
      if (provider.infra.type === 'Redis') {
        for (const map of provider.infra.maps) target.redis.add(map);
        if (!provider.infra.maps.length) target.redis.add(provider.infra.name);
      } else target.databases.add(provider.infra.name);
    }
    continue;
  }
  if (!provider.service) continue;
  const providerEndpoints = endpointsForSemantic(provider);
  const providerEndpoint = provider.endpoint
    ? `${provider.endpoint.method} ${provider.endpoint.route}`
    : [...endpointMap.values()].filter((endpoint) => endpoint.serviceKey === provider.service.key).length === 1
      ? `${providerEndpoints[0]?.method} ${providerEndpoints[0]?.route}`
      : 'PENDIENTE';
  const targets = consumerEndpoints.length ? consumerEndpoints : [undefined];
  for (const endpoint of targets) {
    const dependency = {
      consumerService: consumer.service.name,
      consumerEndpoint: endpoint ? `${endpoint.method} ${endpoint.route}` : 'Aplica al servicio',
      providerService: provider.service.name,
      providerEndpoint,
      protocol: clean(link.protocol) || 'http',
      evidenceId: link.id,
      confidence: link.sourceInferred || link.targetInferred ? 'por-validar' : 'observado',
    };
    (endpoint ? endpointFacts.get(endpoint.id) : facts).dependencies.push(dependency);
    dependencies.push(dependency);
  }
}

const dedupDependencies = [...new Map(dependencies.map((dependency) => [
  `${key(dependency.consumerService)}|${dependency.consumerEndpoint}|${key(dependency.providerService)}|${dependency.providerEndpoint}`,
  dependency,
])).values()];

for (const endpoint of endpointMap.values()) {
  const facts = endpointFacts.get(endpoint.id);
  const applicable = facts.dependencies;
  endpoint.dependencyServices = [...new Set(applicable.map((dependency) => dependency.providerService))];
  endpoint.dependencyEndpoints = [...new Set(applicable.map((dependency) => dependency.providerEndpoint))];
  endpoint.maps = [...facts.redis].sort();
  endpoint.redis = endpoint.maps.length ? 'Sí' : 'No';
  endpoint.database = facts.databases.size ? `Sí — ${[...facts.databases].sort().join('; ')}` : 'No';
}

const inventory = [...endpointMap.values()]
  .sort((a, b) => a.flow.localeCompare(b.flow, 'es') || a.service.localeCompare(b.service, 'es') || a.route.localeCompare(b.route, 'es'));
const serviceRows = services
  .map((service) => {
    const facts = serviceFacts.get(service.key);
    const endpoints = inventory.filter((endpoint) => endpoint.serviceKey === service.key);
    const maps = [...new Set([...facts.redis, ...endpoints.flatMap((endpoint) => endpoint.maps)])].sort();
    const databases = [...new Set([
      ...facts.databases,
      ...endpoints.filter((endpoint) => endpoint.database.startsWith('Sí — ')).flatMap((endpoint) => endpoint.database.slice(5).split('; ')),
    ])].sort();
    return {
      service: service.name,
      layer: service.layer,
      purpose: service.purpose,
      endpointCount: endpoints.length,
      redis: maps.length ? 'Sí' : 'No',
      maps,
      database: databases.length ? `Sí — ${databases.join('; ')}` : 'No',
      appearanceCount: service.appearances.length,
      evidenceIds: service.appearances.map((appearance) => appearance.id),
    };
  })
  .sort((a, b) => a.layer.localeCompare(b.layer, 'es') || a.service.localeCompare(b.service, 'es'));

const result = {
  source,
  generatedAt: new Date().toISOString(),
  convention: 'Las flechas del XML apuntan del proveedor al consumidor; el inventario normaliza la lectura como consumidor → proveedor.',
  counts: {
    shapes: shapes.length,
    links: links.length,
    services: serviceRows.length,
    endpoints: inventory.length,
    dependencies: dedupDependencies.length,
    servicesWithRedis: serviceRows.filter((service) => service.redis === 'Sí').length,
    servicesWithDatabase: serviceRows.filter((service) => service.database.startsWith('Sí')).length,
  },
  inventory,
  services: serviceRows,
  dependencies: dedupDependencies,
  warnings: [
    ...(Array.isArray(evidence.warnings) ? evidence.warnings : []),
    'Flujo, descripción, propósito, ownership y dependencias son interpretaciones del XML y deben validarse contra OpenAPI o código.',
  ],
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (output) fs.writeFileSync(output, json, 'utf8');
else process.stdout.write(json);
