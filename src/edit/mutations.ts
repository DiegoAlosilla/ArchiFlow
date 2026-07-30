import { isMap, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';

/**
 * Mutaciones sobre el AST de un `.arch.yaml`.
 *
 * La regla que gobierna este módulo: **nunca serializar de vuelta desde un
 * objeto JS**. Hacerlo destruiría comentarios, orden de claves y estilo, que
 * en un diagrama de arquitectura son la mitad del valor del fichero. En su
 * lugar se manipula el `Document` de la librería `yaml`, que conserva todo lo
 * que no se toca explícitamente.
 *
 * La web envía intenciones semánticas ("cambia el label de este nodo"), no
 * documentos completos. Así el fichero de disco sigue siendo la fuente de
 * verdad y dos ediciones simultáneas se pueden detectar en vez de pisarse.
 */

export interface MutationResult {
  ok: boolean;
  /** El YAML resultante, solo si `ok`. */
  source?: string;
  error?: string;
}

/** `undefined` en un campo del patch significa "borra esta clave". */
export type Patch = Record<string, unknown>;

export type Mutation =
  | { op: 'node.add'; node: Patch & { id: string } }
  | { op: 'node.remove'; id: string }
  | { op: 'node.update'; id: string; patch: Patch }
  | { op: 'node.rename'; id: string; newId: string }
  | { op: 'zone.add'; zone: Patch & { id: string } }
  | { op: 'zone.remove'; id: string }
  | { op: 'zone.update'; id: string; patch: Patch }
  | { op: 'zone.rename'; id: string; newId: string }
  | { op: 'flow.add'; flow: Patch & { id: string } }
  | { op: 'flow.remove'; id: string }
  | { op: 'flow.update'; id: string; patch: Patch }
  | { op: 'step.add'; flowId: string; index?: number; step: Patch }
  | { op: 'step.remove'; flowId: string; index: number }
  | { op: 'step.update'; flowId: string; index: number; patch: Patch }
  | { op: 'step.move'; flowId: string; from: number; to: number };

class MutationError extends Error {}

/** Devuelve la secuencia de nivel superior, creándola si hiciera falta. */
function sequence(doc: Document, key: string, create: boolean): YAMLSeq | undefined {
  const existing = doc.get(key, true);
  if (isSeq(existing)) return existing;
  if (!create) return undefined;
  const created = doc.createNode([]) as YAMLSeq;
  doc.set(key, created);
  return created;
}

function indexById(seq: YAMLSeq | undefined, id: string): number {
  if (!seq) return -1;
  return seq.items.findIndex((item) => isMap(item) && item.get('id') === id);
}

function requireIndex(seq: YAMLSeq | undefined, id: string, what: string): number {
  const index = indexById(seq, id);
  if (index === -1) throw new MutationError(`no existe ${what} con id '${id}'`);
  return index;
}

/**
 * Aplica un patch a un mapa existente. Una clave con valor `undefined` se
 * borra en vez de escribirse como `null`: es la forma de vaciar un campo
 * opcional desde el inspector sin dejar basura en el YAML.
 */
function applyPatch(doc: Document, map: YAMLMap, patch: Patch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '') map.delete(key);
    else map.set(key, createValue(doc, key, value));
  }
}

/**
 * `layout` se escribe en estilo de flujo (`{ x: 120, y: 40 }`). En bloque
 * ocuparía tres líneas por nodo, y con medio diagrama fijado a mano el
 * fichero se vuelve ilegible por culpa de metadatos de presentación.
 */
function createValue(doc: Document, key: string, value: unknown) {
  const node = doc.createNode(value);
  if (key === 'layout' && isMap(node)) node.flow = true;
  return node;
}

function mapAt(seq: YAMLSeq, index: number): YAMLMap {
  const item = seq.items[index];
  if (!isMap(item)) throw new MutationError(`el elemento ${index} no es un objeto`);
  return item;
}

