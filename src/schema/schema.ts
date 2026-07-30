import { z } from 'zod';

/**
 * Esquema de `.arch.yaml` — la fuente de verdad de un diagrama ArchiFlow.
 *
 * Principio de modelado (ver ADR-001): un diagrama es una TOPOLOGÍA
 * (`nodes` agrupados en `zones`) sobre la que se superponen N FLUJOS
 * (`flows`), cada uno una secuencia ordenada de pasos. La animación es un
 * flujo reproduciéndose sobre la topología, y las aristas se INFIEREN de los
 * pasos: nunca se declaran dos veces.
 */

/** Tipos de nodo. Determinan el icono, el color y la forma en el canvas. */
export const NODE_KINDS = [
  'service', // microservicio propio
  'frontend', // web / SPA
  'client', // app móvil, canal, consumidor humano
  'gateway', // API gateway, ingress, balanceador
  'database', // relacional o documental
  'cache', // Redis, Hazelcast
  'broker', // Kafka, MQ, event hub
  'external', // API de terceros o de otro dominio
  'job', // batch, cron, scheduler
  'storage', // buckets, ficheros
  'component', // para flujos a nivel método: clase, capa, componente interno
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Protocolos de transporte. Determinan el estilo de la arista y del paquete animado. */
export const PROTOCOLS = [
  'http',
  'https',
  'grpc',
  'graphql',
  'soap',
  'kafka',
  'amqp',
  'jms',
  'mq',
  'jdbc',
  'sql',
  'nosql',
  'redis',
  'file',
  'internal',
] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** Los ids se usan como referencias cruzadas y como claves del layout. */
const Id = z
  .string()
  .min(1)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
    'debe empezar por letra o número y contener solo letras, números, punto, guion o guion bajo',
  );

/**
 * Una operación expuesta por un nodo. Además de documentar, es la materia
 * prima para generar el esqueleto OpenAPI más adelante (ciclo contract-first).
 */
export const OperationSchema = z
  .object({
    id: Id.optional(),
    method: z.enum(HTTP_METHODS).optional(),
    path: z.string().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();
export type Operation = z.infer<typeof OperationSchema>;

/**
 * Posición fijada a mano desde la web.
 *
 * Es presentación dentro de un fichero que por lo demás es semántico, y por
 * eso va en su propia clave en vez de mezclar `x`/`y` con los atributos del
 * nodo. Cuando existe, gana sobre el auto-layout; cuando no, ELK decide.
 */
export const LayoutSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  })
  .strict();
export type LayoutOverride = z.infer<typeof LayoutSchema>;

/** Agrupador visual: capa arquitectónica, clúster, red o dominio. */
export const ZoneSchema = z
  .object({
    id: Id,
    label: z.string().optional(),
    /** Dónde corre: "AKS-PROD-01", "On-premise", "Azure West Europe". */
    platform: z.string().optional(),
    description: z.string().optional(),
    /** Color de acento en formato hex. Si se omite, se asigna por posición. */
    color: z
      .string()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'debe ser un color hex, p.ej. #4f46e5')
      .optional(),
    /** Posición y tamaño fijados a mano. Absolutos. */
    layout: LayoutSchema.optional(),
  })
  .strict();
export type Zone = z.infer<typeof ZoneSchema>;

export const NodeSchema = z
  .object({
    id: Id,
    label: z.string().optional(),
    kind: z.enum(NODE_KINDS).default('service'),
    zone: Id.optional(),
    /** Tecnología concreta: "Quarkus 3", "Spring Boot 3.2", "Oracle 19c". */
    tech: z.string().optional(),
    /** Sobrescribe la plataforma de la zona para este nodo. */
    platform: z.string().optional(),
    description: z.string().optional(),
    /** URL o ruta del repositorio. Permite el `archiflow diff` contra el código. */
    repo: z.string().optional(),
    tags: z.array(z.string()).default([]),
    /** Endpoints que este nodo expone. */
    provides: z.array(OperationSchema).default([]),
    /** Topics que publica o consume (solo relevante en nodos `broker`). */
    topics: z.array(z.string()).default([]),
    /** Marca el nodo como fuera del perímetro del equipo. */
    external: z.boolean().default(false),
    /** Posición fijada a mano, relativa a su zona. */
    layout: LayoutSchema.optional(),
  })
  .strict();
