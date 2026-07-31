import { Document } from 'yaml';
import { stripOrder, type ImportEvidence, type ImportedShape } from './evidence.js';

/**
 * De evidencias a un `.arch.yaml` **borrador**.
 *
 * Es un borrador y hay que decirlo, no insinuarlo: el fichero sale con una
 * cabecera de avisos que enumera todo lo deducido. Es la misma postura que el
 * ADR-001 sostiene para el escaneo de código, y la que el ADR-003 fija para
 * este importador: se acierta mucho y se falla algo, y presentarlo como verdad
 * quema la confianza en la herramienta entera.
 *
 * Aquí sí se serializa YAML desde un objeto —lo que la invariante 1 prohíbe—
 * porque el fichero **no existe todavía**: no hay comentarios ni formato del
 * usuario que destruir. A partir de la primera edición manda `src/edit`.
 */

/** Un id válido para el esquema, derivado de la etiqueta. */
function toId(label: string, fallback: string): string {
  const slug = label
    .normalize('NFD')
    // Fuera los diacríticos: 'Autenticación' → 'autenticacion'.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return /^[a-z0-9]/.test(slug) ? slug : `n-${fallback.replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** Ids únicos: dos cajas pueden llamarse igual en un diagrama dibujado a mano. */
function uniqueIds(shapes: ImportedShape[]): Map<string, string> {
  const used = new Set<string>();
  const ids = new Map<string, string>();
  for (const shape of shapes) {
    const base = toId(shape.label, shape.id);
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    ids.set(shape.id, id);
  }
  return ids;
}

export interface DraftOptions {
  /** Nombre del diagrama; por omisión, el de la primera página. */
  name?: string;
}

export interface Draft {
  yaml: string;
  /** Lo mismo que va en la cabecera del fichero, para poder imprimirlo. */
  warnings: string[];
}

export function toDraft(evidence: ImportEvidence, options: DraftOptions = {}): Draft {
  const ids = uniqueIds(evidence.shapes);
  const containers = evidence.shapes.filter((shape) => shape.container);
  const nodes = evidence.shapes.filter((shape) => !shape.container);

  const zoneOf = (shape: ImportedShape): string | undefined => {
    // El contenedor puede estar a más de un nivel: se sube hasta encontrar uno.
    let current = shape.parent;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const parent = evidence.shapes.find((candidate) => candidate.id === current);
      if (!parent) return undefined;
      if (parent.container) return ids.get(parent.id);
      current = parent.parent;
    }
    return undefined;
  };

  const warnings = [...evidence.warnings];

  const guessed = nodes.filter((shape) => shape.confidence !== 'alta');
  if (guessed.length > 0) {
    warnings.push(
      `Tipo deducido con dudas en ${guessed.length} caja(s): ${guessed
        .slice(0, 8)
        .map((shape) => `${ids.get(shape.id)} → ${shape.kind} (${shape.reason})`)
        .join('; ')}${guessed.length > 8 ? '; …' : ''}`,
    );
  }

  // Orden de los pasos. Si quien dibujó numeró las flechas, esa numeración es
  // la única fuente fiable; si no, se ordena por posición del origen, que
  // acierta en los diagramas que se leen de arriba abajo y falla en el resto.
  const numbered = evidence.links.filter((link) => link.order !== undefined);
  const byPosition = new Map(evidence.shapes.map((shape) => [shape.id, shape.y * 10_000 + shape.x]));
  const links = [...evidence.links].sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    return (byPosition.get(a.source ?? '') ?? 0) - (byPosition.get(b.source ?? '') ?? 0);
  });

  if (links.length > 0) {
    warnings.push(
      numbered.length === links.length
        ? 'El orden de los pasos sale de la numeración de las flechas.'
        : numbered.length > 0
          ? `Solo ${numbered.length} de ${links.length} flechas venían numeradas; el resto se ha ordenado por posición y hay que revisarlo.`
          : 'Ninguna flecha venía numerada: los pasos van ordenados por posición en el lienzo, que es una conjetura. Revisa el orden antes de dar el diagrama por bueno.',
    );
  }

  const document = new Document({
    archiflow: 1,
    name: options.name ?? evidence.pages[0]?.name ?? 'Diagrama importado',
    description: `Borrador importado de ${evidence.format === 'drawio' ? 'draw.io' : 'ArchiMate'}. Revísalo antes de usarlo.`,
    ...(containers.length > 0
      ? {
          zones: containers.map((zone) => ({ id: ids.get(zone.id)!, label: zone.label || ids.get(zone.id)! })),
        }
      : {}),
    nodes: nodes.map((shape) => {
      const zone = zoneOf(shape);
      return {
        id: ids.get(shape.id)!,
        label: shape.label || ids.get(shape.id)!,
        kind: shape.kind,
        ...(zone ? { zone } : {}),
        ...(shape.external ? { external: true } : {}),
      };
    }),
    ...(links.length > 0
      ? {
          flows: [
            {
              id: 'importado',
              label: 'Recorrido importado',
              steps: links.map((link) => {
                const op = stripOrder(link.label);
                return {
                  from: ids.get(link.source ?? '')!,
                  to: ids.get(link.target ?? '')!,
                  ...(op ? { op } : {}),
                  protocol: link.protocol,
                  ...(link.async ? { async: true } : {}),
                };
              }),
            },
          ],
        }
      : {}),
  });

  document.commentBefore = [
    ' BORRADOR generado por `archiflow import`. No es una traducción exacta.',
    '',
    ...warnings.map((warning) => ` · ${warning}`),
    '',
    ' Revisa tipos, zonas y sobre todo el ORDEN de los pasos, y borra estos',
    ' comentarios cuando el diagrama sea tuyo.',
  ].join('\n');

  return { yaml: document.toString({ lineWidth: 0 }), warnings };
}
