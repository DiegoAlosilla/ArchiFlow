import { inflateRawSync } from 'node:zlib';
import { findAll, parseXml, unescapeXml, type XmlNode } from './xml.js';
import {
  guessKind,
  guessProtocol,
  parseOrder,
  styleTokens,
  drawioIconName,
  techForDrawioIcon,
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
  geometry: {
    x: number; y: number; width: number; height: number;
    sourcePoint?: { x: number; y: number };
    targetPoint?: { x: number; y: number };
    points: { x: number; y: number }[];
  };
}

function point(node: XmlNode | undefined): { x: number; y: number } | undefined {
  if (!node || node.attrs.x === undefined || node.attrs.y === undefined) return undefined;
  return { x: Number(node.attrs.x), y: Number(node.attrs.y) };
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
    const geometryChildren = geometry?.children ?? [];
    const points = geometryChildren.find((child) => child.tag === 'Array' && child.attrs.as === 'points')?.children
      .filter((child) => child.tag === 'mxPoint')
      .map(point)
      .filter((candidate): candidate is { x: number; y: number } => Boolean(candidate)) ?? [];
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
        sourcePoint: point(geometryChildren.find((child) => child.attrs.as === 'sourcePoint')),
        targetPoint: point(geometryChildren.find((child) => child.attrs.as === 'targetPoint')),
        points,
      },
    });
  }

  return cells;
}

const CONTAINER = /swimlane|container=1|childlayout|(?:^|;)group(?:;|$)|shape=mxgraph\.(lean_mapping|folder)/i;
/** Cajas que no son elementos: rótulos sueltos, imágenes y maquetas. */
const ANNOTATION = /^text;|;text;|shape=note|label=/i;
/** Capturas/maquetas: no son iconos de infraestructura importables. */
const SCREEN_OR_MOCKUP = /image=data:|sketch=|mxgraph\.mockup|shape=mxgraph\.(android|ios)/i;
const ALWAYS_DECORATIVE = /mxgraph\.mockup|shape=mxgraph\.(android|ios)/i;

/** Reconoce un icono embebido cuando un rótulo hermano aporta su semántica. */
function embeddedVisualName(style: string, label: string): string | undefined {
  if (!/shape=image|shape=mxgraph\.[^;]*firewall|(?:^|;)image(?:;|$)|image=data:/i.test(style)) return undefined;
  const source = `${style} ${label}`.toLowerCase();
  if (/firewall|\bwaf\b/.test(source)) return 'firewall';
  if (/application gateway/.test(source)) return 'application-gateway';
  if (/front door/.test(source)) return 'front-doors';
  if (/firestore/.test(source)) return 'firestore';
  // Los logotipos horizontales incrustados dentro de APIs son el marcador
  // Spring del autor; no se confunden con el canal móvil del nombre de la API.
  if (/«?api\s+(ux|bs)»?/i.test(label) && /image=data:/i.test(style)) return 'spring';
  if (/frontend|android|\bios\b|mobile/.test(source) && /shape=image|mxgraph\.(android|ios)|image=data:/i.test(style)) return 'mobile';
  return undefined;
}