export type DiagramNode = z.infer<typeof NodeSchema>;

/**
 * Un paso de un flujo. Es la unidad que se anima: un paquete viajando de
 * `from` a `to`.
 */
export const StepSchema = z
  .object({
    from: Id,
    to: Id,
    /** La operación, tal cual: "GET /v1/cuentas", "publish cuentas.consultadas". */
    op: z.string().optional(),
    /** Etiqueta legible que sustituye a `op` en el canvas si se quiere algo más corto. */
    label: z.string().optional(),
    protocol: z.enum(PROTOCOLS).default('http'),
    /**
     * Fire-and-forget: el flujo no espera respuesta y sigue avanzando.
     * Se dibuja con trazo discontinuo.
     */
    async: z.boolean().default(false),
    /** Condición bajo la que ocurre el paso: "cache miss", "cliente premium". */
    condition: z.string().optional(),
    /** Latencia típica en ms. Se muestra y modula la duración de la animación. */
    latencyMs: z.number().positive().optional(),
    /** Qué devuelve, para documentar sin añadir un paso de vuelta. */
    returns: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
export type Step = z.infer<typeof StepSchema>;

/** Un escenario de ejecución con nombre. Es lo que se reproduce. */
export const FlowSchema = z
  .object({
    id: Id,
    label: z.string().optional(),
    description: z.string().optional(),
    /**
     * `component`: infraestructura (servicios, cachés, bases, brokers) — el caso principal.
     * `method`: detalle interno de un servicio (capas, clases, métodos).
     */
    level: z.enum(['component', 'method']).default('component'),
    /** Quién dispara el flujo. Si se omite, se toma el `from` del primer paso. */
    entry: Id.optional(),
    /** Qué lo dispara: "El usuario abre la pantalla de cuentas", "Cron 02:00". */
    trigger: z.string().optional(),
    /**
     * Puede estar vacío: el editor gráfico necesita poder crear un flujo y
     * llenarlo después, y borrar un nodo puede vaciar un flujo existente.
     * Un flujo sin pasos se reporta como aviso, no como error.
     */
    steps: z.array(StepSchema).default([]),
  })
  .strict();
export type Flow = z.infer<typeof FlowSchema>;

/**
 * Arista declarada a mano. Solo hace falta para relaciones que no aparecen en
 * ningún flujo (p.ej. una réplica de base de datos). En el caso normal las
 * aristas se infieren de los pasos.
 */
export const EdgeSchema = z
  .object({
    from: Id,
    to: Id,
    label: z.string().optional(),
    protocol: z.enum(PROTOCOLS).default('http'),
    async: z.boolean().default(false),
  })
  .strict();
export type DeclaredEdge = z.infer<typeof EdgeSchema>;

export const DiagramSchema = z
  .object({
    /** Versión del formato. Permite migrar sin romper ficheros existentes. */
    archiflow: z.literal(1).default(1),
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string().optional(),
    owner: z.string().optional(),
    /** Fecha de última revisión humana, en ISO. */
    updated: z.string().optional(),
    zones: z.array(ZoneSchema).default([]),
    nodes: z.array(NodeSchema).min(1, 'un diagrama necesita al menos un nodo'),
    edges: z.array(EdgeSchema).default([]),
    flows: z.array(FlowSchema).default([]),
  })
  .strict();

export type Diagram = z.infer<typeof DiagramSchema>;
export type DiagramInput = z.input<typeof DiagramSchema>;
