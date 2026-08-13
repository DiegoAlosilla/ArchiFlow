import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { endpointSignature, type Ir, type IrNode } from '../schema/compile.js';
import { anchorPoint, type Side } from './anchors.js';

/**
 * Auto-layout jerárquico con ELK, compartido por el renderer web y los
 * exportadores.
 *
 * Las zonas se modelan como nodos compuestos para que ELK las trate como
 * carriles. Es lo que ordena el diagrama en capas (canales → experiencia →
 * negocio → datos) y lo que evita el espagueti de flechas del que parte el
 * proyecto: sin agrupación, un grafo de quince nodos sale ilegible por muy
 * cuidado que esté el estilo de las cajas.
 */

export * from './anchors.js';
export * from './path.js';
export * from './router.js';

const elk = new ELK();

export const NODE_HEIGHT = 76;
/**
 * Geometría de un nodo expandido, compartida por el canvas y los exportadores.
 *
 * `NODE_HEADER` es lo que ocupan el icono, el nombre y la tecnología; debajo va
 * una fila por operación. Los mismos números están en `.node__endpoints` de
 * `web/src/styles.css`: si se cambian aquí, hay que cambiarlos allí.
 */
export const NODE_HEADER = 58;
export const ENDPOINT_ROW = 42;
export const ENDPOINT_GAP = 8;
export const ENDPOINT_MIN_WIDTH = 164;
/** Aire alrededor de las operaciones. */
const ENDPOINT_PADDING = 10;
const MIN_NODE_WIDTH = 180;
const MAX_NODE_WIDTH = 300;
/** Espacio reservado en la parte alta de una zona para su título. */
const ZONE_HEADER = 44;
/** Margen interior de una zona respecto a sus hijos. */
const ZONE_PADDING = 22;
/** Tamaño mínimo de una zona, para que una recién creada sea usable. */
const MIN_ZONE_WIDTH = 260;
const MIN_ZONE_HEIGHT = 140;

/** Un tamaño fijado a mano manda; si no, se estima a partir del texto. */
export function nodeWidth(node: IrNode): number {
  const longest = Math.max(node.label.length, (node.tech ?? '').length + 2);
  const headerWidth = Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, Math.round(longest * 8.5 + 52)));
  if (node.expanded && node.provides.length > 0) {
    // Cada firma debe caber completa en dos líneas monospace. El endpoint más
    // largo define el ancho común para mantener una banda uniforme.
    const longestEndpoint = Math.max(...node.provides.map((operation) => endpointSignature(operation).length));
    const endpointWidth = Math.max(ENDPOINT_MIN_WIDTH, Math.ceil(longestEndpoint * 3.1 + 18));
    const minimum = Math.max(
      headerWidth,
      28 + node.provides.length * endpointWidth + Math.max(0, node.provides.length - 1) * ENDPOINT_GAP,
    );
    return Math.max(
      node.layout?.width ?? 0,
      minimum,
    );
  }
  if (node.layout?.width) return node.layout.width;
  return headerWidth;
}

export function nodeHeight(node: IrNode): number {
  // Los endpoints se disponen horizontalmente en una única banda. Así una
  // conexión vertical entra o sale de su tarjeta sin atravesar las demás.
  if (node.expanded && node.provides.length > 0) {
    return Math.max(node.layout?.height ?? 0, NODE_HEADER + ENDPOINT_ROW + ENDPOINT_PADDING);
  }
  if (node.layout?.height) return node.layout.height;
  return NODE_HEIGHT;
}

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Punto de conexión de una operación expandida dentro de la caja del servicio.
 *
 * La topología sigue teniendo un nodo por servicio, pero una referencia
 * `servicio/operacion` debe verse distinta: la ruta nace o termina en la fila
 * concreta del endpoint, no en el borde genérico del contenedor.
 */
export function endpointAnchorPoint(
  box: Pick<Box, 'x' | 'y' | 'width' | 'height'>,
  node: IrNode,
  operationId: string | undefined,
  side: Side,
  index: number,
  count: number,
): { x: number; y: number } | undefined {
  const row = endpointBox(box, node, operationId);
  if (!row) return undefined;
  return anchorPoint(row, side, index, count);
}

/** Rectángulo absoluto de una operación expandida dentro de su servicio. */
export function endpointBox(
  box: Pick<Box, 'x' | 'y' | 'width' | 'height'>,
  node: IrNode,
  operationId: string | undefined,
): Omit<Box, 'id'> | undefined {
  if (!operationId || !node.expanded) return undefined;
  const operationIndex = node.provides.findIndex((operation) => operation.id === operationId);
  if (operationIndex < 0) return undefined;
  const countOperations = node.provides.length;
  const available = box.width - 28 - Math.max(0, countOperations - 1) * ENDPOINT_GAP;
  const operationWidth = Math.max(80, available / countOperations);
  return {
    x: box.x + 14 + operationIndex * (operationWidth + ENDPOINT_GAP),
    y: box.y + NODE_HEADER,
    width: operationWidth,
    height: ENDPOINT_ROW,
  };
}

