import { fromArchimate } from './archimate.js';
import { fromDrawio } from './drawio.js';
import type { ImportEvidence } from './evidence.js';

export * from './evidence.js';
export { fromDrawio } from './drawio.js';
export { fromArchimate } from './archimate.js';
export { toDraft, type Draft } from './draft.js';

/**
 * Elige el lector por el contenido, no por la extensión: los dos formatos usan
 * `.xml` a menudo, y un `.drawio` renombrado sigue siendo un mxfile.
 */
export function detectFormat(source: string): ImportEvidence['format'] | null {
  const head = source.slice(0, 4000);
  if (/<mxfile|<mxGraphModel/i.test(head)) return 'drawio';
  if (/opengroup\.org\/xsd\/archimate|<archimate:model|<model[^>]*identifier=/i.test(head)) return 'archimate';
  return null;
}

export function importDiagram(source: string): ImportEvidence {
  const format = detectFormat(source);
  if (format === 'drawio') return fromDrawio(source);
  if (format === 'archimate') return fromArchimate(source);
  throw new Error('el fichero no parece un .drawio (mxGraph) ni un ArchiMate Open Exchange');
}