/** Sustituye toda referencia a un id por el nuevo, en pasos y aristas. */
function cascadeNodeRename(doc: Document, oldId: string, newId: string): void {
  const flows = sequence(doc, 'flows', false);
  for (const flow of flows?.items ?? []) {
    if (!isMap(flow)) continue;

    if (flow.get('entry') === oldId) flow.set('entry', newId);

    const steps = flow.get('steps', true);
    if (!isSeq(steps)) continue;
    for (const step of steps.items) {
      if (!isMap(step)) continue;
      for (const key of ['from', 'to']) {
        const value = step.get(key);
        if (value === oldId) step.set(key, newId);
        else if (typeof value === 'string' && value.startsWith(`${oldId}/`)) step.set(key, `${newId}/${value.slice(oldId.length + 1)}`);
      }
    }
  }

  const edges = sequence(doc, 'edges', false);
  for (const edge of edges?.items ?? []) {
    if (!isMap(edge)) continue;
    if (edge.get('from') === oldId) edge.set('from', newId);
    if (edge.get('to') === oldId) edge.set('to', newId);
  }
}

/** Al renombrar una zona hay que reapuntar los nodos que la referencian. */
function cascadeZoneRename(doc: Document, oldId: string, newId: string): void {
  const nodes = sequence(doc, 'nodes', false);
  for (const node of nodes?.items ?? []) {
    if (isMap(node) && node.get('zone') === oldId) node.set('zone', newId);
  }
}

function applyOne(doc: Document, mutation: Mutation): void {
  switch (mutation.op) {
    // ── Nodos ────────────────────────────────────────────────────
    case 'node.add': {
      const nodes = sequence(doc, 'nodes', true)!;
      if (indexById(nodes, mutation.node.id) !== -1) {
        throw new MutationError(`ya existe un nodo con id '${mutation.node.id}'`);
      }
      nodes.add(doc.createNode(mutation.node));
      break;
    }

    case 'node.remove': {
      const nodes = sequence(doc, 'nodes', false);
      const index = requireIndex(nodes, mutation.id, 'un nodo');
      nodes!.items.splice(index, 1);
      // Los pasos que lo usaban quedarían apuntando al vacío, así que se van
      // con él. Es destructivo, pero dejar un diagrama inválido lo es más.
      const flows = sequence(doc, 'flows', false);
      for (const flow of flows?.items ?? []) {
        if (!isMap(flow)) continue;
        const steps = flow.get('steps', true);
        if (!isSeq(steps)) continue;
        steps.items = steps.items.filter(
          (step) => !isMap(step) || (![step.get('from'), step.get('to')].some((value) => value === mutation.id || (typeof value === 'string' && value.startsWith(`${mutation.id}/`)))),
        );
      }
      const edges = sequence(doc, 'edges', false);
      if (edges) {
        edges.items = edges.items.filter(
          (edge) => !isMap(edge) || (edge.get('from') !== mutation.id && edge.get('to') !== mutation.id),
        );
      }
      break;
    }

    case 'node.update': {
      const nodes = sequence(doc, 'nodes', false);
      const index = requireIndex(nodes, mutation.id, 'un nodo');
      applyPatch(doc, mapAt(nodes!, index), mutation.patch);
      break;
    }

    case 'node.rename': {
      const nodes = sequence(doc, 'nodes', false);
      const index = requireIndex(nodes, mutation.id, 'un nodo');
      if (indexById(nodes, mutation.newId) !== -1) {
        throw new MutationError(`ya existe un nodo con id '${mutation.newId}'`);
      }
      mapAt(nodes!, index).set('id', mutation.newId);
      cascadeNodeRename(doc, mutation.id, mutation.newId);
      break;
    }

    // ── Zonas ────────────────────────────────────────────────────
    case 'zone.add': {
      const zones = sequence(doc, 'zones', true)!;
      if (indexById(zones, mutation.zone.id) !== -1) {
        throw new MutationError(`ya existe una zona con id '${mutation.zone.id}'`);
      }
      zones.add(doc.createNode(mutation.zone));
      break;
    }

    case 'zone.remove': {
      const zones = sequence(doc, 'zones', false);
      const index = requireIndex(zones, mutation.id, 'una zona');
      zones!.items.splice(index, 1);
      // Los nodos no se borran: se quedan sin zona y el layout los coloca sueltos.
      const nodes = sequence(doc, 'nodes', false);
      for (const node of nodes?.items ?? []) {
        if (isMap(node) && node.get('zone') === mutation.id) node.delete('zone');
      }
      break;
    }

    case 'zone.update': {
      const zones = sequence(doc, 'zones', false);
      const index = requireIndex(zones, mutation.id, 'una zona');
      applyPatch(doc, mapAt(zones!, index), mutation.patch);
      break;
    }

    case 'zone.rename': {
      const zones = sequence(doc, 'zones', false);
      const index = requireIndex(zones, mutation.id, 'una zona');
      if (indexById(zones, mutation.newId) !== -1) {
        throw new MutationError(`ya existe una zona con id '${mutation.newId}'`);
      }
      mapAt(zones!, index).set('id', mutation.newId);
      cascadeZoneRename(doc, mutation.id, mutation.newId);
      break;
    }

    // ── Flujos ───────────────────────────────────────────────────
    case 'flow.add': {
      const flows = sequence(doc, 'flows', true)!;
      if (indexById(flows, mutation.flow.id) !== -1) {
        throw new MutationError(`ya existe un flujo con id '${mutation.flow.id}'`);
      }
      flows.add(doc.createNode({ steps: [], ...mutation.flow }));
      break;
    }

    case 'flow.remove': {
      const flows = sequence(doc, 'flows', false);
      const index = requireIndex(flows, mutation.id, 'un flujo');
      flows!.items.splice(index, 1);
      break;
    }

    case 'flow.update': {
      const flows = sequence(doc, 'flows', false);
      const index = requireIndex(flows, mutation.id, 'un flujo');
      applyPatch(doc, mapAt(flows!, index), mutation.patch);
      break;
    }

    // ── Pasos ────────────────────────────────────────────────────
    case 'step.add': {
      const steps = stepsOf(doc, mutation.flowId);
      const node = doc.createNode(mutation.step);
      const at = mutation.index ?? steps.items.length;
      steps.items.splice(Math.min(Math.max(at, 0), steps.items.length), 0, node);
      break;
    }

    case 'step.remove': {
      const steps = stepsOf(doc, mutation.flowId);
      requireStepIndex(steps, mutation.index);
      steps.items.splice(mutation.index, 1);
      break;
    }

    case 'step.update': {
      const steps = stepsOf(doc, mutation.flowId);
      requireStepIndex(steps, mutation.index);
      applyPatch(doc, mapAt(steps, mutation.index), mutation.patch);
      break;
    }

    case 'step.move': {
      const steps = stepsOf(doc, mutation.flowId);
      requireStepIndex(steps, mutation.from);
      const [moved] = steps.items.splice(mutation.from, 1);
      const to = Math.min(Math.max(mutation.to, 0), steps.items.length);
      steps.items.splice(to, 0, moved);
      break;
    }
  }
}

