import { describe, expect, it } from 'vitest';
import { anchorForPoint, closestPointOnBox, orthogonalImportedRoute, pointKeepingGrabOffset, projectWaypointToBox, simplifyOrthogonalRoute } from '../web/src/edgeGeometry';

function expectOrthogonal(points: Array<{ x: number; y: number }>) {
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    expect(point.x === previous.x || point.y === previous.y).toBe(true);
  }
}

describe('geometría importada de Draw.io', () => {
  it('conserva el codo cuando Draw.io repite un mxPoint', () => {
    const route = orthogonalImportedRoute([
      { x: 1902.5, y: 2092 },
      { x: 1979, y: 1907 },
      { x: 1979, y: 1907 },
      { x: 1979, y: 1518 },
    ], 'top', 'bottom');

    expect(route).toEqual([
      { x: 1902.5, y: 2092 },
      { x: 1902.5, y: 1907 },
      { x: 1979, y: 1907 },
      { x: 1979, y: 1518 },
    ]);
    expectOrthogonal(route);
  });

  it('elimina solo duplicados consecutivos y segmentos rectos redundantes', () => {
    expect(simplifyOrthogonalRoute([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 0, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 30 },
    ])).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 30 },
    ]);
  });

  it('no produce diagonales en una ruta con varios waypoints', () => {
    const route = orthogonalImportedRoute([
      { x: 1385.5, y: 2135 },
      { x: 1386, y: 2123 },
      { x: 1536, y: 2123 },
      { x: 1536, y: 2063 },
      { x: 1720, y: 2063 },
      { x: 1720, y: 1520 },
    ], 'top', 'bottom');
    expectOrthogonal(route);
  });

  it('proyecta el waypoint al perímetro como Draw.io cuando no hay entryX/exitX', () => {
    const cache = { x: 543, y: 1798.25, width: 329, height: 57.5 };
    const service = { x: 735, y: 1392, width: 330, height: 133 };
    const waypoint = { x: 779, y: 1659 };

    expect(projectWaypointToBox(cache, waypoint)).toEqual({ x: 779, y: 1798.25 });
    expect(projectWaypointToBox(service, waypoint)).toEqual({ x: 779, y: 1525 });
    expect(orthogonalImportedRoute([
      projectWaypointToBox(cache, waypoint),
      waypoint,
      waypoint,
      projectWaypointToBox(service, waypoint),
    ], 'top', 'bottom')).toEqual([
      { x: 779, y: 1798.25 },
      { x: 779, y: 1525 },
    ]);
  });

  it('permite arrastrar un extremo por cualquiera de los cuatro bordes', () => {
    const target = { x: 100, y: 200, width: 200, height: 100 };
    expect(closestPointOnBox(target, { x: 138, y: 208 })).toEqual({ x: 138, y: 200 });
    expect(closestPointOnBox(target, { x: 292, y: 245 })).toEqual({ x: 300, y: 245 });
    expect(closestPointOnBox(target, { x: 180, y: 294 })).toEqual({ x: 180, y: 300 });
    expect(closestPointOnBox(target, { x: 104, y: 260 })).toEqual({ x: 100, y: 260 });
  });

  it('guarda el extremo como anclaje relativo para que sobreviva al movimiento del nodo', () => {
    const target = { x: 100, y: 200, width: 200, height: 100 };
    expect(anchorForPoint(target, { x: 250, y: 300 })).toEqual({ x: 0.75, y: 1 });
  });

  it('mantiene la esquina tomada bajo el mouse al mover una etiqueta', () => {
    expect(pointKeepingGrabOffset(
      { x: 200, y: 100 },
      { x: 238, y: 108 },
      { x: 310, y: 205 },
    )).toEqual({ x: 272, y: 197 });
  });
});
