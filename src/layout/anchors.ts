import type { Box } from './index.js';

/**
 * Reparto de anclajes para que las aristas no se superpongan.
 *
 * El problema de partida: con un único punto de salida (centro inferior) y uno
 * de entrada (centro superior), todas las aristas de un nodo con cuatro
 * dependencias nacen del mismo píxel y se pisan durante los primeros cien.
 * Es la mitad del "espagueti de flechas" del que parte el proyecto; la otra
 * mitad la resuelve el layout por zonas.
 *
 * La solución tiene dos partes:
 *
 * 1. **Elegir el lado por geometría.** Una arista sale por el lado que mira
 *    hacia el otro nodo, no siempre por abajo.
 * 2. **Repartir dentro del lado.** Si tres aristas comparten el lado inferior,
 *    se colocan al 25 %, 50 % y 75 % del ancho en vez de las tres en el centro.
 *
 * El orden del reparto sigue la posición del otro extremo, de modo que las
 * aristas no se crucen entre sí al salir.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface EdgeSlot {
  sourceSide: Side;
  sourceIndex: number;
  sourceCount: number;
  targetSide: Side;
  targetIndex: number;
  targetCount: number;
}

interface EdgeRef {
  id: string;
  source: string;
  target: string;
}

const center = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** El lado que mira hacia el otro nodo, y el opuesto para el extremo contrario. */
function sidesFor(from: Box, to: Box): { source: Side; target: Side } {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0 ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' };
  }
  return dx >= 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' };
}

/** Coordenada transversal al lado, para ordenar el reparto sin cruces. */
function crossAxis(side: Side, point: { x: number; y: number }): number {
  return side === 'top' || side === 'bottom' ? point.x : point.y;
}

export function computeSlots(boxes: Map<string, Box>, edges: EdgeRef[]): Map<string, EdgeSlot> {
  type Endpoint = { edgeId: string; end: 'source' | 'target'; side: Side; order: number };
  const perSide = new Map<string, Endpoint[]>();
  const sides = new Map<string, { source: Side; target: Side }>();

  for (const edge of edges) {
    const from = boxes.get(edge.source);
    const to = boxes.get(edge.target);
    if (!from || !to) continue;

    const chosen = sidesFor(from, to);
    sides.set(edge.id, chosen);

    const push = (nodeId: string, end: 'source' | 'target', side: Side, other: Box) => {
      const key = `${nodeId}:${side}`;
      const list = perSide.get(key) ?? [];
      list.push({ edgeId: edge.id, end, side, order: crossAxis(side, center(other)) });
      perSide.set(key, list);
    };

    push(edge.source, 'source', chosen.source, to);
    push(edge.target, 'target', chosen.target, from);
  }

  const slots = new Map<string, EdgeSlot>();
  const ensure = (edgeId: string): EdgeSlot => {
    const existing = slots.get(edgeId);
    if (existing) return existing;
    const chosen = sides.get(edgeId)!;
    const created: EdgeSlot = {
      sourceSide: chosen.source,
      sourceIndex: 0,
      sourceCount: 1,
      targetSide: chosen.target,
      targetIndex: 0,
      targetCount: 1,
    };
    slots.set(edgeId, created);
    return created;
  };

  for (const endpoints of perSide.values()) {
    endpoints.sort((a, b) => a.order - b.order);
    endpoints.forEach((endpoint, index) => {
      const slot = ensure(endpoint.edgeId);
      if (endpoint.end === 'source') {
        slot.sourceIndex = index;
        slot.sourceCount = endpoints.length;
      } else {
        slot.targetIndex = index;
        slot.targetCount = endpoints.length;
      }
    });
  }

  return slots;
}

/** Punto de anclaje sobre un lado, repartido según el hueco asignado. */
export function anchorPoint(
  box: { x: number; y: number; width: number; height: number },
  side: Side,
  index: number,
  count: number,
): { x: number; y: number } {
  const fraction = (index + 1) / (count + 1);
  switch (side) {
    case 'top':
      return { x: box.x + box.width * fraction, y: box.y };
    case 'bottom':
      return { x: box.x + box.width * fraction, y: box.y + box.height };
    case 'left':
      return { x: box.x, y: box.y + box.height * fraction };
    case 'right':
      return { x: box.x + box.width, y: box.y + box.height * fraction };
  }
}
