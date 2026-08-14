import { describe, expect, it } from 'vitest';
import { compile, focusIrOnFlow, mergeIrs } from '../src/schema/index.js';
import { parseDiagram } from '../src/schema/parse.js';

function diagram(name: string, flow: string, target: string) {
  return compile(parseDiagram(`archiflow: 1
name: ${name}
nodes:
  - id: canal
    kind: client
  - id: clientes
    expanded: true
    provides:
      - { id: consultar, method: GET, path: '/clientes/{id}' }
  - id: ${target}
flows:
  - id: ${flow}
    steps:
      - from: canal
        to: clientes/consultar
      - from: clientes/consultar
        to: ${target}
`).diagram!);
}

describe('mergeIrs', () => {
  it('consolida nodos compartidos y conserva todos los flujos con ids únicos', () => {
    const merged = mergeIrs([
      { id: 'repo-a', name: 'Repo A', ir: diagram('A', 'consultar', 'redis') },
      { id: 'repo-b', name: 'Repo B', ir: diagram('B', 'consultar', 'postgres') },
    ]);

    expect(merged.nodes.filter((node) => node.id === 'clientes')).toHaveLength(1);
    expect(merged.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['redis', 'postgres']));
    expect(merged.flows.map((flow) => flow.id)).toEqual(['repo-a--consultar', 'repo-b--consultar']);
    expect(merged.flows[0]?.label).toContain('Repo A');
    expect(merged.meta.layoutMode).toBe('auto');

    const focused = focusIrOnFlow(merged, 'repo-b--consultar');
    expect(focused.flows).toHaveLength(1);
    expect(focused.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['canal', 'clientes', 'postgres']));
    expect(focused.nodes.some((node) => node.id === 'redis')).toBe(false);
  });
});
