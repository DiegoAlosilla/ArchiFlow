import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Ir, IrNode } from '../schema/compile.js';

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

const elk = new ELK();

export const NODE_HEIGHT = 76;
const MIN_NODE_WIDTH = 180;
const MAX_NODE_WIDTH = 300;
/** Espacio reservado en la parte alta de una zona para su título. */
const ZONE_HEADER = 44;
/** Margen interior de una zona respecto a sus hijos. */
const ZONE_PADDING = 22;

export function nodeWidth(node: IrNode): number {
  const longest = Math.max(node.label.length, (node.tech ?? '').length + 2);
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, Math.round(longest * 8.5 + 52)));
}

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
 * Firma de lo que realmente afecta al cálculo de ELK.
 *
 * Deja fuera las posiciones fijadas a mano a propósito: se aplican después,
 * así que arrastrar un nodo no obliga a recalcular el grafo entero. Es lo que
 * permite que el editor responda al instante en vez de esperar a ELK y
 * parpadear en cada movimiento.
 */
export function layoutSignature(ir: Ir): string {
  const nodes = ir.nodes
    .map((node) => `${node.id}:${node.zone ?? ''}:${nodeWidth(node)}`)
    .join('|');
  const zones = ir.zones.map((zone) => zone.id).join('|');
  const edges = ir.edges.map((edge) => edge.id).join('|');
  return `${nodes}#${zones}#${edges}`;
}

/** Solo ELK, sin aplicar posiciones fijadas a mano. */
export async function computeBaseLayout(ir: Ir): Promise<LaidOutGraph> {
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));

  const toElkNode = (node: IrNode): ElkNode => ({
    id: node.id,
    width: nodeWidth(node),
    height: NODE_HEIGHT,
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
      'elk.layered.spacing.nodeNodeBetweenLayers': '76',
      'elk.spacing.nodeNode': '44',
      'elk.spacing.edgeNode': '28',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: [...zoneChildren, ...looseNodes.map(toElkNode)],
    edges: ir.edges.map((edge) => ({
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
    return override ? { ...box, x: override.x, y: override.y } : box;
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
  if (children.length === 0) return zone;

  const right = Math.max(...children.map((child) => child.x + child.width));
  const bottom = Math.max(...children.map((child) => child.y + child.height));

  return {
    ...zone,
    width: Math.max(zone.width, right + ZONE_PADDING),
    height: Math.max(zone.height, bottom + ZONE_PADDING),
  };
}
