import { describe, expect, it } from 'vitest';
import { compile } from '../src/schema/compile.js';
import { parseDiagram } from '../src/schema/parse.js';
import { computeBaseLayout, endpointBox, layoutEdgeRefs, nodeHeight, nodeWidth, placeEdgeLabel, routeAroundObstacles, routeEdge } from '../src/layout/index.js';

const roundTrip = `
archiflow: 1
name: Ida y vuelta
zones:
  - id: canales
  - id: negocio
  - id: datos
nodes:
  - id: canal
    zone: canales
  - id: api
    zone: negocio
  - id: db
    zone: datos
flows:
  - id: consultar
    steps:
      - from: canal
        to: api
        request: entrada
      - from: api
        to: db
        request: consulta
      - from: db
        to: api
        response: resultado
      - from: api
        to: canal
        response: salida
`;

describe('orden del flujo', () => {
  it('usa las solicitudes para ordenar y no deja que los retornos inviertan las capas', async () => {
    const parsed = parseDiagram(roundTrip);
    expect(parsed.ok).toBe(true);
    const ir = compile(parsed.diagram!);

    expect(layoutEdgeRefs(ir).map((edge) => `${edge.source}>${edge.target}`)).toEqual([
      'canal>api',
      'api>db',
    ]);

    const laid = await computeBaseLayout(ir);
    const y = new Map(laid.zones.map((zone) => [zone.id, zone.y]));
    expect(y.get('zone:canales')).toBeLessThan(y.get('zone:negocio')!);
    expect(y.get('zone:negocio')).toBeLessThan(y.get('zone:datos')!);
  });

  it('prefiere un solo codo cuando no hay una caja que esquivar', () => {
    const route = routeAroundObstacles(
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      [{ x: 300, y: 300, width: 80, height: 80 }],
    );
    expect(route).toHaveLength(3);
  });

  it('pone el texto encima del tramo horizontal principal en ambos sentidos', () => {
    const forward = routeEdge({ x: 0, y: 0 }, 'right', { x: 180, y: 80 }, 'left');
    const backward = routeEdge({ x: 180, y: 80 }, 'left', { x: 0, y: 0 }, 'right');
    expect(forward.labelOffset.y).toBeLessThan(forward.labelAt.y);
    expect(backward.labelOffset.y).toBeLessThan(backward.labelAt.y);
  });

  it('mantiene el texto en su conexión sin invadir una dependencia vecina', () => {
    const points = [
      { x: 20, y: 220 },
      { x: 20, y: 190 },
      { x: 320, y: 190 },
      { x: 320, y: 20 },
    ];
    const external = { x: 210, y: 175, width: 130, height: 90 };
    const label = placeEdgeLabel(points, [external], 150, 22);
    expect(label.x + 75).toBeLessThanOrEqual(external.x);
    expect(label.y).toBeLessThan(190);
  });
});

describe('tarjetas de endpoints', () => {
  const operation = { id: 'larga', method: 'POST' as const, path: '/v1/usuarios/{usuarioId}/credenciales/restablecimiento-password' };
  const node = {
    id: 'auth', label: 'Auth', kind: 'service' as const, tags: [], provides: [operation], expanded: true,
    topics: [], external: false, degree: 0,
  };

  it('reserva dos líneas uniformes y ancho suficiente para la ruta completa', () => {
    expect(nodeHeight(node)).toBe(110);
    expect(nodeWidth(node)).toBeGreaterThan(180);
    expect(endpointBox({ x: 0, y: 0, width: nodeWidth(node), height: nodeHeight(node) }, node, 'larga')?.height).toBe(42);
  });

  it('no permite que un ancho manual corte el contrato del endpoint', () => {
    const reduced = { ...node, layout: { x: 0, y: 0, width: 140, height: 60 } };
    expect(nodeWidth(reduced)).toBe(nodeWidth(node));
    expect(nodeHeight(reduced)).toBe(nodeHeight(node));
  });
});
