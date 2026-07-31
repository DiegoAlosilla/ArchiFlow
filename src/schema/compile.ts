import type {
  AnimationSettings,
  Diagram,
  LayoutOverride,
  NodeKind,
  Operation,
  Protocol,
} from './schema.js';

/**
 * Compilación de `.arch.yaml` al IR que consume el renderer.
 *
 * Dos responsabilidades: inferir las aristas a partir de los pasos de los
 * flujos (ver ADR-001, decisión B) y precalcular la línea de tiempo de cada
 * flujo, de modo que el navegador solo tenga que reproducirla.
 */

export interface IrZone {
  id: string;
  label: string;
  platform?: string;
  description?: string;
  color: string;
  nodeIds: string[];
  /** Posición fijada a mano; gana sobre el auto-layout. */
  layout?: LayoutOverride;
}

export interface IrNode {
  id: string;
  label: string;
  kind: NodeKind;
  zone?: string;
  tech?: string;
  platform?: string;
  description?: string;
  repo?: string;
  tags: string[];
  provides: Operation[];
  expanded: boolean;
  topics: string[];
  external: boolean;
  /** Posición fijada a mano, relativa a su zona; gana sobre el auto-layout. */
  layout?: LayoutOverride;
  /** Número de aristas incidentes. El renderer lo usa para priorizar el layout. */
  degree: number;
}

export interface IrEdge {
  id: string;
  source: string;
  target: string;
  protocol: Protocol;
  async: boolean;
  /** Operaciones distintas observadas sobre esta arista, en orden de aparición. */
  labels: string[];
  /** Flujos que la recorren. Permite atenuar las aristas ajenas al flujo activo. */
  flows: string[];
  /** `true` si solo proviene de `edges:` y ningún flujo la recorre. */
  declaredOnly: boolean;
}

export interface IrStep {
  index: number;
  edgeId: string;
  from: string;
  to: string;
  label: string;
  protocol: Protocol;
  async: boolean;
  condition?: string;
  latencyMs?: number;
  returns?: string;
  note?: string;
  fromOp?: string;
  toOp?: string;
  request?: string;
  response?: string;
  /** Momento de inicio dentro del flujo, en ms. */
  startMs: number;
  durationMs: number;
}

export interface IrFlow {
  id: string;
  label: string;
  description?: string;
  level: 'component' | 'method';
  entry: string;
  trigger?: string;
  steps: IrStep[];
  durationMs: number;
  /** Nodos que participan, en orden de primera aparición. */
  nodeIds: string[];
}

export interface Ir {
  meta: {
    name: string;
    description?: string;
    version?: string;
    owner?: string;
    updated?: string;
  };
  animation: AnimationSettings;
  zones: IrZone[];
  nodes: IrNode[];
  edges: IrEdge[];
  flows: IrFlow[];
}

/**
 * Cómo se escribe una operación en una caja: `GET /v1/cuentas`.
 *
 * Vive aquí porque la usan el canvas y los tres exportadores, y que cada uno la
 * arme a su manera es justo cómo un endpoint acaba escrito de tres formas
 * distintas en el mismo diagrama. Devuelve cadena vacía si no hay nada que
 * mostrar, para que quien la use decida si pinta la línea.
 */
export function endpointSignature(operation: Operation): string {
  const target = operation.path ?? operation.label ?? operation.id ?? '';
  return [operation.method, target].filter(Boolean).join(' ');
}

/** Paleta de acento para las zonas que no declaran color. */
const ZONE_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];

/** Un paso sin latencia declarada dura esto. */
const DEFAULT_DURATION_MS = 900;
/** Respiro entre pasos secuenciales, para que el ojo distinga la transición. */
const SEQUENTIAL_GAP_MS = 120;
/** Desfase de un paso asíncrono: no bloquea, pero se escalona para verse. */
const ASYNC_STAGGER_MS = 180;
/** Cola tras el último paso, para que la animación no corte en seco. */
const TAIL_MS = 400;

export function edgeId(from: string, to: string): string {
  return `${from}__${to}`;
}

/**
 * Traduce latencia real a duración de animación. Escala logarítmica: 5 ms y
 * 50 ms deben verse distintos, pero 500 ms y 5 s no pueden durar diez veces
 * más o el diagrama se vuelve inservible.
 */
function durationFor(latencyMs?: number): number {
  if (latencyMs === undefined) return DEFAULT_DURATION_MS;
  const scaled = 500 + 420 * Math.log10(Math.max(latencyMs, 1));
  return Math.round(Math.min(Math.max(scaled, 450), 2600));
}

