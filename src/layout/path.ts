import type { Side } from './anchors.js';
import { routeAroundObstacles, type Obstacle } from './router.js';

/**
 * Trazador ortogonal de aristas, con esquinas redondeadas.
 *
 * Existe en vez de usar el `getSmoothStepPath` de React Flow porque el
 * exportador a SVG corre en Node, donde React Flow no está. Compartir un único
 * trazador garantiza que el fichero exportado sea idéntico a lo que se ve en
 * pantalla: si cada uno enrutara a su manera, el PNG que alguien pega en una
 * presentación no sería el diagrama que revisó.
 */

export interface Point {
  x: number;
  y: number;
}

/** Caja mínima necesaria para validar extremos declarados por mxGraph. */
export interface EndpointBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Un sourcePoint lejano es fallback de mxGraph, no un waypoint del enlace. */
export function pointBelongsToBox(point: Point | undefined, box: EndpointBox, tolerance = 12): point is Point {
  return Boolean(point && point.x >= box.x - tolerance && point.x <= box.x + box.width + tolerance && point.y >= box.y - tolerance && point.y <= box.y + box.height + tolerance);
}

/** Longitud del tramo recto que sale perpendicular al nodo antes de girar. */
const STUB = 18;
const RADIUS = 12;

const isVertical = (side: Side) => side === 'top' || side === 'bottom';

function stubPoint(point: Point, side: Side, distance: number): Point {
  switch (side) {
    case 'top':
      return { x: point.x, y: point.y - distance };
    case 'bottom':
      return { x: point.x, y: point.y + distance };
    case 'left':
      return { x: point.x - distance, y: point.y };
    case 'right':
      return { x: point.x + distance, y: point.y };
  }
}

/** Puntos de quiebro entre los dos tramos perpendiculares a cada nodo. */
function waypoints(from: Point, fromSide: Side, to: Point, toSide: Side): Point[] {
  const a = stubPoint(from, fromSide, STUB);
  const b = stubPoint(to, toSide, STUB);

  const verticalStart = isVertical(fromSide);
  const verticalEnd = isVertical(toSide);

  if (verticalStart && verticalEnd) {
    const midY = (a.y + b.y) / 2;
    return [from, a, { x: a.x, y: midY }, { x: b.x, y: midY }, b, to];
  }

  if (!verticalStart && !verticalEnd) {
    const midX = (a.x + b.x) / 2;
    return [from, a, { x: midX, y: a.y }, { x: midX, y: b.y }, b, to];
  }

  // Codo simple: se gira una sola vez, en la esquina que respeta la dirección
  // de salida de cada extremo.
  const corner = verticalStart ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
  return [from, a, corner, b, to];
}

/** Elimina puntos repetidos y colineales, que producirían curvas de radio cero. */
function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.5 && Math.abs(last.y - point.y) < 0.5) continue;
    result.push(point);
  }

  for (let i = result.length - 2; i > 0; i--) {
    const before = result[i - 1]!;
    const current = result[i]!;
    const after = result[i + 1]!;
    const collinear =
      (Math.abs(before.x - current.x) < 0.5 && Math.abs(current.x - after.x) < 0.5) ||
      (Math.abs(before.y - current.y) < 0.5 && Math.abs(current.y - after.y) < 0.5);
    if (collinear) result.splice(i, 1);
  }

  return result;
}

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Punto a `t` del recorrido entre `a` y `b`, acotado a `max` unidades. */
function towards(a: Point, b: Point, max: number): Point {
  const length = distance(a, b);
  if (length === 0) return { ...a };
  const ratio = Math.min(max, length / 2) / length;
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
}

export interface Route {
  /** Atributo `d` de un `<path>`. */
  d: string;
  /** Vértices sin redondear, útiles para colocar la etiqueta. */
  points: Point[];
  /** Punto medio por longitud de arco. */
  labelAt: Point;
  /**
   * Punto medio desplazado perpendicularmente a la línea.
   *
   * Colocar la etiqueta encima del trazo la vuelve ilegible por muy opaco que
   * sea su fondo, porque la flecha la parte en dos. Apartándola queda a un
   * lado y se lee de corrido.
   */
  labelOffset: Point;
}

