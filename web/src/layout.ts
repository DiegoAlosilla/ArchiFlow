import type { Edge, Node } from '@xyflow/react';
import type { Box, LaidOutGraph } from '@archiflow/layout';
import type { Ir, IrEdge, IrNode, IrZone } from '@archiflow/schema';
import { computeSlots, slotEdgeRefs, type EdgeSlot } from '@archiflow/layout';

/**
 * Traducción del layout de ELK a nodos y aristas de React Flow.
 *
 * El cálculo geométrico vive en `src/layout`, compartido con los exportadores,
 * para que el `.drawio` salga con la misma disposición que se ve en pantalla.
 */

/** Tamaño resultante de arrastrar una asa de redimensionado. */
export interface ResizeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZoneNodeData extends Record<string, unknown> {
  zone: IrZone;
  editing?: boolean;
  onResizeEnd?: (id: string, box: ResizeBox) => void;
  onLabelChange?: (id: string, label: string) => void;
}

export interface ServiceNodeData extends Record<string, unknown> {
  node: IrNode;
  editing?: boolean;
  selectedOperation?: number;
  onResizeEnd?: (id: string, box: ResizeBox) => void;
  onLabelChange?: (id: string, label: string) => void;
  onOperationSelect?: (nodeId: string, index: number) => void;
}

export interface EdgeData extends Record<string, unknown> {
  edge: IrEdge;
  /** Lado y hueco asignados a cada extremo, para que las aristas no se pisen. */
  slot: EdgeSlot;
  /** Operaciones del flujo activo a las que debe anclarse cada extremo. */
  sourceOperation?: string;
  targetOperation?: string;
  activeFlowId?: string;
  activeStep?: import('@archiflow/schema').IrStep;
  editing?: boolean;
  onRouteChange?: (points: Array<{ x: number; y: number }>) => void;
  onEndpointChange?: (end: 'source' | 'target', anchor: { x: number; y: number }) => void;
  onLabelPositionChange?: (position: { x: number; y: number }) => void;
  onLabelChange?: (label: string) => void;
}

/**
 * Posiciones absolutas de todos los nodos. ELK da las de los hijos relativas a
 * su zona, pero el reparto de anclajes compara nodos de zonas distintas.
 */
export function absoluteBoxes(laid: LaidOutGraph): Map<string, Box> {
  const boxes = new Map<string, Box>();
  for (const zone of laid.zones) {
    for (const child of zone.children) {
      boxes.set(child.id, { ...child, x: zone.x + child.x, y: zone.y + child.y });
    }
  }
  for (const box of laid.loose) boxes.set(box.id, box);
  return boxes;
}

export interface LayoutResult {
  nodes: Node[];
  edges: Edge<EdgeData>[];
}

export function toReactFlow(laid: LaidOutGraph, ir: Ir): LayoutResult {
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  const zoneById = new Map(ir.zones.map((zone) => [zone.id, zone]));

  const nodes: Node[] = [];

  // React Flow exige que un nodo padre aparezca en el array antes que sus hijos.
  for (const zoneBox of laid.zones) {
    const zone = zoneById.get(zoneBox.id.slice('zone:'.length));
    if (!zone) continue;

    nodes.push({
      id: zoneBox.id,
      type: 'zone',
      position: { x: zoneBox.x, y: zoneBox.y },
      data: { zone } satisfies ZoneNodeData,
      // `width`/`height` (y no solo `style`) evitan que React Flow espere al
      // ResizeObserver para medir: ya conocemos las dimensiones exactas porque
      // las calculó ELK. Sin esto los nodos nacen ocultos y las aristas no se
      // dibujan hasta el segundo frame.
      width: zoneBox.width,
      height: zoneBox.height,
      style: { width: zoneBox.width, height: zoneBox.height },
      draggable: false,
      zIndex: 0,
    });

    for (const box of zoneBox.children) {
      const node = nodeById.get(box.id);
      if (!node) continue;
      nodes.push({
        id: node.id,
        type: 'service',
        parentId: zoneBox.id,
        extent: 'parent',
        position: { x: box.x, y: box.y },
        data: { node } satisfies ServiceNodeData,
        width: box.width,
        height: box.height,
        style: { width: box.width, height: box.height },
        zIndex: 3,
      });
    }
  }

  for (const box of laid.loose) {
    const node = nodeById.get(box.id);
    if (!node) continue;
    nodes.push({
      id: node.id,
      type: 'service',
      position: { x: box.x, y: box.y },
      data: { node } satisfies ServiceNodeData,
      width: box.width,
      height: box.height,
      style: { width: box.width, height: box.height },
      zIndex: 3,
    });
  }

  const slots = computeSlots(absoluteBoxes(laid), slotEdgeRefs(ir));

  const edges: Edge<EdgeData>[] = [];
  for (const edge of ir.edges) {
    // Sin hueco asignado el nodo no está en el layout: dibujar la arista
    // produciría una flecha colgando de la nada.
    const slot = slots.get(edge.id);
    if (!slot) continue;
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'archiflow',
      data: { edge, slot } satisfies EdgeData,
      zIndex: 2,
    });
  }

  return { nodes, edges };
}
