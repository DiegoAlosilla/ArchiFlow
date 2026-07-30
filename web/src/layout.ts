import type { Edge, Node } from '@xyflow/react';
import type { LaidOutGraph } from '@archiflow/layout';
import type { Ir, IrEdge, IrNode, IrZone } from '@archiflow/schema';

/**
 * Traducción del layout de ELK a nodos y aristas de React Flow.
 *
 * El cálculo geométrico vive en `src/layout`, compartido con los exportadores,
 * para que el `.drawio` salga con la misma disposición que se ve en pantalla.
 */

export interface ZoneNodeData extends Record<string, unknown> {
  zone: IrZone;
}

export interface ServiceNodeData extends Record<string, unknown> {
  node: IrNode;
}

export interface EdgeData extends Record<string, unknown> {
  edge: IrEdge;
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
        zIndex: 1,
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
      zIndex: 1,
    });
  }

  const edges: Edge<EdgeData>[] = ir.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'archiflow',
    data: { edge } satisfies EdgeData,
    zIndex: 2,
  }));

  return { nodes, edges };
}
