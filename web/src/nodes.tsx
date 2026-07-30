import { Handle, Position, type NodeProps } from '@xyflow/react';
import { kindStyle } from './kinds';
import type { ServiceNodeData, ZoneNodeData } from './layout';

/**
 * Los nodos no leen el reloj de reproducción. El resaltado durante la
 * animación se aplica por clase desde la capa de paquetes (ver `packets.ts`),
 * para no re-renderizar React a 60 fps.
 */

export function ZoneNode({ data }: NodeProps) {
  const { zone } = data as ZoneNodeData;
  return (
    <div className="zone" style={{ '--zone-accent': zone.color } as React.CSSProperties}>
      <div className="zone__header">
        <span className="zone__label">{zone.label}</span>
        {zone.platform && <span className="zone__platform">{zone.platform}</span>}
      </div>
    </div>
  );
}

export function ServiceNode({ data, id }: NodeProps) {
  const { node } = data as ServiceNodeData;
  const style = kindStyle(node.kind);

  const subtitle = node.tech ?? style.label;
  const endpoint = node.provides[0];

  return (
    <div
      className={`node node--${node.kind}${node.external ? ' node--external' : ''}`}
      style={{ '--accent': style.accent } as React.CSSProperties}
      data-node-id={id}
      title={node.description ?? undefined}
    >
      <Handle type="target" position={Position.Top} className="node__handle" />

      <span className="node__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20">
          {style.icon}
        </svg>
      </span>

      <span className="node__text">
        <span className="node__label">{node.label}</span>
        <span className="node__subtitle">
          {subtitle}
          {endpoint?.path && (
            <>
              {' · '}
              <code>
                {endpoint.method ?? ''} {endpoint.path}
              </code>
            </>
          )}
        </span>
      </span>

      <Handle type="source" position={Position.Bottom} className="node__handle" />
    </div>
  );
}

export const nodeTypes = { zone: ZoneNode, service: ServiceNode };