function stepsOf(doc: Document, flowId: string): YAMLSeq {
  const flows = sequence(doc, 'flows', false);
  const index = requireIndex(flows, flowId, 'un flujo');
  const flow = mapAt(flows!, index);

  const steps = flow.get('steps', true);
  if (isSeq(steps)) return steps;

  const created = doc.createNode([]) as YAMLSeq;
  flow.set('steps', created);
  return created;
}

function requireStepIndex(steps: YAMLSeq, index: number): void {
  if (index < 0 || index >= steps.items.length) {
    throw new MutationError(`el paso ${index} no existe (hay ${steps.items.length})`);
  }
}

/**
 * Aplica una lista de mutaciones en orden y devuelve el YAML resultante.
 *
 * Es atómico: si una falla, no se escribe nada. Un editor gráfico produce
 * mutaciones en lote (mover tres nodos, renombrar y reordenar) y dejar el
 * fichero a medias sería peor que rechazar la operación entera.
 */
export function applyMutations(source: string, mutations: Mutation[]): MutationResult {
  const doc = parseDocument(source);

  if (doc.errors.length > 0) {
    return { ok: false, error: `el YAML de partida no es válido: ${doc.errors[0]!.message}` };
  }

  try {
    for (const mutation of mutations) applyOne(doc, mutation);
  } catch (error) {
    if (error instanceof MutationError) return { ok: false, error: error.message };
    throw error;
  }

  return { ok: true, source: String(doc) };
}
