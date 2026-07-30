import { describe, expect, it } from 'vitest';
import { compile } from '../src/schema/compile.js';
import { parseDiagram } from '../src/schema/parse.js';

const minimal = `
archiflow: 1
name: Demo
nodes:
  - id: a
  - id: b
  - id: c
flows:
  - id: f
    steps:
      - from: a
        to: b
        op: GET /x
      - from: b
        to: c
        op: publish evento
        async: true
`;

describe('parseDiagram', () => {
  it('acepta un diagrama mínimo y aplica los valores por defecto', () => {
    const result = parseDiagram(minimal);
    expect(result.ok).toBe(true);
    expect(result.diagram?.nodes[0]?.kind).toBe('service');
    expect(result.diagram?.flows[0]?.steps[0]?.protocol).toBe('http');
  });

  it('señala la línea de una referencia a un nodo inexistente', () => {
    const result = parseDiagram(minimal.replace('to: c', 'to: fantasma'));
    expect(result.ok).toBe(false);
    const issue = result.issues.find((candidate) => candidate.message.includes('fantasma'));
    expect(issue?.level).toBe('error');
    expect(issue?.line).toBeGreaterThan(0);
  });

  it('rechaza claves desconocidas en vez de ignorarlas en silencio', () => {
    const result = parseDiagram(`${minimal}\nnodos: []\n`);
    expect(result.ok).toBe(false);
  });

  it('avisa de un nodo que no participa en ningún flujo', () => {
    const result = parseDiagram(`${minimal}\n  - id: huerfano\n`.replace('flows:', 'flows:'));
    const orphanWarning = parseDiagram(
      minimal.replace('  - id: c\n', '  - id: c\n  - id: huerfano\n'),
    ).issues.find((issue) => issue.message.includes('huerfano'));
    expect(orphanWarning?.level).toBe('warning');
    expect(result).toBeDefined();
  });

  it('informa de la posición cuando el YAML está mal formado', () => {
    const result = parseDiagram('name: [sin cerrar\n');
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.line).toBeGreaterThan(0);
  });
});

describe('compile', () => {
  const ir = compile(parseDiagram(minimal).diagram!);

  it('infiere las aristas desde los pasos, sin declararlas', () => {
    expect(ir.edges.map((edge) => edge.id)).toEqual(['a__b', 'b__c']);
    expect(ir.edges[0]?.labels).toEqual(['GET /x']);
  });

  it('marca como asíncrona solo la arista que siempre lo es', () => {
    expect(ir.edges[0]?.async).toBe(false);
    expect(ir.edges[1]?.async).toBe(true);
  });

  it('encadena los pasos síncronos y solapa los asíncronos', () => {
    const [first, second] = ir.flows[0]!.steps;
    expect(first!.startMs).toBe(0);
    // El segundo paso empieza cuando termina el primero (más el respiro).
    expect(second!.startMs).toBeGreaterThanOrEqual(first!.durationMs);
  });

  it('deriva el punto de entrada del primer paso cuando no se declara', () => {
    expect(ir.flows[0]?.entry).toBe('a');
  });

  it('reutiliza una arista recorrida por varios flujos', () => {
    const shared = compile(
      parseDiagram(
        `${minimal}\n  - id: g\n    steps:\n      - from: a\n        to: b\n        op: GET /y\n`,
      ).diagram!,
    );
    const edge = shared.edges.find((candidate) => candidate.id === 'a__b')!;
    expect(edge.flows).toEqual(['f', 'g']);
    expect(edge.labels).toEqual(['GET /x', 'GET /y']);
  });

  it('escala la duración con la latencia sin volverla inservible', () => {
    const withLatency = compile(
      parseDiagram(minimal.replace('op: GET /x', 'op: GET /x\n        latencyMs: 5000')).diagram!,
    );
    // 5 s reales no pueden durar 5 s de animación.
    expect(withLatency.flows[0]!.steps[0]!.durationMs).toBeLessThanOrEqual(2600);
  });

  it('resuelve un endpoint a la topología del servicio y conserva contratos', () => {
    const parsed = parseDiagram(`archiflow: 1\nname: Endpoints\nnodes:\n  - id: api\n  - id: cuentas\n    expanded: true\n    provides:\n      - id: listar\n        method: GET\n        path: /v1/cuentas\nflows:\n  - id: f\n    steps:\n      - from: api\n        to: cuentas/listar\n        request: '{"cliente": "1"}'\n        response: '{"cuentas": []}'\n`);
    expect(parsed.ok).toBe(true);
    const step = compile(parsed.diagram!).flows[0]!.steps[0]!;
    expect(step.to).toBe('cuentas');
    expect(step.toOp).toBe('listar');
    expect(step.request).toContain('cliente');
  });
});