export interface LaidOutZone extends Box {
  /** Posiciones relativas a la zona, tal como las devuelve ELK. */
  children: Box[];
}

export interface LaidOutGraph {
  zones: LaidOutZone[];
  /** Nodos sin zona, en coordenadas absolutas. */
  loose: Box[];
  width: number;
  height: number;
}

/**
 * Aristas que deciden el orden espacial del diagrama.
 *
 * Un flujo operativo contiene ida y vuelta. Si ELK recibe también las
 * respuestas, ve ciclos (canal → servicio → datos → servicio → canal) y puede
 * invertir las capas. Las respuestas siguen dibujándose y animándose, pero no
 * deben decidir dónde vive cada capa: para eso basta el sentido del request.
 */
export function layoutEdgeRefs(ir: Ir): Array<{ id: string; source: string; target: string }> {
  const requests = new Map<string, { id: string; source: string; target: string }>();
  for (const flow of ir.flows) {
    for (const step of flow.steps) {
      const responseOnly = !step.request && Boolean(step.response || step.returns);
      if (responseOnly) continue;
      const key = `${step.from}>${step.to}`;
      if (!requests.has(key)) requests.set(key, { id: `layout:${key}`, source: step.from, target: step.to });
    }
  }
  return requests.size > 0
    ? [...requests.values()]
    : ir.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }));
}

/** Aristas reales con su carril estable de ida o vuelta. */
export function slotEdgeRefs(ir: Ir): Array<{ id: string; source: string; target: string; lane: 'request' | 'response' | 'neutral' }> {
  const lanes = new Map<string, 'request' | 'response' | 'neutral'>();
  for (const flow of ir.flows) {
    for (const step of flow.steps) {
      const lane = !step.request && (step.response || step.returns) ? 'response' : step.request ? 'request' : 'neutral';
      const current = lanes.get(step.edgeId);
      // Si una misma dirección se usa con ambos significados, request manda:
      // conserva el sentido principal y evita que el carril salte entre flujos.
      if (!current || lane === 'request') lanes.set(step.edgeId, lane);
    }
  }
  return ir.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    lane: lanes.get(edge.id) ?? 'neutral',
  }));
}

/**
 * Firma de lo que realmente afecta al cálculo de ELK.
 *
 * Deja fuera las posiciones fijadas a mano a propósito: se aplican después,
 * así que arrastrar un nodo no obliga a recalcular el grafo entero. Es lo que
 * permite que el editor responda al instante en vez de esperar a ELK y
 * parpadear en cada movimiento.
 */
export function layoutSignature(ir: Ir): string {
  const nodes = ir.nodes
    .map((node) => `${node.id}:${node.zone ?? ''}:${nodeWidth(node)}:${nodeHeight(node)}`)
    .join('|');
  const zones = ir.zones.map((zone) => zone.id).join('|');
  const edges = layoutEdgeRefs(ir).map((edge) => `${edge.source}>${edge.target}`).join('|');
  return `${nodes}#${zones}#${edges}`;
}

/** Solo ELK, sin aplicar posiciones fijadas a mano. */
export async function computeBaseLayout(ir: Ir): Promise<LaidOutGraph> {
  // La geometría proveniente de Draw.io ya es una decisión humana. Ejecutar
  // ELK encima la convierte en una interpretación distinta (normalmente
  // vertical) y destruye contenedores, alineaciones y rutas ortogonales.
  if (ir.meta.layoutMode === 'faithful') return faithfulLayout(ir);
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));

  const toElkNode = (node: IrNode): ElkNode => ({
    id: node.id,
    width: nodeWidth(node),
    height: nodeHeight(node),
  });

  const zoneChildren: ElkNode[] = ir.zones.map((zone) => ({
    id: `zone:${zone.id}`,
    layoutOptions: {
      'elk.padding': `[top=${ZONE_HEADER},left=22,bottom=22,right=22]`,
      'elk.spacing.nodeNode': '32',
    },
    children: zone.nodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is IrNode => node !== undefined)
      .map(toElkNode),
  }));

  const looseNodes = ir.nodes.filter((node) => !node.zone);

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      // Separación generosa: el espacio entre capas es lo que da sitio a las
      // aristas para no montarse unas sobre otras al cambiar de nivel.
      'elk.layered.spacing.nodeNodeBetweenLayers': '140',
      'elk.layered.spacing.edgeNodeBetweenLayers': '36',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
      'elk.spacing.nodeNode': '56',
      'elk.spacing.edgeNode': '32',
      'elk.spacing.edgeEdge': '18',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      // Minimizar cruces importa más que la rapidez: un diagrama se calcula
      // una vez y se mira muchas.
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.crossingMinimization.semiInteractive': 'true',
      'elk.layered.thoroughness': '20',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: [...zoneChildren, ...looseNodes.map(toElkNode)],
    edges: layoutEdgeRefs(ir).map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const laid = await elk.layout(graph);

  const zones: LaidOutZone[] = [];
  const loose: Box[] = [];

  const toBox = (node: ElkNode): Box => ({
    id: node.id,
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width ?? MIN_NODE_WIDTH,
    height: node.height ?? NODE_HEIGHT,
  });

  for (const child of laid.children ?? []) {
    if (child.id.startsWith('zone:')) {
      zones.push({ ...toBox(child), children: (child.children ?? []).map(toBox) });
    } else {
      loose.push(toBox(child));
    }
  }

  return {
    zones,
    loose,
    width: laid.width ?? 0,
    height: laid.height ?? 0,
  };
}

