import type { NodeKind, Protocol } from './schema/schema.js';

/**
 * Paleta compartida por el renderer web y los exportadores, para que un
 * diagrama exportado a draw.io se reconozca como el mismo que se vio animado.
 */

export const kindAccent: Record<NodeKind, string> = {
  service: '#818cf8',
  frontend: '#38bdf8',
  client: '#22d3ee',
  gateway: '#a78bfa',
  database: '#fbbf24',
  cache: '#fb7185',
  broker: '#34d399',
  external: '#94a3b8',
  job: '#f472b6',
  storage: '#facc15',
  component: '#c4b5fd',
};

export const kindLabel: Record<NodeKind, string> = {
  service: 'Servicio',
  frontend: 'Frontend',
  client: 'Canal',
  gateway: 'Gateway',
  database: 'Base de datos',
  cache: 'Caché',
  broker: 'Broker',
  external: 'Externo',
  job: 'Proceso',
  storage: 'Almacenamiento',
  component: 'Componente',
};

export const protocolColor: Record<Protocol, string> = {
  http: '#818cf8',
  https: '#818cf8',
  grpc: '#a78bfa',
  graphql: '#f472b6',
  soap: '#94a3b8',
  kafka: '#34d399',
  amqp: '#34d399',
  jms: '#34d399',
  mq: '#34d399',
  jdbc: '#fbbf24',
  sql: '#fbbf24',
  nosql: '#fbbf24',
  redis: '#fb7185',
  file: '#facc15',
  internal: '#64748b',
};
