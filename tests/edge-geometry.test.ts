import { describe, expect, it } from 'vitest';
import { orthogonalImportedRoute, projectWaypointToBox, simplifyOrthogonalRoute } from '../web/src/edgeGeometry';

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
});
