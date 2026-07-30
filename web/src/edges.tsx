import { useEffect } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { protocolColor } from './kinds';
import { removeEdgePath, setEdgePath } from './edgeRegistry';
import type { EdgeData } from './layout';

export function ArchiflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const edge = (data as EdgeData | undefined)?.edge;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
  });

  // La capa de paquetes lee el trazado desde el registro, no desde React.
  setEdgePath(id, path);
  useEffect(() => () => removeEdgePath(id), [id]);

  const color = edge ? protocolColor[edge.protocol] : '#64748b';
  const label = edge?.labels[0];

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
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
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              '--edge-color': color,
            } as React.CSSProperties}
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
