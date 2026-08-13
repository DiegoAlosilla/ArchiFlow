/** Qué está seleccionado en el editor. `null` es "nada". */
export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'operation'; nodeId: string; index: number }
  | { kind: 'zone'; id: string }
  | { kind: 'flow'; id: string }
  | { kind: 'step'; flowId: string; index: number }
  | { kind: 'edge'; index: number }
  | null;

export function sameSelection(a: Selection, b: Selection): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'step' && b.kind === 'step') return a.flowId === b.flowId && a.index === b.index;
  if (a.kind === 'edge' && b.kind === 'edge') return a.index === b.index;
  if (a.kind === 'operation' && b.kind === 'operation') return a.nodeId === b.nodeId && a.index === b.index;
  return 'id' in a && 'id' in b && a.id === b.id;
}