/** Cuánto se aparta la etiqueta del trazo. */
const LABEL_GAP = 13;

/**
 * Punto a la fracción `t` de una polilínea.
 *
 * El navegador tiene `getPointAtLength`, pero el exportador corre en Node y
 * necesita las mismas posiciones para congelar un fotograma. Se mide sobre los
 * vértices sin redondear: la diferencia con la curva real es de unos pocos
 * píxeles en las esquinas, invisible para un punto de 11 px.
 */
export function pointAlong(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0]! };

  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1]!, points[i]!);
    lengths.push(length);
    total += length;
  }

  const target = Math.min(Math.max(t, 0), 1) * total;
  let travelled = 0;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (travelled + length >= target) {
      const ratio = length === 0 ? 0 : (target - travelled) / length;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    travelled += length;
  }

  return { ...points[points.length - 1]! };
}

export function routeEdge(
  from: Point,
  fromSide: Side,
  to: Point,
  toSide: Side,
  obstacles: readonly Obstacle[] = [],
): Route {
  const fallback = waypoints(from, fromSide, to, toSide);
  const start = stubPoint(from, fromSide, STUB);
  const end = stubPoint(to, toSide, STUB);
  // Sin obstáculos se conserva exactamente el trazado histórico (incluido el
  // codo ortogonal entre los dos stubs). El router solo aporta valor cuando
  // hay algo que esquivar.
  const around = obstacles.length > 0 ? routeAroundObstacles(start, end, obstacles) : null;
  const points = simplify(around ? [from, ...around, to] : fallback);

  if (points.length < 2) {
    return {
      d: `M ${from.x},${from.y} L ${to.x},${to.y}`,
      points: [from, to],
      labelAt: from,
      labelOffset: { x: from.x, y: from.y - LABEL_GAP },
    };
  }

  const first = points[0]!;
  let d = `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`;

  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]!;
    const corner = points[i]!;
    const next = points[i + 1]!;

    const entry = towards(corner, previous, RADIUS);
    const exit = towards(corner, next, RADIUS);

    d += ` L ${entry.x.toFixed(1)},${entry.y.toFixed(1)}`;
    d += ` Q ${corner.x.toFixed(1)},${corner.y.toFixed(1)} ${exit.x.toFixed(1)},${exit.y.toFixed(1)}`;
  }

  const last = points[points.length - 1]!;
  d += ` L ${last.x.toFixed(1)},${last.y.toFixed(1)}`;

  const labelAt = midpoint(points);
  return { d, points, labelAt, labelOffset: offsetFromLine(points, labelAt) };
}

/**
 * Aparta un punto de la polilínea en perpendicular al segmento que lo
 * contiene. En un tramo vertical la etiqueta se va a la derecha; en uno
 * horizontal, hacia arriba, que es donde la vista la busca.
 */
function offsetFromLine(points: Point[], at: Point): Point {
  let segment: [Point, Point] = [points[0]!, points[1]!];
  let best = Infinity;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const distanceToSegment = Math.abs(distance(a, at) + distance(at, b) - distance(a, b));
    if (distanceToSegment < best) {
      best = distanceToSegment;
      segment = [a, b];
    }
  }

  const [a, b] = segment;
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  return horizontal ? { x: at.x, y: at.y - LABEL_GAP } : { x: at.x + LABEL_GAP, y: at.y };
}

function midpoint(points: Point[]): Point {
  const total = points.reduce(
    (sum, point, i) => (i === 0 ? 0 : sum + distance(points[i - 1]!, point)),
    0,
  );

  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const segment = distance(a, b);
    if (travelled + segment >= total / 2) {
      const ratio = segment === 0 ? 0 : (total / 2 - travelled) / segment;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    travelled += segment;
  }

  return points[points.length - 1]!;
}
