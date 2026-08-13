import type { Point } from './path.js';

/** Rectángulo que una arista no puede atravesar. Las zonas no se incluyen. */
export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MARGIN = 16;
const TURN_PENALTY = 30;
const NODE_BUDGET = 4_000;
const CACHE_LIMIT = 500;
const EPSILON = 0.001;

type Direction = 'horizontal' | 'vertical' | null;

interface Vertex extends Point {
  neighbors: number[];
}

interface QueueEntry {
  state: string;
  cost: number;
  priority: number;
}

/**
 * Caché acotada por la firma de las posiciones. Durante el arrastre React
 * puede pedir el mismo trazado más de una vez antes de que cambie la posición;
 * recalcular el grafo de visibilidad en esos renders hace que el lienzo pierda
 * fluidez con diagramas grandes.
 */
const cache = new Map<string, Point[] | null>();

function remember(key: string, route: Point[] | null): Point[] | null {
  cache.set(key, route);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return route;
}

function unique(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))].sort((a, b) => a - b);
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function isInside(point: Point, obstacle: Obstacle): boolean {
  return (
    point.x > obstacle.x + EPSILON &&
    point.x < obstacle.x + obstacle.width - EPSILON &&
    point.y > obstacle.y + EPSILON &&
    point.y < obstacle.y + obstacle.height - EPSILON
  );
}

/** Devuelve si un segmento ortogonal corta el interior de una caja reservada. */
function isBlocked(a: Point, b: Point, obstacles: Obstacle[]): boolean {
  for (const obstacle of obstacles) {
    const right = obstacle.x + obstacle.width;
    const bottom = obstacle.y + obstacle.height;
    if (Math.abs(a.y - b.y) < EPSILON) {
      const left = Math.min(a.x, b.x);
      const rightEdge = Math.max(a.x, b.x);
      if (
        a.y > obstacle.y + EPSILON &&
        a.y < bottom - EPSILON &&
        Math.max(left, obstacle.x) < Math.min(rightEdge, right) - EPSILON
      ) {
        return true;
      }
    } else if (Math.abs(a.x - b.x) < EPSILON) {
      const top = Math.min(a.y, b.y);
      const bottomEdge = Math.max(a.y, b.y);
      if (
        a.x > obstacle.x + EPSILON &&
        a.x < right - EPSILON &&
        Math.max(top, obstacle.y) < Math.min(bottomEdge, bottom) - EPSILON
      ) {
        return true;
      }
    }
  }
  return false;
}

function distance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function direction(a: Point, b: Point): Exclude<Direction, null> {
  return Math.abs(a.x - b.x) > Math.abs(a.y - b.y) ? 'horizontal' : 'vertical';
}

function push(queue: QueueEntry[], entry: QueueEntry): void {
  queue.push(entry);
  let index = queue.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (queue[parent]!.priority <= entry.priority) break;
    queue[index] = queue[parent]!;
    index = parent;
  }
  queue[index] = entry;
}

function pop(queue: QueueEntry[]): QueueEntry | undefined {
  const first = queue[0];
  const last = queue.pop();
  if (!first || !last || queue.length === 0) return first;

  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let child = left;
    if (right < queue.length && queue[right]!.priority < queue[left]!.priority) child = right;
    if (child >= queue.length || queue[child]!.priority >= last.priority) break;
    queue[index] = queue[child]!;
    index = child;
  }
  queue[index] = last;
  return first;
}

function signature(start: Point, end: Point, obstacles: Obstacle[]): string {
  const boxes = obstacles
    .map((box) => `${box.x},${box.y},${box.width},${box.height}`)
    .sort()
    .join('|');
  return `${start.x},${start.y}>${end.x},${end.y}#${boxes}`;
}

/**
 * Busca una polilínea ortogonal entre dos puntos exteriores a sus nodos.
 *
 * El grafo está formado por los cruces entre las guías que rodean cada caja.
 * Así no se prueba el plano píxel a píxel: el coste depende del número de
 * nodos, no del tamaño del lienzo. A* guarda también la dirección de llegada
 * para penalizar los giros y preferir recorridos fáciles de leer.
 */
