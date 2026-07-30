import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { kindStyle } from './kinds';
import type { ServiceNodeData, ZoneNodeData } from './layout';

/**
 * Los nodos no leen el reloj de reproducción. El resaltado durante la
 * animación se aplica por clase desde la capa de paquetes (ver `packets.ts`),
 * para no re-renderizar React a 60 fps.
 */

/** Un conector por lado: una arista debe poder salir por donde le convenga. */
const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

export function ZoneNode({ data, id, selected }: NodeProps) {
  const { zone, editing, onResizeEnd } = data as ZoneNodeData;
  return (
    <>
      {editing && (
        <NodeResizer
          isVisible={selected}
          minWidth={200}
          minHeight={120}
          lineClassName="resizer__line"
          handleClassName="resizer__handle"
          onResizeEnd={(_event, params) => onResizeEnd?.(id, params)}
        />
      )}
      <div className="zone" style={{ '--zone-accent': zone.color } as React.CSSProperties}>
        <div className="zone__header">
          <span className="zone__label">{zone.label}</span>
          {zone.platform && <span className="zone__platform">{zone.platform}</span>}
        </div>
      </div>
    </>
  );
}

export function ServiceNode({ data, id, selected }: NodeProps) {
  const { node, editing, onResizeEnd } = data as ServiceNodeData;
  const style = kindStyle(node.kind);

  const subtitle = node.tech ?? style.label;
  const endpoint = node.provides[0];
  const expanded = node.expanded && node.provides.length > 0;

  return (
    <>
      {editing && (
        <NodeResizer
          isVisible={selected}
          minWidth={140}
          minHeight={56}
          lineClassName="resizer__line"
          handleClassName="resizer__handle"
          onResizeEnd={(_event, params) => onResizeEnd?.(id, params)}
        />
      )}

      <div
        className={`node node--${node.kind}${node.external ? ' node--external' : ''}${expanded ? ' node--expanded' : ''}`}
        style={{ '--accent': style.accent } as React.CSSProperties}
        data-node-id={id}
        title={node.description ?? undefined}
      >
        {/* En modo suelto un mismo conector sirve de origen y de destino, así
            que basta uno por lado en vez de ocho solapados. */}
        {SIDES.map((position) => (
          <Handle key={position} type="source" position={position} id={position} className="node__handle" />
        ))}

        <span className="node__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            {style.icon}
          </svg>
        </span>

        <span className="node__text">
          <span className="node__label">{node.label}</span>
          <span className="node__subtitle">
            {subtitle}
            {/* Expandido, la primera operación ya tiene su fila abajo. */}
            {!expanded && endpoint?.path && (
              <>
                {' · '}
                <code>
                  {endpoint.method ?? ''} {endpoint.path}
                </code>
              </>
            )}
          </span>
        </span>
        {expanded && (
          <div className="node__endpoints">
            {node.provides.map((operation, index) => (
              <span
                key={operation.id ?? `${operation.method}-${operation.path}-${index}`}
                className="node__endpoint"
              >
                <b>{operation.method ?? 'OP'}</b>{' '}
                {operation.path ?? operation.label ?? operation.id ?? 'operación'}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export const nodeTypes = { zone: ZoneNode, service: ServiceNode };
