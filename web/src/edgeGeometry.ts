export type EdgePoint = { x: number; y: number };
export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';
export type EdgeBox = EdgePoint & { width: number; height: number };

export function sideFromAnchor(anchor: EdgePoint | undefined, fallback: EdgeSide): EdgeSide {
  if (!anchor) return fallback;
  if (anchor.y === 0) return 'top';
  if (anchor.y === 1) return 'bottom';
  if (anchor.x === 0) return 'left';
  if (anchor.x === 1) return 'right';
  return fallback;
}

function orientation(a: EdgePoint, b: EdgePoint): 'horizontal' | 'vertical' | null {
  if (a.x === b.x && a.y === b.y) return null;
  if (a.y === b.y) return 'horizontal';
  if (a.x === b.x) return 'vertical';
  return null;
}

function samePoint(a: EdgePoint, b: EdgePoint): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Draw.io no reparte automáticamente por huecos los extremos que no traen
 * entryX/exitX. Los coloca en el perímetro alineándolos con el waypoint más
 * cercano. Esto evita inventar un pequeño tramo horizontal antes de una línea
 * que en el original era completamente vertical.
 */
export function projectWaypointToBox(box: EdgeBox, waypoint: EdgePoint): EdgePoint {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  const insideX = waypoint.x >= left && waypoint.x <= right;
  const insideY = waypoint.y >= top && waypoint.y <= bottom;

  if (insideX && waypoint.y <= top) return { x: waypoint.x, y: top };
  if (insideX && waypoint.y >= bottom) return { x: waypoint.x, y: bottom };
  if (insideY && waypoint.x <= left) return { x: left, y: waypoint.y };
  if (insideY && waypoint.x >= right) return { x: right, y: waypoint.y };

  const center = { x: left + box.width / 2, y: top + box.height / 2 };
  const dx = waypoint.x - center.x;
  const dy = waypoint.y - center.y;
  if (dx === 0 && dy === 0) return { x: center.x, y: top };
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/**
 * Elimina duplicados consecutivos antes de buscar tramos colineales. Draw.io
 * guarda a veces el mismo mxPoint dos veces; retirar ambos puntos convertiría
 * el codo que comparten en una diagonal.
 */
export function simplifyOrthogonalRoute(input: EdgePoint[]): EdgePoint[] {
  let points = input.filter((point, index) => index === 0 || !samePoint(point, input[index - 1]!));
  let changed = true;
  while (changed && points.length > 2) {
    changed = false;
    const next = points.filter((point, index) => {
      if (index === 0 || index === points.length - 1) return true;
      const previous = points[index - 1]!;
      const following = points[index + 1]!;
      const collinear =
        (point.x === previous.x && point.x === following.x) ||
        (point.y === previous.y && point.y === following.y);
      if (collinear) changed = true;
      return !collinear;
    });
    points = next;
  }
  return points;
}

/**
 * Los `mxPoint` de un orthogonalEdgeStyle son restricciones de paso. Cada par
 * se completa con un codo cuando hace falta, sin sustituir la ruta declarada
 * por el enrutador automático de ArquiFlow.
 */
export function orthogonalImportedRoute(raw: EdgePoint[], sourceSide: EdgeSide, targetSide: EdgeSide): EdgePoint[] {
  if (raw.length < 2) return raw;
  const result: EdgePoint[] = [raw[0]!];
  const sourceOrientation = sourceSide === 'left' || sourceSide === 'right' ? 'horizontal' : 'vertical';
  const targetOrientation = targetSide === 'left' || targetSide === 'right' ? 'horizontal' : 'vertical';

  for (let index = 1; index < raw.length; index++) {
    const next = raw[index]!;
    const previous = result[result.length - 1]!;
    if (samePoint(previous, next)) continue;
    if (orientation(previous, next)) {
      result.push(next);
      continue;
    }

    const prior = result.length > 1 ? orientation(result[result.length - 2]!, previous) : null;
    const firstLeg = index === 1
      ? sourceOrientation
      : index === raw.length - 1
        ? (targetOrientation === 'horizontal' ? 'vertical' : 'horizontal')
        : prior ?? 'horizontal';
    const elbow = firstLeg === 'horizontal'
      ? { x: next.x, y: previous.y }
      : { x: previous.x, y: next.y };
    if (!samePoint(previous, elbow)) result.push(elbow);
    if (!samePoint(result[result.length - 1]!, next)) result.push(next);
  }

  return simplifyOrthogonalRoute(result);
}
