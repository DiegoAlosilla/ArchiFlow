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

  it('acepta figuras de catálogo e imágenes propias seguras', () => {
    const catalog = parseDiagram(minimal.replace('  - id: a', "  - id: a\n    appearance: { icon: 'azure:function-app' }"));
    expect(catalog.ok).toBe(true);
    expect(catalog.diagram?.nodes[0]?.appearance?.icon).toBe('azure:function-app');

    const custom = parseDiagram(minimal.replace('  - id: a', "  - id: a\n    appearance: { image: 'https://example.com/iphone.svg' }"));
    expect(custom.ok).toBe(true);
    expect(custom.diagram?.nodes[0]?.appearance?.image).toContain('iphone.svg');
  });

  it('rechaza esquemas peligrosos como imagen propia', () => {
    const parsed = parseDiagram(minimal.replace('  - id: a', "  - id: a\n    appearance: { image: 'javascript:alert(1)' }"));
    expect(parsed.ok).toBe(false);
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

  it('trae los ajustes de animación por omisión, en modo paso', () => {
    const ir = compile(parseDiagram('archiflow: 1\nname: A\nnodes:\n  - id: a\n').diagram!);
    // Un diagrama que no habla de animación se anima como siempre: cambiar el
    // modo por omisión cambiaría cómo se ven todos los diagramas ya escritos.
    expect(ir.animation).toEqual({
      mode: 'paso',
      speed: 1,
      packetsPerEdge: 3,
      trail: 3,
      direction: 'normal',
      cycleMs: 3000,
    });
  });

  it('lee los ajustes de animación del fichero', () => {
    const parsed = parseDiagram(
      'archiflow: 1\nname: A\nanimation:\n  mode: continuo\n  packetsPerEdge: 5\n  direction: alterna\n  trail: 0\nnodes:\n  - id: a\n',
    );
    expect(parsed.ok).toBe(true);
    const { animation } = compile(parsed.diagram!);
    expect(animation.mode).toBe('continuo');
    expect(animation.packetsPerEdge).toBe(5);
    expect(animation.direction).toBe('alterna');
    expect(animation.trail).toBe(0);
    // Lo que no se dice conserva su valor de serie.
    expect(animation.cycleMs).toBe(3000);
  });

  it('rechaza ajustes de animación fuera de rango', () => {
    const parsed = parseDiagram('archiflow: 1\nname: A\nanimation:\n  packetsPerEdge: 40\nnodes:\n  - id: a\n');
    expect(parsed.ok).toBe(false);
    expect(parsed.issues.some((issue) => issue.path?.join('.') === 'animation.packetsPerEdge')).toBe(true);
  });

  it('acepta una vista C4 explícita', () => {
    const parsed = parseDiagram('archiflow: 1\nname: Contexto\nview: c4-container\nnodes:\n  - id: sistema\n');
    expect(parsed.ok).toBe(true);
    expect(compile(parsed.diagram!).meta.view).toBe('c4-container');
  });

  it('resuelve un endpoint a la topología del servicio y conserva contratos', () => {
    const parsed = parseDiagram(`archiflow: 1\nname: Endpoints\nnodes:\n  - id: api\n  - id: cuentas\n    expanded: true\n    provides:\n      - id: listar\n        method: GET\n        path: /v1/cuentas\nflows:\n  - id: f\n    steps:\n      - from: api\n        to: cuentas/listar\n        headers:\n          - { name: Authorization, value: 'Bearer [omitido]', required: true }\n        request: '{"cliente": "1"}'\n        response: '{"cuentas": []}'\n        labelPosition: { x: 320, y: 180 }\n        layout:\n          points:\n            - { x: 250, y: 120 }\n            - { x: 250, y: 180 }\n`);
    expect(parsed.ok).toBe(true);
    const step = compile(parsed.diagram!).flows[0]!.steps[0]!;
    expect(step.to).toBe('cuentas');
    expect(step.toOp).toBe('listar');
    expect(step.request).toContain('cliente');
    expect(step.labelPosition).toEqual({ x: 320, y: 180 });
    expect(step.headers).toEqual([{ name: 'Authorization', value: 'Bearer [omitido]', required: true }]);
    expect(step.layout?.points).toHaveLength(2);
  });

  it('separa parámetros de URL, body y propósito del salto', () => {
    const parsed = parseDiagram(`${minimal.replace('op: GET /x', `op: GET /x/{customerId}
        pathParams:
          - { name: customerId, value: '123', required: true }
        queryParams:
          - { name: includeInactive, value: 'false', required: false }
        request: Sin body
        purpose: Recuperar el perfil para evaluar la solicitud
        dataUsed: [customerId, sex]`)}`);
    expect(parsed.ok).toBe(true);
    const step = compile(parsed.diagram!).flows[0]!.steps[0]!;
    expect(step.pathParams[0]?.name).toBe('customerId');
    expect(step.queryParams[0]?.required).toBe(false);
    expect(step.request).toBe('Sin body');
    expect(step.purpose).toContain('perfil');
    expect(step.dataUsed).toEqual(['customerId', 'sex']);
  });
});
