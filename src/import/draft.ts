import { Document } from 'yaml';
import { stripOrder, styleTokens, type ImportEvidence, type ImportedShape } from './evidence.js';

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
  const referencedShapeIds = new Set(
    evidence.links.flatMap((link) => [link.source, link.target]).filter((id): id is string => Boolean(id)),
  );
  // Un grupo lógico viaja en `evidence.shapes` para resolver los padres, pero
  // no puede convertirse en zona: en draw.io no tenía forma ni pintura.
  // Una caja conectada es un elemento del flujo aunque por tamaño parezca un
  // contenedor. Convertirla en zona hacía que desapareciera de `nodes` y
  // dejaba aristas inválidas en diagramas corporativos grandes.
  const containers = evidence.shapes.filter(
    (shape) => shape.renderKind === 'visible-container' && !referencedShapeIds.has(shape.id),
  );
  const nodes = evidence.shapes.filter((shape) =>
    (shape.renderKind !== 'visible-container' || referencedShapeIds.has(shape.id)) &&
    shape.renderKind !== 'invisible-group' &&
    // Si un texto es el título de un rectángulo visible, el título se dibuja
    // con el contenedor; duplicarlo como tarjeta crea el falso nodo "BADI".
    !(shape.renderKind === 'label' && containers.some((container) =>
      container.label === shape.label &&
      shape.x >= container.x && shape.y >= container.y &&
      shape.x + shape.width <= container.x + container.width &&
      shape.y + shape.height <= container.y + container.height,
    )),
  );
  const containerByArchId = new Map(containers.map((shape) => [ids.get(shape.id)!, shape]));

  const zoneOf = (shape: ImportedShape): string | undefined => {
    // El contenedor puede estar a más de un nivel: se sube hasta encontrar uno.
    let current = shape.parent;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const parent = evidence.shapes.find((candidate) => candidate.id === current);
      // Los grupos Draw.io son puramente gráficos y no siempre se exportan
      // como shapes. Si falta uno, aún podemos deducir la zona por geometría.
      if (!parent) break;
      if (parent.renderKind === 'visible-container') return ids.get(parent.id);
      current = parent.parent;
    }

    // Los diagramas exportados por algunas plantillas Azure dibujan la nube o
    // el dominio como un gran rectángulo de fondo, sin hacer a las celdas hijas
    // de él. Conservamos igualmente esa agrupación visual como zona, eligiendo
    // el contenedor geométrico más pequeño que envuelve la forma.
    const containing = containers
      .filter(
        (container) =>
          container.id !== shape.id &&
          shape.x >= container.x &&
          shape.y >= container.y &&
          shape.x + shape.width <= container.x + container.width &&
          shape.y + shape.height <= container.y + container.height,
      )
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    if (containing) return ids.get(containing.id);
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
          : 'Ninguna flecha venía numerada: la posición del lienzo no demuestra el orden de ejecución. Revisa los escenarios antes de animarlos.',
    );
  }
  const degree = new Map<string, { incoming: number; outgoing: number }>();
  for (const link of links) {
    if (!link.source || !link.target) continue;
    const source = degree.get(link.source) ?? { incoming: 0, outgoing: 0 };
    const target = degree.get(link.target) ?? { incoming: 0, outgoing: 0 };
    source.outgoing += 1;
    target.incoming += 1;
    degree.set(link.source, source);
    degree.set(link.target, target);
  }
  const simpleChain =
    links.length > 0 &&
    [...degree.values()].every((entry) => entry.incoming <= 1 && entry.outgoing <= 1) &&
    [...degree.values()].filter((entry) => entry.incoming === 0 && entry.outgoing > 0).length === 1;
  const createImportedFlow = numbered.length === links.length || simpleChain;
  if (links.length > 0 && !createImportedFlow) {
    warnings.push('Las relaciones se conservan, pero no se crea un flujo gigante sin orden verificable. Separa y nombra los escenarios antes de animarlos.');
  }

  const document = new Document({
    archiflow: 1,
    name: options.name ?? evidence.pages[0]?.name ?? 'Diagrama importado',
    description: `Borrador importado de ${evidence.format === 'drawio' ? 'draw.io' : 'ArchiMate'}. Revísalo antes de usarlo.`,
    layoutMode: evidence.format === 'drawio' ? 'faithful' : 'auto',
    ...(containers.length > 0
      ? {
          zones: containers.map((zone) => ({
            id: ids.get(zone.id)!,
            label: zone.label,
            ...(colorFromStyle(zone.style) ? { color: colorFromStyle(zone.style) } : {}),
            ...(appearanceFromStyle(zone.style) ? { appearance: appearanceFromStyle(zone.style) } : {}),
            layout: {
              x: Math.round(zone.x),
              y: Math.round(zone.y),
              width: Math.max(200, Math.round(zone.width)),
              height: Math.max(120, Math.round(zone.height)),
            },
          })),
        }
      : {}),
    nodes: nodes.map((shape) => {
      const zone = zoneOf(shape);
      const zoneShape = zone ? containerByArchId.get(zone) : undefined;
      // El layout de un hijo de zona es relativo; el de un nodo suelto es
      // absoluto. Así la importación conserva la composición original.
      const x = Math.round(shape.x - (zoneShape?.x ?? 0));
      const y = Math.round(shape.y - (zoneShape?.y ?? 0));
      return {
        id: ids.get(shape.id)!,
        label: shape.label || ids.get(shape.id)!,
        kind: shape.kind,
        ...(zone ? { zone } : {}),
        ...(shape.drawioIcon ? { tech: techFromIcon(shape.drawioIcon) } : {}),
        tags: [
          'drawio:faithful',
          `drawio:render:${shape.renderKind}`,
          ...(shape.drawioIcon ? [`drawio:${shape.drawioIcon}`] : []),
          ...(shape.hideLabel ? ['drawio:hide-label'] : []),
        ],
        ...(shape.external ? { external: true } : {}),
        ...(appearanceFromStyle(shape.style) ? { appearance: appearanceFromStyle(shape.style) } : {}),
        layout: {
          x,
          y,
          width: Math.max(1, Math.round(shape.width)),
          height: Math.max(1, Math.round(shape.height)),
        },
      };
    }),
    ...(links.length > 0
      ? {
          edges: links.map((link) => ({
            from: ids.get(link.source ?? '')!,
            to: ids.get(link.target ?? '')!,
            ...(stripOrder(link.label) ? { label: stripOrder(link.label) } : {}),
            protocol: link.protocol,
            ...(link.async ? { async: true } : {}),
            ...(link.sourceInferred ? { sourceInferred: true } : {}),
            ...(link.targetInferred ? { targetInferred: true } : {}),
            ...(link.sourceInferred || link.targetInferred
              ? { note: `Propuesta geométrica para la flecha Draw.io ${link.id}; revisar el extremo ${[link.sourceInferred ? 'origen' : '', link.targetInferred ? 'destino' : ''].filter(Boolean).join(' y ')}.` }
              : {}),
            ...(link.geometry || link.anchors || link.startArrow || link.endArrow
              ? {
                  layout: {
                    ...(link.geometry?.sourcePoint ? { sourcePoint: link.geometry.sourcePoint } : {}),
                    ...(link.geometry?.targetPoint ? { targetPoint: link.geometry.targetPoint } : {}),
                    ...(link.geometry?.points.length ? { points: link.geometry.points } : {}),
                    ...(link.anchors?.source ? { sourceAnchor: link.anchors.source } : {}),
                    ...(link.anchors?.target ? { targetAnchor: link.anchors.target } : {}),
                    ...(link.startArrow ? { startArrow: link.startArrow } : {}),
                    ...(link.endArrow ? { endArrow: link.endArrow } : {}),
                    style: link.style,
                  },
                }
              : {}),
          })),
          ...(createImportedFlow
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

/** La etiqueta se conserva; `tech` hace visible de qué icono venía el nodo. */
function techFromIcon(icon: string): string {
  const names: Record<string, string> = {
    'azure-cosmos-db': 'Azure Cosmos DB',
    firestore: 'Firestore',
    'event-hubs': 'Azure Event Hubs',
    'api-management': 'Azure API Management',
    'application-gateway': 'Application Gateway',
    'front-doors': 'Azure Front Door',
    'kubernetes-services': 'Kubernetes Service',
  };
  return names[icon] ?? `Draw.io: ${icon.replace(/-/g, ' ')}`;
}

/** Conserva el color más informativo de un contenedor Draw.io. */
function colorFromStyle(style: string): string | undefined {
  const token = style
    .split(';')
    .map((part) => part.split('='))
    .find(([key]) => key?.toLowerCase() === 'fillcolor' || key?.toLowerCase() === 'strokecolor')?.[1];
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(token ?? '') ? token : undefined;
}

/** Traduce los tokens visuales portables de mxGraph sin guardar imágenes. */
function appearanceFromStyle(style: string) {
  const tokens = styleTokens(style);
  const color = (key: string): string | undefined => {
    const value = tokens.get(key);
    return value && /^(?:none|#[0-9a-f]{3}|#[0-9a-f]{6})$/i.test(value) ? value : undefined;
  };
  const number = (key: string): number | undefined => {
    const value = Number(tokens.get(key));
    return Number.isFinite(value) ? value : undefined;
  };
  const align = tokens.get('align');
  const verticalAlign = tokens.get('verticalalign');
  const fontStyle = Number(tokens.get('fontstyle') ?? 0);
  const rounded = tokens.get('rounded') === '1';
  const arcSize = number('arcsize');
  const shape = tokens.has('module') || tokens.get('shape') === 'module'
    ? 'module'
    : tokens.has('umlframe') || tokens.get('shape') === 'umlFrame'
      ? 'uml-frame'
      : tokens.has('note') || tokens.get('shape') === 'note'
        ? 'note'
        : undefined;
  const appearance = {
    ...(color('fillcolor') ? { fill: color('fillcolor') } : {}),
    ...(color('strokecolor') ? { stroke: color('strokecolor') } : {}),
    ...(color('fontcolor') ? { text: color('fontcolor') } : {}),
    ...(number('fontsize') ? { fontSize: number('fontsize') } : {}),
    ...(tokens.get('fontfamily') ? { fontFamily: tokens.get('fontfamily') } : {}),
    ...(fontStyle & 1 ? { bold: true } : {}),
    ...(fontStyle & 2 ? { italic: true } : {}),
    ...(rounded ? { radius: Math.max(3, Math.round((arcSize ?? 15) / 5)) } : {}),
    ...(number('opacity') !== undefined ? { opacity: Math.max(0, Math.min(1, number('opacity')! / 100)) } : {}),
    ...(tokens.get('dashed') === '1' ? { dashed: true } : {}),
    ...(align === 'left' || align === 'center' || align === 'right' ? { align } : {}),
    ...(verticalAlign === 'top' || verticalAlign === 'middle' || verticalAlign === 'bottom'
      ? { verticalAlign }
      : {}),
    ...(shape ? { shape } : {}),
    ...(number('strokewidth') ? { strokeWidth: number('strokewidth') } : {}),
    ...(shape === 'uml-frame' && number('width') ? { frameWidth: number('width') } : {}),
    ...(shape === 'uml-frame' && number('height') ? { frameHeight: number('height') } : {}),
  };
  return Object.keys(appearance).length > 0 ? appearance : undefined;
}