function isVisiblePaint(style: string): boolean {
  const tokens = styleTokens(style);
  const fill = tokens.get('fillcolor');
  const stroke = tokens.get('strokecolor');
  const opacity = Number(tokens.get('opacity') ?? tokens.get('fillopacity') ?? '100');
  const group = tokens.has('group');
  const swimlane = tokens.has('swimlane');
  const textOnly = ANNOTATION.test(style);
  if (opacity === 0) return false;
  if (fill && fill.toLowerCase() !== 'none') return true;
  if (stroke && stroke.toLowerCase() !== 'none') return true;
  if (swimlane) return true;
  // Un rectángulo sin estilo tiene los colores por defecto de mxGraph. Un
  // `group` o un texto, en cambio, es transparente si no declara pintura.
  return !group && !textOnly;
}

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
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
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

    const directLabelByGroup = new Map<string, Cell>();
    for (const cell of cells) {
      if (!cell.label || !cell.parent) continue;
      const previous = directLabelByGroup.get(cell.parent);
      // Entre el texto del nombre y una nota corta, el nombre suele ser el más largo.
      if (!previous || cell.label.length > previous.label.length) directLabelByGroup.set(cell.parent, cell);
    }

    /** Posiciones absolutas: las celdas dentro de grupos son relativas al padre. */
    const absoluteGeometry = (cell: Cell) => {
      let x = cell.geometry.x;
      let y = cell.geometry.y;
      let parent = cell.parent;
      const seen = new Set<string>();
      while (parent && parent !== '1' && !seen.has(parent)) {
        seen.add(parent);
        const parentCell = byId.get(parent);
        if (!parentCell) break;
        x += parentCell.geometry.x;
        y += parentCell.geometry.y;
        parent = parentCell.parent;
      }
      return { x, y, width: cell.geometry.width, height: cell.geometry.height };
    };

    // Algunas plantillas no modelan los dominios internos como swimlanes: usan
    // un rectángulo sin texto y colocan encima un rótulo suelto (por ejemplo,
    // "BADI"). Recuperamos esa intención asignando el rótulo al rectángulo
    // más pequeño que lo contiene. Solo se toman siglas en mayúsculas para no
    // convertir las leyendas y llamadas de las flechas en zonas.
    const labelForBackground = new Map<string, string>();
    const backgroundCandidates = cells.filter(
      (cell) =>
        cell.vertex &&
        !cell.edge &&
        !cell.label &&
        !SCREEN_OR_MOCKUP.test(cell.style) &&
        cell.geometry.width >= 240 &&
        cell.geometry.height >= 160,
    );
    for (const annotation of cells) {
      const label = annotation.label.trim();
      if (
        !annotation.vertex ||
        !isAnnotation(annotation.style, label) ||
        !/^[A-Z][A-Z0-9 _-]{1,39}$/.test(label) ||
        /^X+$/i.test(label)
      ) {
        continue;
      }
      const point = absoluteGeometry(annotation);
      const target = backgroundCandidates
        .filter((candidate) => {
          const geometry = absoluteGeometry(candidate);
          return (
            point.x >= geometry.x &&
            point.y >= geometry.y &&
            point.x + point.width <= geometry.x + geometry.width &&
            point.y + point.height <= geometry.y + geometry.height
          );
        })
        .sort((a, b) => a.geometry.width * a.geometry.height - b.geometry.width * b.geometry.height)[0];
      if (target) labelForBackground.set(target.id, label);
    }

    /**
     * Una flecha puede apuntar al icono decorativo de un grupo. Se la eleva al
     * rótulo del grupo para que el resultado tenga un nodo legible, no una caja
     * vacía. Si no hay rótulo, se conserva el propio icono como evidencia.
     */
    const resolveEndpoint = (id?: string): string | undefined => {
      if (!id) return undefined;
      const cell = byId.get(id);
      if (!cell || cell.label || drawioIconName(cell.style)) return id;
      let parent = cell.parent;
      const seen = new Set<string>();
      while (parent && parent !== '1' && !seen.has(parent)) {
        seen.add(parent);
        const label = directLabelByGroup.get(parent);
        if (label) return label.id;
        parent = byId.get(parent)?.parent;
      }
      return id;
    };
    const hasNamedAncestor = (cell: Cell): boolean => {
      let parent = cell.parent;
      const seen = new Set<string>();
      while (parent && parent !== '1' && !seen.has(parent)) {
        seen.add(parent);
        if (byId.get(parent)?.label) return true;
        parent = byId.get(parent)?.parent;
      }
      return false;
    };
    /**
     * Algunos conectores de draw.io no tienen `source`/`target`: solo dejan
     * el punto de la punta contra un grupo. Se resuelve geométricamente contra
     * la celda más cercana y después se eleva a su hijo rotulado, igual que un
     * endpoint normal. No depende de nombres del fixture.
     */
    const resolvePointEndpoint = (point?: { x: number; y: number }): string | undefined => {
      if (!point) return undefined;
      const candidates = cells
        .filter((candidate) => candidate.vertex)
        .map((candidate) => {
          const geometry = absoluteGeometry(candidate);
          const dx = Math.max(geometry.x - point.x, 0, point.x - (geometry.x + geometry.width));
          const dy = Math.max(geometry.y - point.y, 0, point.y - (geometry.y + geometry.height));
          return { candidate, distance: Math.hypot(dx, dy), area: geometry.width * geometry.height };
        });
      // Si la punta está dentro de Cloud y a medio píxel de un grupo hijo,
      // gana el candidato más específico, no el rectángulo global.
      const closest = candidates
        .filter((candidate) => candidate.distance <= 48)
        .sort((a, b) => a.area - b.area || a.distance - b.distance)[0];
      return closest ? resolveEndpoint(closest.candidate.id) : undefined;
    };
    const linkedIds = new Set(
      cells.filter((cell) => cell.edge).flatMap((cell) => [resolveEndpoint(cell.source), resolveEndpoint(cell.target)]).filter(Boolean) as string[],
    );

    for (const cell of cells) {
      if (cell.edge) {
        const label = cell.label || edgeLabels.get(cell.id) || '';
        evidence.links.push({
          id: cell.id,
          label,
          source: resolveEndpoint(cell.source) ?? resolvePointEndpoint(cell.geometry.sourcePoint),
          target: resolveEndpoint(cell.target) ?? resolvePointEndpoint(cell.geometry.targetPoint),
          parent: cell.parent && cell.parent !== '1' ? cell.parent : undefined,
          style: cell.style,
          protocol: guessProtocol(label, cell.style),
          async: styleTokens(cell.style).has('dashed') || /event|publish|consume|async/i.test(label),
          order: parseOrder(label),
          geometry: {
            ...(cell.geometry.sourcePoint ? { sourcePoint: cell.geometry.sourcePoint } : {}),
            ...(cell.geometry.targetPoint ? { targetPoint: cell.geometry.targetPoint } : {}),
            points: cell.geometry.points,
          },
          anchors: {
            ...(styleTokens(cell.style).get('exitx') !== undefined && styleTokens(cell.style).get('exity') !== undefined
              ? { source: { x: Number(styleTokens(cell.style).get('exitx')), y: Number(styleTokens(cell.style).get('exity')) } }
              : {}),
            ...(styleTokens(cell.style).get('entryx') !== undefined && styleTokens(cell.style).get('entryy') !== undefined
              ? { target: { x: Number(styleTokens(cell.style).get('entryx')), y: Number(styleTokens(cell.style).get('entryy')) } }
              : {}),
          },
          startArrow: styleTokens(cell.style).get('startarrow'),
          endArrow: styleTokens(cell.style).get('endarrow'),
        });
        continue;
      }

      if (!cell.vertex) continue;
      if (/edgelabel/i.test(cell.style)) continue;

      const referenced = linkedIds.has(cell.id);
      const siblingLabel = cell.parent ? directLabelByGroup.get(cell.parent)?.label : undefined;
      const visualLabel = cell.label || siblingLabel || '';
      const icon = drawioIconName(cell.style) ?? embeddedVisualName(cell.style, visualLabel);

      // Un PNG embebido puede ser tanto un icono de infraestructura como una
      // captura de una app. Conservamos únicamente los que el propio texto o
      // estilo identifica con seguridad (Firestore, Android, etc.). Un título
      // genérico como "Login" es una maqueta, aunque tenga flechas conectadas.
      const meaningfulLabel = cell.label.length > 0 && !/^x+$/i.test(cell.label.trim());
      const embeddedImageGuess = guessKind(cell.label, cell.style);
      const semanticEmbeddedImage =
        (meaningfulLabel || Boolean(siblingLabel)) &&
        Boolean(icon) &&
        (Boolean(siblingLabel) || (embeddedImageGuess.confidence !== 'baja' && embeddedImageGuess.kind !== 'service'));
      if (
        (ALWAYS_DECORATIVE.test(cell.style) && !icon) ||
        (SCREEN_OR_MOCKUP.test(cell.style) && !semanticEmbeddedImage)
      ) {
        evidence.warnings.push(`Se descarta '${cell.label || cell.id}': es una imagen o maqueta de pantalla, que no tiene equivalente en el modelo.`);
        continue;
      }

      const geometry = absoluteGeometry(cell);
      const inheritedBackgroundLabel = labelForBackground.get(cell.id);
      const container =
        CONTAINER.test(cell.style) ||
        Boolean(inheritedBackgroundLabel) ||
        // Fondos y boundaries sin texto son parte del diagrama visual; se
        // conservan como contenedores y se dibujan detrás de sus hijos.
        (!cell.label && cell.geometry.width >= 240 && cell.geometry.height >= 160 && !drawioIconName(cell.style)) ||
        // Un rectángulo pintado y amplio es un límite aunque su título esté en
        // otra celda (o aún no se haya asociado por solape).
        (isVisiblePaint(cell.style) && cell.geometry.width >= 240 && cell.geometry.height >= 160 && !drawioIconName(cell.style)) ||
        // Algunos diagramas corporativos usan un rectángulo enorme de fondo en
        // lugar de un swimlane. Es una zona si tiene título y contiene cosas.
        (cell.label.length > 0 && cell.geometry.width >= 500 && cell.geometry.height >= 300);
      const logicalGroup = styleTokens(cell.style).has('group');
      const visibleContainer = container && isVisiblePaint(cell.style);
      const textOnly = ANNOTATION.test(cell.style) && !isVisiblePaint(cell.style);
      const renderKind = visibleContainer
        ? 'visible-container'
        : logicalGroup
          ? 'invisible-group'
          : icon
            ? (icon === 'api-management' && geometry.width <= 50 && geometry.height <= 50 ? 'annotation' : 'image')
            : textOnly
              ? 'label'
              : 'component';

      // Es el glifo de despliegue dentro de una caja de aplicación, no otro
      // microservicio. Mantenerlo como nodo crea la hilera fantasma del import.
      if ((icon === 'kubernetes-services' || icon === 'api-management') && !cell.label && !referenced) continue;

      // El icono hijo de una caja con nombre (Kubernetes junto a un servicio,
      // por ejemplo) es decoración. Un icono independiente sí es un nodo.
      if (!container && !cell.label && !referenced && (!icon || hasNamedAncestor(cell))) continue;

      // Las anotaciones se conservan como componentes: perder una clave o una
      // nota por no tener arista es peor que mostrar un placeholder discreto.

      const iconTech = techForDrawioIcon(icon);
      // Un boundary sin nombre debe seguir siendo un boundary, no aparecer en
      // pantalla con su id interno de mxGraph. Los nodos sí necesitan un
      // fallback textual para que resulten identificables.
      const label = container
        ? cell.label || inheritedBackgroundLabel || ''
        : cell.label || inheritedBackgroundLabel || siblingLabel || iconTech || icon?.replace(/-/g, ' ') || cell.id;
      const guess = guessKind(label, cell.style);
      pageShapes.push(cell.id);
      evidence.shapes.push({
        id: cell.id,
        label,
        style: cell.style,
        ...(icon ? { drawioIcon: icon } : {}),
        ...(icon && !cell.label && Boolean(siblingLabel) ? { hideLabel: true } : {}),
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        parent: cell.parent && cell.parent !== '1' ? cell.parent : undefined,
        container,
        renderKind,
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
  if (process.env.ARCHIFLOW_DEBUG_DRAWIO === '1') {
    for (const link of dangling) console.debug('[drawio-edge-unresolved]', link);
  }
  if (dangling.length > 0) {
    evidence.warnings.push(`${dangling.length} flecha(s) apuntan a algo que no se ha importado —una imagen, un rótulo o un extremo suelto— y se omiten.`);
  }
  evidence.links = evidence.links.filter((link) => !dangling.includes(link));

  // Diagnóstico opt-in para XMLs problemáticos. No forma parte del YAML ni
  // modifica el render: permite comparar el sistema de coordenadas crudo con
  // el ya resuelto sin inundar una importación normal.
  if (process.env.ARCHIFLOW_DEBUG_DRAWIO === '1') {
    for (const link of evidence.links) {
      console.debug('[drawio-edge]', {
        edgeId: link.id,
        sourceId: link.source,
        targetId: link.target,
        parentId: link.parent,
        rawPoints: link.geometry?.points ?? [],
        resolvedPoints: [link.geometry?.sourcePoint, ...(link.geometry?.points ?? []), link.geometry?.targetPoint].filter(Boolean),
        sourceAnchor: link.anchors?.source,
        targetAnchor: link.anchors?.target,
      });
    }
  }

  return evidence;
}

/** Un rótulo suelto: estilo de texto y sin forma detrás. */
function isAnnotation(style: string, label: string): boolean {
  return ANNOTATION.test(style) && label.length > 0 && !/fillcolor/i.test(style);
}