/** Construye las cajas del XML sin alterar coordenadas ni tamaños importados. */
function faithfulLayout(ir: Ir): LaidOutGraph {
  const zones: LaidOutZone[] = ir.zones.map((zone) => {
    const layout = zone.layout ?? { x: 0, y: 0, width: MIN_ZONE_WIDTH, height: MIN_ZONE_HEIGHT };
    const children = ir.nodes
      .filter((node) => node.zone === zone.id)
      .map((node) => ({
        id: node.id,
        x: node.layout?.x ?? ZONE_PADDING,
        y: node.layout?.y ?? ZONE_HEADER,
        width: nodeWidth(node),
        height: nodeHeight(node),
      }));
    return {
      id: `zone:${zone.id}`,
      x: layout.x,
      y: layout.y,
      width: layout.width ?? MIN_ZONE_WIDTH,
      height: layout.height ?? MIN_ZONE_HEIGHT,
      children,
    };
  });
  const loose = ir.nodes
    .filter((node) => !node.zone)
    .map((node) => ({
      id: node.id,
      x: node.layout?.x ?? 0,
      y: node.layout?.y ?? 0,
      width: nodeWidth(node),
      height: nodeHeight(node),
    }));
  return { zones, loose, width: 0, height: 0 };
}

/**
 * Superpone las posiciones fijadas a mano sobre el resultado de ELK.
 *
 * Es una función pura y barata: el editor la reaplica en cada arrastre sin
 * volver a invocar al algoritmo de layout.
 */
export function applyLayoutOverrides(base: LaidOutGraph, ir: Ir): LaidOutGraph {
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  const zoneById = new Map(ir.zones.map((zone) => [zone.id, zone]));

  const withOverride = (box: Box): Box => {
    const override = nodeById.get(box.id)?.layout;
    if (!override) return box;
    return {
      ...box,
      x: override.x,
      y: override.y,
      width: override.width ?? box.width,
      height: override.height ?? box.height,
    };
  };

  const zones = base.zones.map((zoneBox) => {
    const children = zoneBox.children.map(withOverride);
    const override = zoneById.get(zoneBox.id.slice('zone:'.length))?.layout;

    const box: Box = override
      ? {
          ...zoneBox,
          x: override.x,
          y: override.y,
          width: override.width ?? zoneBox.width,
          height: override.height ?? zoneBox.height,
        }
      : zoneBox;

    return { ...growToFit(box, children), children };
  });

  return { ...base, zones, loose: base.loose.map(withOverride) };
}

/** ELK más las posiciones fijadas. Es lo que usan los exportadores. */
export async function computeLayout(ir: Ir): Promise<LaidOutGraph> {
  return applyLayoutOverrides(await computeBaseLayout(ir), ir);
}

/**
 * Expande una zona para que ningún hijo se salga de ella.
 *
 * Hace falta porque arrastrar un nodo dentro de su zona puede llevarlo más
 * allá del rectángulo que ELK calculó para el layout automático. Sin esto, el
 * nodo quedaría dibujado fuera de su propio contenedor.
 */
function growToFit(zone: Box, children: Box[]): Box {
  // Una zona recién creada aún no tiene nodos, y ELK le asigna tamaño cero.
  // Sin un mínimo se dibujaría como un rectángulo degenerado, imposible de
  // seleccionar y de arrastrarle nodos dentro.
  const right = Math.max(MIN_ZONE_WIDTH, ...children.map((child) => child.x + child.width + ZONE_PADDING));
  const bottom = Math.max(
    MIN_ZONE_HEIGHT,
    ...children.map((child) => child.y + child.height + ZONE_PADDING),
  );

  return {
    ...zone,
    width: Math.max(zone.width, right),
    height: Math.max(zone.height, bottom),
  };
}
