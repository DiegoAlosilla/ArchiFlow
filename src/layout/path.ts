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

export interface LabelObstacle extends EndpointBox {}

/** Cuánto se aparta la etiqueta del trazo. */
const LABEL_GAP = 13;

const overlaps = (
  center: Point,
  width: number,
  height: number,
  obstacle: LabelObstacle,
  margin = 6,
) => center.x + width / 2 + margin > obstacle.x
  && center.x - width / 2 - margin < obstacle.x + obstacle.width
  && center.y + height / 2 + margin > obstacle.y
  && center.y - height / 2 - margin < obstacle.y + obstacle.height;

/**
 * Posición legible y local para el texto de una arista.
 *
 * Se prueban primero las repisas horizontales desde el origen hacia el
 * destino, y dentro de cada una se buscan posiciones laterales antes que el
 * centro. Así una etiqueta no salta a una dependencia vecina solo porque un
 * tramo lejano sea unos píxeles más largo. Los obstáculos pueden ser cajas de
 * servicios o las cabeceras de las zonas.
 */
export function placeEdgeLabel(
  points: Point[],
  obstacles: readonly LabelObstacle[] = [],
  width = 150,
  height = 22,
): Point {
  const horizontal = points.slice(1).map((point, index) => ({
    a: points[index]!,
    b: point,
    index,
  })).filter(({ a, b }) => Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) && Math.abs(b.x - a.x) >= 24);

  const fractions = [0.22, 0.5, 0.78];
  for (const segment of horizontal) {
    for (const fraction of fractions) {
      const center = {
        x: segment.a.x + (segment.b.x - segment.a.x) * fraction,
        y: segment.a.y - LABEL_GAP,
      };
      if (!obstacles.some((obstacle) => overlaps(center, width, height, obstacle))) return center;
    }
  }

  // Si todas las repisas están ocupadas, usa el primer tramo suficientemente
  // largo y coloca el texto a su lado superior. Sigue perteneciendo al inicio
  // de la conexión y evita invadir el nodo destino.
  const segments = points.slice(1).map((point, index) => ({ a: points[index]!, b: point }));
  for (const { a, b } of segments) {
    if (distance(a, b) < 42) continue;
    const at = { x: a.x + (b.x - a.x) * 0.32, y: a.y + (b.y - a.y) * 0.32 };
    const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    const candidates = vertical
      ? [
          { x: at.x + width / 2 + LABEL_GAP, y: at.y - LABEL_GAP },
          { x: at.x - width / 2 - LABEL_GAP, y: at.y - LABEL_GAP },
        ]
      : [{ x: at.x, y: at.y - LABEL_GAP }];
    const free = candidates.find((candidate) => !obstacles.some((obstacle) => overlaps(candidate, width, height, obstacle)));
    if (free) return free;
  }

  return labelPlacement(points).offset;
}

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

  const label = labelPlacement(points);
  return { d, points, labelAt: label.at, labelOffset: label.offset };
}

/**
 * Coloca la etiqueta sobre el tramo horizontal principal.
 *
 * El punto medio por longitud puede caer en una bajada vertical y deja textos
 * al costado o debajo de la flecha. Buscar el tramo horizontal más largo crea
 * una repisa visual estable. Si la conexión es completamente vertical, el
 * texto queda arriba y a la derecha del centro, nunca debajo del trazo.
 */
function labelPlacement(points: Point[]): { at: Point; offset: Point } {
  let shelf: [Point, Point] | undefined;
  let shelfLength = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    if (width < height || width < 24 || width <= shelfLength) continue;
    shelf = [a, b];
    shelfLength = width;
  }

  if (shelf) {
    const at = { x: (shelf[0].x + shelf[1].x) / 2, y: (shelf[0].y + shelf[1].y) / 2 };
    return { at, offset: { x: at.x, y: at.y - LABEL_GAP } };
  }

  const at = midpoint(points);
  return { at, offset: { x: at.x + LABEL_GAP, y: at.y - LABEL_GAP } };
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
