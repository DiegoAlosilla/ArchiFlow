import { inflateRawSync } from 'node:zlib';
import { findAll, parseXml, unescapeXml, type XmlNode } from './xml.js';
import {
  guessKind,
  guessProtocol,
  parseOrder,
  styleTokens,
  type ImportEvidence,
} from './evidence.js';

/**
 * Lectura de ficheros de draw.io (mxGraph).
 *
 * Produce **evidencias**, no un diagrama: geometría, estilos y etiquetas tal
 * como estaban, más la deducción de tipo con su motivo. Quien decide qué es
 * cada cosa —y sobre todo en qué orden ocurren los pasos, que un diagrama
 * estático no contiene— es la skill de importación.
 */

/**
 * draw.io guarda el modelo comprimido salvo que se marque "Comprimido: no".
 * Es base64 de un deflate crudo cuyo resultado va además URL-encoded, y es la
 * razón por la que abrir un `.drawio` en un editor suele mostrar una sola línea
 * ilegible. Sin deshacer esto no hay nada que importar.
 */
function inflateDiagram(payload: string): string | null {
  try {
    const raw = inflateRawSync(Buffer.from(payload.trim(), 'base64')).toString('binary');
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Las etiquetas llevan HTML de mxGraph: se convierte a texto plano. */
function plainText(value: string): string {
  return unescapeXml(
    value
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(div|p|li|tr)>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

interface Cell {
  id: string;
  label: string;
  style: string;
  parent?: string;
  source?: string;
  target?: string;
  vertex: boolean;
  edge: boolean;
  geometry: { x: number; y: number; width: number; height: number };
}

function readCells(root: XmlNode[]): Cell[] {
  const cells: Cell[] = [];

  // Un cell dentro de <object>/<UserObject> hereda de él id y etiqueta: es como
  // draw.io guarda las formas con propiedades personalizadas.
  const wrappers = new Map<XmlNode, XmlNode>();
  for (const node of [...findAll(root, 'object'), ...findAll(root, 'UserObject')]) {
    for (const child of node.children) if (child.tag === 'mxCell') wrappers.set(child, node);
  }

  for (const node of findAll(root, 'mxCell')) {
    const wrapper = wrappers.get(node);
    const geometry = node.children.find((child) => child.tag === 'mxGeometry');
    cells.push({
      id: wrapper?.attrs.id ?? node.attrs.id ?? '',
      label: plainText(wrapper?.attrs.label ?? node.attrs.value ?? ''),
      style: node.attrs.style ?? '',
      parent: node.attrs.parent,
      source: node.attrs.source,
      target: node.attrs.target,
      vertex: node.attrs.vertex === '1',
      edge: node.attrs.edge === '1',
      geometry: {
        x: Number(geometry?.attrs.x ?? 0),
        y: Number(geometry?.attrs.y ?? 0),
        width: Number(geometry?.attrs.width ?? 0),
        height: Number(geometry?.attrs.height ?? 0),
      },
    });
  }

  return cells;
}

const CONTAINER = /swimlane|container=1|childlayout|shape=mxgraph\.(lean_mapping|folder)/i;
/** Cajas que no son elementos: rótulos sueltos, imágenes y maquetas. */
const ANNOTATION = /^text;|;text;|shape=note|label=/i;
const IMAGE = /shape=image|image=data:|sketch=|mxgraph\.mockup|shape=mxgraph\.(android|ios)/i;

export function fromDrawio(source: string): ImportEvidence {
  const evidence: ImportEvidence = { format: 'drawio', pages: [], shapes: [], links: [], warnings: [] };
  const document = parseXml(source);
  const diagrams = findAll(document, 'diagram');

  // Un fichero sin <diagram> puede ser un mxGraphModel suelto, que es lo que
  // se obtiene al copiar del lienzo o al exportar desde algunas herramientas.
  const pages = diagrams.length > 0 ? diagrams : [{ attrs: { id: 'p1', name: 'Página 1' }, children: document, text: '', tag: 'diagram' }];

  for (const [index, page] of pages.entries()) {
    let content: XmlNode[] = page.children;
    if (page.text && page.children.length === 0) {
      const expanded = inflateDiagram(page.text);
      if (!expanded) {
        evidence.warnings.push(`La página '${page.attrs.name ?? index + 1}' viene comprimida y no se ha podido descomprimir; se omite.`);
        continue;
      }
      content = parseXml(expanded);
    }

    const cells = readCells(content).filter((cell) => cell.id !== '0' && cell.id !== '1');
    const pageId = page.attrs.id ?? `p${index + 1}`;
    const pageName = page.attrs.name ?? `Página ${index + 1}`;
    const pageShapes: string[] = [];

    // Las etiquetas de arista son celdas hijas del propio enlace.
    const edgeLabels = new Map<string, string>();
    for (const cell of cells) {
      if (/edgelabel/i.test(cell.style) && cell.parent && cell.label) {
        edgeLabels.set(cell.parent, [edgeLabels.get(cell.parent), cell.label].filter(Boolean).join(' '));
      }
    }

    const hasChildren = new Set(cells.map((cell) => cell.parent).filter(Boolean) as string[]);

    for (const cell of cells) {
      if (cell.edge) {
        const label = cell.label || edgeLabels.get(cell.id) || '';
        evidence.links.push({
          id: cell.id,
          label,
          source: cell.source,
          target: cell.target,
          style: cell.style,
          protocol: guessProtocol(label, cell.style),
          async: styleTokens(cell.style).has('dashed') || /event|publish|consume|async/i.test(label),
          order: parseOrder(label),
        });
        continue;
      }

      if (!cell.vertex) continue;
      if (/edgelabel/i.test(cell.style)) continue;

      if (IMAGE.test(cell.style)) {
        evidence.warnings.push(`Se descarta '${cell.label || cell.id}': es una imagen o maqueta de pantalla, que no tiene equivalente en el modelo.`);
        continue;
      }

      const container = CONTAINER.test(cell.style) || (hasChildren.has(cell.id) && cell.geometry.width > 300);

      if (!container && isAnnotation(cell.style, cell.label)) {
        evidence.warnings.push(`Se descarta el rótulo suelto '${cell.label || cell.id}'.`);
        continue;
      }

      const guess = guessKind(cell.label, cell.style);
      pageShapes.push(cell.id);
      evidence.shapes.push({
        id: cell.id,
        label: cell.label,
        style: cell.style,
        x: cell.geometry.x,
        y: cell.geometry.y,
        width: cell.geometry.width,
        height: cell.geometry.height,
        parent: cell.parent && cell.parent !== '1' ? cell.parent : undefined,
        container,
        kind: guess.kind,
        confidence: guess.confidence,
        reason: guess.reason,
        external: styleTokens(cell.style).get('dashed') === '1' && !container,
      });
    }

    evidence.pages.push({ id: pageId, name: pageName, shapes: pageShapes });
  }

  const known = new Set(evidence.shapes.map((shape) => shape.id));
  const dangling = evidence.links.filter((link) => !known.has(link.source ?? '') || !known.has(link.target ?? ''));
  if (dangling.length > 0) {
    evidence.warnings.push(`${dangling.length} flecha(s) apuntan a algo que no se ha importado —una imagen, un rótulo o un extremo suelto— y se omiten.`);
  }
  evidence.links = evidence.links.filter((link) => !dangling.includes(link));

  return evidence;
}

/** Un rótulo suelto: estilo de texto y sin forma detrás. */
function isAnnotation(style: string, label: string): boolean {
  return ANNOTATION.test(style) && label.length > 0 && !/fillcolor/i.test(style);
}
