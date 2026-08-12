import { describe, expect, it } from 'vitest';
import { applyMutations } from '../src/edit/mutations.js';
import { parseDiagram } from '../src/schema/parse.js';

const source = `# Diagrama de prueba
archiflow: 1
name: Demo

zones:
  # Los canales de entrada
  - id: canales
    label: Canales

nodes:
  - id: app          # la app móvil
    kind: client
    zone: canales
  - id: bff
    kind: service
    tech: Quarkus 3

flows:
  - id: principal
    label: Flujo principal
    steps:
      - from: app
        to: bff
        op: GET /x
`;

/** Atajo: aplica y devuelve el YAML, fallando la prueba si la mutación no fue válida. */
function apply(input: string, ...mutations: Parameters<typeof applyMutations>[1]): string {
  const result = applyMutations(input, mutations);
  expect(result.error).toBeUndefined();
  return result.source!;
}

describe('preservación del fichero', () => {
  it('conserva los comentarios al modificar un campo', () => {
    const output = apply(source, { op: 'node.update', id: 'bff', patch: { label: 'BFF Cuentas' } });

    expect(output).toContain('# Diagrama de prueba');
    expect(output).toContain('# Los canales de entrada');
    expect(output).toContain('# la app móvil');
    expect(output).toContain('label: BFF Cuentas');
  });

  it('no reordena ni reformatea lo que no se toca', () => {
    const output = apply(source, { op: 'node.update', id: 'bff', patch: { tech: 'Quarkus 3.8' } });

    // El bloque de zonas debe salir intacto, carácter a carácter.
    expect(output).toContain('zones:\n  # Los canales de entrada\n  - id: canales\n    label: Canales');
  });

  it('borra la clave cuando el patch trae un valor vacío', () => {
    const output = apply(source, { op: 'node.update', id: 'bff', patch: { tech: undefined } });
    expect(output).not.toContain('tech:');
  });
});

describe('nodos', () => {
  it('renombra en cascada todas las referencias', () => {
    const output = apply(source, { op: 'node.rename', id: 'app', newId: 'app-movil' });
    const diagram = parseDiagram(output);

    expect(diagram.ok).toBe(true);
    expect(diagram.diagram?.flows[0]?.steps[0]?.from).toBe('app-movil');
    expect(output).not.toMatch(/^\s+- id: app$/m);
  });

  it('rechaza renombrar a un id que ya existe', () => {
    const result = applyMutations(source, [{ op: 'node.rename', id: 'app', newId: 'bff' }]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ya existe');
  });

  it('al borrar un nodo se lleva los pasos que lo usaban', () => {
    const output = apply(source, { op: 'node.remove', id: 'bff' });
    const diagram = parseDiagram(output);

    expect(diagram.diagram?.nodes.map((node) => node.id)).toEqual(['app']);
    expect(diagram.diagram?.flows[0]?.steps).toHaveLength(0);
  });

  it('guarda la posición fijada desde la web en una sola línea', () => {
    const output = apply(source, {
      op: 'node.update',
      id: 'bff',
      patch: { layout: { x: 120, y: 40 } },
    });
    const diagram = parseDiagram(output);

    expect(diagram.ok).toBe(true);
    expect(diagram.diagram?.nodes[1]?.layout).toEqual({ x: 120, y: 40 });
    // Estilo de flujo: tres líneas por nodo de metadatos de presentación
    // volverían el fichero ilegible.
    expect(output).toContain('layout: { x: 120, y: 40 }');
  });
});

describe('zonas', () => {
  it('al borrar una zona los nodos quedan sueltos, no se borran', () => {
    const output = apply(source, { op: 'zone.remove', id: 'canales' });
    const diagram = parseDiagram(output);

    expect(diagram.diagram?.nodes).toHaveLength(2);
    expect(diagram.diagram?.nodes[0]?.zone).toBeUndefined();
  });

  it('renombrar una zona reapunta los nodos que la referencian', () => {
    const output = apply(source, { op: 'zone.rename', id: 'canales', newId: 'entrada' });
    const diagram = parseDiagram(output);

    expect(diagram.ok).toBe(true);
    expect(diagram.diagram?.nodes[0]?.zone).toBe('entrada');
  });
});

describe('pasos', () => {
  it('inserta un paso en la posición indicada', () => {
    const output = apply(source, {
      op: 'step.add',
      flowId: 'principal',
      index: 0,
      step: { from: 'bff', to: 'app', op: 'warm-up' },
    });
    const steps = parseDiagram(output).diagram?.flows[0]?.steps;

    expect(steps?.[0]?.op).toBe('warm-up');
    expect(steps?.[1]?.op).toBe('GET /x');
  });

  it('reordena sin perder pasos', () => {
    const twoSteps = apply(source, {
      op: 'step.add',
      flowId: 'principal',
      step: { from: 'bff', to: 'app', op: 'respuesta' },
    });
    const output = apply(twoSteps, { op: 'step.move', flowId: 'principal', from: 1, to: 0 });
    const steps = parseDiagram(output).diagram?.flows[0]?.steps;

    expect(steps?.map((step) => step.op)).toEqual(['respuesta', 'GET /x']);
  });

  it('rechaza un índice de paso inexistente en vez de fallar en silencio', () => {
    const result = applyMutations(source, [{ op: 'step.remove', flowId: 'principal', index: 7 }]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no existe');
  });
});

describe('conexiones importadas', () => {
  it('permite corregir un extremo y aceptar la propuesta', () => {
    const withEdge = `${source}\nedges:\n  - from: app\n    to: bff\n    sourceInferred: true\n    note: propuesta\n`;
    const output = apply(withEdge, { op: 'edge.update', index: 0, patch: { from: 'bff', sourceInferred: undefined, note: undefined } });
    const edge = parseDiagram(output).diagram?.edges[0];
    expect(edge).toMatchObject({ from: 'bff', to: 'bff', sourceInferred: false });
    expect(edge?.note).toBeUndefined();
  });
});

describe('atomicidad', () => {
  it('no aplica nada si una mutación del lote falla', () => {
    const result = applyMutations(source, [
      { op: 'node.update', id: 'bff', patch: { label: 'Cambiado' } },
      { op: 'node.remove', id: 'inexistente' },
    ]);

    expect(result.ok).toBe(false);
    expect(result.source).toBeUndefined();
  });
});

describe('resultado válido', () => {
  it('el YAML producido sigue pasando el validador', () => {
    const output = apply(
      source,
      { op: 'node.add', node: { id: 'db', kind: 'database', zone: 'canales' } },
      { op: 'step.add', flowId: 'principal', step: { from: 'bff', to: 'db', protocol: 'jdbc' } },
    );

    const diagram = parseDiagram(output);
    expect(diagram.ok).toBe(true);
    expect(diagram.issues.filter((issue) => issue.level === 'error')).toHaveLength(0);
  });
});
