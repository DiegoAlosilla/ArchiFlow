import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDiagram, validateScanContract } from '../src/schema/index.js';

describe('validateScanContract', () => {
  it('aprueba el ejemplo canónico completo de la skill', async () => {
    const source = await readFile(new URL('../skills/archiflow-scan/references/complete-endpoint-example.arch.yaml', import.meta.url), 'utf8');
    const parsed = parseDiagram(source);
    expect(parsed.ok).toBe(true);
    expect(validateScanContract(parsed.diagram!)).toEqual([]);
  });

  it('rechaza flechas sin endpoint, retorno, purpose y params estructurados', () => {
    const parsed = parseDiagram(`archiflow: 1
name: Incompleto
nodes:
  - { id: canal, kind: client }
  - id: api
    kind: service
    provides:
      - { id: consultar, method: GET, path: '/clientes/{customerId}' }
  - { id: redis, kind: cache }
flows:
  - id: consultar
    steps:
      - from: canal
        to: api
        op: GET /clientes/{customerId}?active=true
        request: customerId=123
      - from: api
        to: redis
        request: customer:123
`).diagram!;
    const messages = validateScanContract(parsed).map((issue) => issue.message).join('\n');
    expect(messages).toContain('operación concreta');
    expect(messages).toContain('path param');
    expect(messages).toContain('query string');
    expect(messages).toContain('flecha de retorno');
    expect(messages).toContain('purpose');
    expect(messages).toContain('cerrar volviendo');
  });
});
