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
const NodeReference = z.string().regex(
  /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/,
  'debe ser un nodo o nodo/operación',
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

/**
 * Presentación explícita de una forma importada.
 *
 * El modelo semántico sigue viviendo en `kind`, `zone`, `provides` y
 * `flows`; esta capa solo evita que un intercambio con Draw.io pierda los
 * colores, tipografía y alineación que el autor ya decidió.
 */
const Paint = z.string().regex(/^(?:none|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/);
export const AppearanceSchema = z
  .object({
    fill: Paint.optional(),
    stroke: Paint.optional(),
    text: Paint.optional(),
    fontSize: z.number().positive().optional(),
    fontFamily: z.string().optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    radius: z.number().nonnegative().optional(),
    opacity: z.number().min(0).max(1).optional(),
    dashed: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    /** Silueta portable del shape de mxGraph. */
    shape: z.enum(['rectangle', 'module', 'uml-frame', 'note']).optional(),
    strokeWidth: z.number().positive().optional(),
    frameWidth: z.number().positive().optional(),
    frameHeight: z.number().positive().optional(),
  })
  .strict();
export type Appearance = z.infer<typeof AppearanceSchema>;

/** Geometría de una conexión importada. Las coordenadas son de lienzo absoluto. */
export const PointSchema = z.object({ x: z.number(), y: z.number() }).strict();
export const EdgeLayoutSchema = z
  .object({
    sourcePoint: PointSchema.optional(),
    targetPoint: PointSchema.optional(),
    points: z.array(PointSchema).default([]),
    sourceAnchor: PointSchema.optional(),
    targetAnchor: PointSchema.optional(),
    startArrow: z.string().optional(),
    endArrow: z.string().optional(),
    style: z.string().optional(),
  })
  .strict();
export type EdgeLayout = z.infer<typeof EdgeLayoutSchema>;

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
    appearance: AppearanceSchema.optional(),
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
    /** Dibuja las operaciones como hijos dentro de la caja del servicio. */
    expanded: z.boolean().default(false),
    /** Topics que publica o consume (solo relevante en nodos `broker`). */
    topics: z.array(z.string()).default([]),
    /** Marca el nodo como fuera del perímetro del equipo. */
    external: z.boolean().default(false),
    /** Posición fijada a mano, relativa a su zona. */
    layout: LayoutSchema.optional(),
    appearance: AppearanceSchema.optional(),
  })
  .strict();
export type DiagramNode = z.infer<typeof NodeSchema>;

/**
 * Un paso de un flujo. Es la unidad que se anima: un paquete viajando de
 * `from` a `to`.
 */
export const StepSchema = z
  .object({
    from: NodeReference,
    to: NodeReference,
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
    /** Ejemplos libres: pueden ser JSON incompleto durante el diseño. */
    request: z.string().optional(),
    response: z.string().optional(),
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
    /** Extremos propuestos por proximidad porque Draw.io los dejó sueltos. */
    sourceInferred: z.boolean().default(false),
    targetInferred: z.boolean().default(false),
    note: z.string().optional(),
    /** Ruta y anclajes preservados desde Draw.io; no se autoenrutan. */
    layout: EdgeLayoutSchema.optional(),
  })
  .strict();
export type DeclaredEdge = z.infer<typeof EdgeSchema>;

/**
 * Ajustes de animación del diagrama.
 *
 * Van en el fichero y no en la interfaz porque son parte de cómo se cuenta el
 * diagrama: un flujo de latencias que se explica en una reunión no se anima
 * igual que un panel que vive en una pantalla. Los controles de la web parten
 * de aquí y lo que se toque ahí es solo para la sesión.
 */
export const AnimationSchema = z
  .object({
    /**
     * `paso`: un paquete por paso, en secuencia — es lo que hace legible un
     * recorrido y sigue siendo el modo por omisión.
     * `continuo`: todas las aristas del flujo con puntos a la vez, que es lo
     * que da sensación de tráfico y funciona mejor en una pantalla de sala.
     */
    mode: z.enum(['paso', 'continuo']).default('paso'),
    /** Multiplicador de velocidad de partida. */
    speed: z.number().positive().max(8).default(1),
    /** Paquetes en vuelo por arista en modo continuo. */
    packetsPerEdge: z.number().int().min(1).max(8).default(3),
    /** Puntos de estela detrás de cada paquete. 0 lo desactiva. */
    trail: z.number().int().min(0).max(8).default(3),
    /** Sentido del recorrido: contra la flecha, o alternando en cada vuelta. */
    direction: z.enum(['normal', 'inversa', 'alterna']).default('normal'),
    /** Segundos que tarda un paquete en recorrer una arista en modo continuo. */
    cycleMs: z.number().positive().max(20_000).default(3000),
  })
  .strict();
export type AnimationSettings = z.infer<typeof AnimationSchema>;

/** La intención de lectura guía al agente y hace explícitas las vistas C4. */
export const DiagramViewSchema = z
  .enum(['architecture', 'sequence', 'c4-context', 'c4-container', 'c4-component'])
  .default('architecture');
export type DiagramView = z.infer<typeof DiagramViewSchema>;

export const DiagramSchema = z
  .object({
    /** Versión del formato. Permite migrar sin romper ficheros existentes. */
    archiflow: z.literal(1).default(1),
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string().optional(),
    owner: z.string().optional(),
    /** Tipo de vista: arquitectura general, secuencia o nivel C4. */
    view: DiagramViewSchema,
    /** `faithful` conserva la geometría importada; `auto` usa ELK de forma explícita. */
    layoutMode: z.enum(['faithful', 'auto']).default('auto'),
    /** Fecha de última revisión humana, en ISO. */
    updated: z.string().optional(),
    animation: AnimationSchema.default({}),
    zones: z.array(ZoneSchema).default([]),
    nodes: z.array(NodeSchema).min(1, 'un diagrama necesita al menos un nodo'),
    edges: z.array(EdgeSchema).default([]),
    flows: z.array(FlowSchema).default([]),
  })
  .strict();

export type Diagram = z.infer<typeof DiagramSchema>;
export type DiagramInput = z.input<typeof DiagramSchema>;