function labelFor(step: { label?: string; op?: string; protocol: Protocol }): string {
  if (step.label) return step.label;
  if (step.op) return step.op;
  return step.protocol;
}

function splitReference(reference: string): { node: string; operation?: string } {
  const [node, operation] = reference.split('/');
  return { node: node!, operation };
}

export function compile(diagram: Diagram): Ir {
  const nodes: IrNode[] = diagram.nodes.map((node) => ({
    id: node.id,
    label: node.label ?? node.id,
    kind: node.kind,
    zone: node.zone,
    tech: node.tech,
    platform: node.platform,
    description: node.description,
    repo: node.repo,
    tags: node.tags,
    provides: node.provides,
    expanded: node.expanded,
    topics: node.topics,
    external: node.external,
    layout: node.layout,
    degree: 0,
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const edges = new Map<string, IrEdge>();

  const upsertEdge = (
    from: string,
    to: string,
    protocol: Protocol,
    isAsync: boolean,
    label: string | undefined,
    flowId: string | undefined,
  ): string => {
    const id = edgeId(from, to);
    let edge = edges.get(id);
    if (!edge) {
      edge = {
        id,
        source: from,
        target: to,
        protocol,
        async: isAsync,
        labels: [],
        flows: [],
        declaredOnly: flowId === undefined,
      };
      edges.set(id, edge);
    }
    // Una arista recorrida por un flujo deja de ser "solo declarada".
    if (flowId !== undefined) {
      edge.declaredOnly = false;
      if (!edge.flows.includes(flowId)) edge.flows.push(flowId);
    }
    // Si algún paso sobre la arista es síncrono, la arista se dibuja sólida:
    // el trazo discontinuo se reserva para lo que es siempre fire-and-forget.
    if (!isAsync) edge.async = false;
    if (label && !edge.labels.includes(label)) edge.labels.push(label);
    return id;
  };

  // Las aristas explícitas se registran primero para que su protocolo declarado
  // sea el que prevalezca sobre el inferido.
  for (const edge of diagram.edges) {
    upsertEdge(edge.from, edge.to, edge.protocol, edge.async, edge.label, undefined);
  }

  const flows: IrFlow[] = diagram.flows.map((flow) => {
    const nodeIds: string[] = [];
    const track = (id: string) => {
      if (!nodeIds.includes(id)) nodeIds.push(id);
    };

    let cursor = 0;
    const steps: IrStep[] = flow.steps.map((step, index) => {
      const from = splitReference(step.from);
      const to = splitReference(step.to);
      track(from.node);
      track(to.node);

      const label = labelFor(step);
      const id = upsertEdge(from.node, to.node, step.protocol, step.async, label, flow.id);

      const durationMs = durationFor(step.latencyMs);
      const startMs = cursor;
      // Un paso asíncrono no bloquea: el siguiente arranca casi de inmediato.
      cursor += step.async ? ASYNC_STAGGER_MS : durationMs + SEQUENTIAL_GAP_MS;

      return {
        index,
        edgeId: id,
        from: from.node,
        to: to.node,
        fromOp: from.operation,
        toOp: to.operation,
        label,
        protocol: step.protocol,
        async: step.async,
        condition: step.condition,
        latencyMs: step.latencyMs,
        returns: step.returns,
        note: step.note,
        request: step.request,
        response: step.response,
        startMs,
        durationMs,
      };
    });

    const lastEnd = steps.reduce((max, step) => Math.max(max, step.startMs + step.durationMs), 0);

    return {
      id: flow.id,
      label: flow.label ?? flow.id,
      description: flow.description,
      level: flow.level,
      entry: flow.entry ?? steps[0]?.from ?? nodeIds[0] ?? '',
      trigger: flow.trigger,
      steps,
      durationMs: lastEnd + TAIL_MS,
      nodeIds,
    };
  });

  for (const edge of edges.values()) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (source) source.degree += 1;
    if (target) target.degree += 1;
  }

  const zones: IrZone[] = diagram.zones.map((zone, index) => ({
    id: zone.id,
    label: zone.label ?? zone.id,
    platform: zone.platform,
    description: zone.description,
    color: zone.color ?? ZONE_COLORS[index % ZONE_COLORS.length]!,
    nodeIds: nodes.filter((node) => node.zone === zone.id).map((node) => node.id),
    layout: zone.layout,
  }));

  return {
    meta: {
      name: diagram.name,
      description: diagram.description,
      version: diagram.version,
      owner: diagram.owner,
      updated: diagram.updated,
    },
    animation: diagram.animation,
    zones,
    nodes,
    edges: [...edges.values()],
    flows,
  };
}
