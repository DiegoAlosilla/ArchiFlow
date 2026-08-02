import type { NodeKind, Protocol } from './schema/schema.js';

/**
 * Paleta compartida por el renderer web y los exportadores, para que un
 * diagrama exportado a draw.io se reconozca como el mismo que se vio animado.
 */

export const kindAccent: Record<NodeKind, string> = {
  service: '#9aa6ff',
  frontend: '#68b9e8',
  client: '#65c7d8',
  gateway: '#b7a1e8',
  database: '#d9b56c',
  cache: '#dc8796',
  broker: '#70c7a1',
  external: '#a3adba',
  job: '#d79abc',
  storage: '#d8bf72',
  component: '#beb3e8',
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