export function routeAroundObstacles(start: Point, end: Point, obstacles: readonly Obstacle[]): Point[] | null {
  if (obstacles.length === 0) return [start, end];

  const boxes = obstacles.filter((box) => box.width > 0 && box.height > 0);
  const key = signature(start, end, boxes);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  if (boxes.some((box) => isInside(start, box) || isInside(end, box))) return remember(key, null);

  // Primero prueba los recorridos ortogonales mínimos. Suele haber otros
  // nodos en el lienzo aunque ninguno bloquee esta conexión; sin este atajo,
  // A* podía elegir una guía lejana y añadir curvas innecesarias.
  if ((Math.abs(start.x - end.x) < EPSILON || Math.abs(start.y - end.y) < EPSILON)
      && !isBlocked(start, end, boxes)) {
    return remember(key, [start, end]);
  }
  const elbows = [
    { x: end.x, y: start.y },
    { x: start.x, y: end.y },
  ];
  for (const elbow of elbows) {
    if (boxes.some((box) => isInside(elbow, box))) continue;
    if (!isBlocked(start, elbow, boxes) && !isBlocked(elbow, end, boxes)) {
      return remember(key, [start, elbow, end]);
    }
  }

  const xs = unique([start.x, end.x, ...boxes.flatMap((box) => [box.x - MARGIN, box.x + box.width + MARGIN])]);
  const ys = unique([start.y, end.y, ...boxes.flatMap((box) => [box.y - MARGIN, box.y + box.height + MARGIN])]);
  const vertices: Vertex[] = [];
  const byPoint = new Map<string, number>();
  const byX = new Map<number, number[]>();
  const byY = new Map<number, number[]>();

  for (const x of xs) {
    for (const y of ys) {
      const point = { x, y };
      if (boxes.some((box) => isInside(point, box))) continue;
      const index = vertices.length;
      vertices.push({ ...point, neighbors: [] });
      byPoint.set(pointKey(point), index);
      const vertical = byX.get(x) ?? [];
      vertical.push(index);
      byX.set(x, vertical);
      const horizontal = byY.get(y) ?? [];
      horizontal.push(index);
      byY.set(y, horizontal);
    }
  }

  const startIndex = byPoint.get(pointKey(start));
  const endIndex = byPoint.get(pointKey(end));
  if (startIndex === undefined || endIndex === undefined) return remember(key, null);

  const connect = (indexes: number[], axis: 'x' | 'y') => {
    indexes.sort((a, b) => vertices[a]![axis] - vertices[b]![axis]);
    for (let i = 1; i < indexes.length; i++) {
      const a = indexes[i - 1]!;
      const b = indexes[i]!;
      if (!isBlocked(vertices[a]!, vertices[b]!, boxes)) {
        vertices[a]!.neighbors.push(b);
        vertices[b]!.neighbors.push(a);
      }
    }
  };
  for (const indexes of byX.values()) connect(indexes, 'y');
  for (const indexes of byY.values()) connect(indexes, 'x');

  const stateKey = (index: number, incoming: Direction) => `${index}:${incoming ?? 'start'}`;
  const queue: QueueEntry[] = [];
  const costs = new Map<string, number>();
  const previous = new Map<string, string>();
  const initial = stateKey(startIndex, null);
  costs.set(initial, 0);
  push(queue, { state: initial, cost: 0, priority: distance(start, end) });

  let explored = 0;
  let finish: string | undefined;
  while (queue.length > 0 && explored++ < NODE_BUDGET) {
    const current = pop(queue)!;
    if (current.cost !== costs.get(current.state)) continue;
    const [indexText, incomingText] = current.state.split(':');
    const index = Number(indexText);
    const incoming = incomingText === 'start' ? null : (incomingText as Exclude<Direction, null>);
    if (index === endIndex) {
      finish = current.state;
      break;
    }

    for (const neighbor of vertices[index]!.neighbors) {
      const nextDirection = direction(vertices[index]!, vertices[neighbor]!);
      const nextCost = current.cost + distance(vertices[index]!, vertices[neighbor]!) + (incoming && incoming !== nextDirection ? TURN_PENALTY : 0);
      const next = stateKey(neighbor, nextDirection);
      if (nextCost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, nextCost);
      previous.set(next, current.state);
      push(queue, {
        state: next,
        cost: nextCost,
        priority: nextCost + distance(vertices[neighbor]!, end),
      });
    }
  }

  if (!finish) return remember(key, null);
  const route: Point[] = [];
  for (let state: string | undefined = finish; state; state = previous.get(state)) {
    const [indexText] = state.split(':');
    route.push(vertices[Number(indexText)]!);
  }
  route.reverse();
  return remember(key, route.map(({ x, y }) => ({ x, y })));
}
