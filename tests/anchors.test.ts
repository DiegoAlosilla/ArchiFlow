import { describe, expect, it } from 'vitest';
import { anchorPoint, computeSlots, routeEdge } from '../src/layout/index.js';
import type { Box } from '../src/layout/index.js';

const box = (id: string, x: number, y: number): Box => ({ id, x, y, width: 100, height: 50 });

describe('elección de lado', () => {
  it('sale por abajo y entra por arriba cuando el destino está debajo', () => {
    const boxes = new Map([
      ['a', box('a', 0, 0)],
      ['b', box('b', 0, 300)],
    ]);
    const slot = computeSlots(boxes, [{ id: 'a__b', source: 'a', target: 'b' }]).get('a__b')!;

    expect(slot.sourceSide).toBe('bottom');
    expect(slot.targetSide).toBe('top');
  });

  it('usa los lados horizontales cuando el destino está al lado', () => {
    const boxes = new Map([
      ['a', box('a', 0, 0)],
      ['b', box('b', 400, 10)],
    ]);
    const slot = computeSlots(boxes, [{ id: 'a__b', source: 'a', target: 'b' }]).get('a__b')!;

    expect(slot.sourceSide).toBe('right');
    expect(slot.targetSide).toBe('left');
  });

  it('separa la ida y la vuelta entre los mismos dos nodos', () => {
    const boxes = new Map([
      ['a', box('a', 0, 0)],
      ['b', box('b', 0, 300)],
    ]);
    const slots = computeSlots(boxes, [
      { id: 'a__b', source: 'a', target: 'b' },
      { id: 'b__a', source: 'b', target: 'a' },
    ]);

    // La ida sale por abajo de A; la vuelta sale por arriba de B. Nunca
    // comparten el mismo punto.
    expect(slots.get('a__b')!.sourceSide).toBe('bottom');
    expect(slots.get('b__a')!.sourceSide).toBe('top');
  });
});

describe('reparto dentro de un lado', () => {
  it('da un hueco distinto a cada arista que sale del mismo lado', () => {
    const boxes = new Map([
      ['hub', box('hub', 200, 0)],
      ['x', box('x', 0, 300)],
      ['y', box('y', 200, 300)],
      ['z', box('z', 400, 300)],
    ]);
    const slots = computeSlots(boxes, [
      { id: 'hub__x', source: 'hub', target: 'x' },
      { id: 'hub__y', source: 'hub', target: 'y' },
      { id: 'hub__z', source: 'hub', target: 'z' },
    ]);

    const indices = ['hub__x', 'hub__y', 'hub__z'].map((id) => slots.get(id)!.sourceIndex);
    expect([...indices].sort()).toEqual([0, 1, 2]);
    for (const id of ['hub__x', 'hub__y', 'hub__z']) {
      expect(slots.get(id)!.sourceCount).toBe(3);
    }
  });

  it('ordena los huecos según la posición del otro extremo, para no cruzarse', () => {
    const boxes = new Map([
      ['hub', box('hub', 200, 0)],
      ['izquierda', box('izquierda', 0, 300)],
      ['derecha', box('derecha', 400, 300)],
    ]);
    const slots = computeSlots(boxes, [
      // Declaradas al revés a propósito: el orden debe salir de la geometría.
      { id: 'hub__derecha', source: 'hub', target: 'derecha' },
      { id: 'hub__izquierda', source: 'hub', target: 'izquierda' },
    ]);

    expect(slots.get('hub__izquierda')!.sourceIndex).toBeLessThan(slots.get('hub__derecha')!.sourceIndex);
  });

  it('ignora aristas cuyos nodos no están en el layout', () => {
    const boxes = new Map([['a', box('a', 0, 0)]]);
    const slots = computeSlots(boxes, [{ id: 'a__fantasma', source: 'a', target: 'fantasma' }]);
    expect(slots.size).toBe(0);
  });
});

describe('anchorPoint', () => {
  it('reparte los puntos de forma uniforme y sin tocar las esquinas', () => {
    const target = { x: 0, y: 0, width: 100, height: 50 };
    const xs = [0, 1, 2].map((i) => anchorPoint(target, 'bottom', i, 3).x);

    expect(xs).toEqual([25, 50, 75]);
    expect(anchorPoint(target, 'bottom', 0, 3).y).toBe(50);
  });

  it('centra la única arista de un lado', () => {
    expect(anchorPoint({ x: 0, y: 0, width: 100, height: 50 }, 'top', 0, 1)).toEqual({ x: 50, y: 0 });
  });
});

describe('routeEdge', () => {
  it('empieza y termina exactamente en los anclajes pedidos', () => {
    const route = routeEdge({ x: 50, y: 50 }, 'bottom', { x: 200, y: 300 }, 'top');
    expect(route.d.startsWith('M 50.0,50.0')).toBe(true);
    expect(route.d.endsWith('L 200.0,300.0')).toBe(true);
  });

  it('sale perpendicular al nodo antes de girar', () => {
    const route = routeEdge({ x: 50, y: 50 }, 'bottom', { x: 200, y: 300 }, 'top');
    // El segundo vértice comparte la x del origen: el tramo inicial es vertical.
    expect(route.points[1]!.x).toBe(50);
    expect(route.points[1]!.y).toBeGreaterThan(50);
  });

  it('coloca la etiqueta en el punto medio del recorrido', () => {
    const route = routeEdge({ x: 0, y: 0 }, 'bottom', { x: 0, y: 400 }, 'top');
    expect(route.labelAt.x).toBeCloseTo(0, 1);
    expect(route.labelAt.y).toBeCloseTo(200, 1);
  });

  it('no genera curvas de radio cero en tramos rectos', () => {
    // Dos nodos perfectamente alineados: el recorrido debe simplificarse a una
    // recta, sin vértices intermedios que produzcan artefactos visuales.
    const route = routeEdge({ x: 100, y: 0 }, 'bottom', { x: 100, y: 200 }, 'top');
    expect(route.points).toHaveLength(2);
    expect(route.d).not.toContain('Q');
  });
});
