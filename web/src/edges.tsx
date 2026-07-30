import { useEffect } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps } from '@xyflow/react';
import { anchorPoint, routeEdge } from '@archiflow/layout';
import { protocolColor } from './kinds';
import { removeEdgePath, setEdgePath } from './edgeRegistry';
import type { EdgeData } from './layout';

/**
 * La arista calcula su propia geometría en vez de usar los `sourceX/sourceY`
 * que da React Flow, porque esos apuntan siempre al handle fijo y harían que
 * todas las aristas de un nodo salieran del mismo punto. Aquí se usan los
 * anclajes repartidos (ver `anchors.ts`).
 *
 * Las posiciones se leen de `useInternalNode`, que está vivo durante el
 * arrastre; el hueco asignado viene precalculado en `data.slot` y solo cambia
 * cuando cambia el layout.
 */

export function ArchiflowEdge({ id, source, target, data }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const edgeData = data as EdgeData | undefined;
  const edge = edgeData?.edge;
  const slot = edgeData?.slot;

  useEffect(() => () => removeEdgePath(id), [id]);

  if (!sourceNode || !targetNode || !slot) return null;

  const sourceBox = {
    x: sourceNode.internals.positionAbsolute.x,
    y: sourceNode.internals.positionAbsolute.y,
    width: sourceNode.measured.width ?? 0,
    height: sourceNode.measured.height ?? 0,
  };
  const targetBox = {
    x: targetNode.internals.positionAbsolute.x,
    y: targetNode.internals.positionAbsolute.y,
    width: targetNode.measured.width ?? 0,
    height: targetNode.measured.height ?? 0,
  };

  const from = anchorPoint(sourceBox, slot.sourceSide, slot.sourceIndex, slot.sourceCount);
  const to = anchorPoint(targetBox, slot.targetSide, slot.targetIndex, slot.targetCount);

  const route = routeEdge(from, slot.sourceSide, to, slot.targetSide);

  // La capa de paquetes lee el trazado desde el registro, no desde React.
  setEdgePath(id, route.d);

  const color = edge ? protocolColor[edge.protocol] : '#64748b';
  const label = edge?.labels[0];

  return (
    <>
      <BaseEdge
        id={id}
        path={route.d}
        style={{
          stroke: color,
          strokeWidth: 1.8,
          strokeDasharray: edge?.async ? '6 5' : undefined,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={
              {
                transform: `translate(-50%, -50%) translate(${route.labelAt.x}px, ${route.labelAt.y}px)`,
                '--edge-color': color,
              } as React.CSSProperties
            }
          >
            {label}
            {edge && edge.labels.length > 1 && (
              <span className="edge-label__more">+{edge.labels.length - 1}</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { archiflow: ArchiflowEdge };
