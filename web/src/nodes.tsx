import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { kindStyle } from './kinds';
import type { ServiceNodeData, ZoneNodeData } from './layout';
import { vendorIconPath } from '../../src/icons';

/**
 * Los nodos no leen el reloj de reproducción. El resaltado durante la
 * animación se aplica por clase desde la capa de paquetes (ver `packets.ts`),
 * para no re-renderizar React a 60 fps.
 */

/** Un conector por lado: una arista debe poder salir por donde le convenga. */
const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

export function ZoneNode({ data, id, selected }: NodeProps) {
  const { zone, editing, onResizeEnd } = data as ZoneNodeData;
  const cloudZone = /cloud|azure/i.test(`${zone.label} ${zone.platform ?? ''}`);
  const boundary = !zone.label;
  const shapeClass = zone.appearance?.shape ? ` shape--${zone.appearance.shape}` : '';
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
      <div
        className={`zone${zone.appearance ? ' zone--faithful' : ''}${shapeClass} ${cloudZone ? 'zone--cloud' : boundary ? 'zone--boundary' : 'zone--domain'}`}
        style={{
          '--zone-accent': zone.color,
          '--shape-fill': zone.appearance?.fill ?? '#ffffff',
          '--shape-stroke': zone.appearance?.stroke ?? '#a0a0a0',
          '--shape-text': zone.appearance?.text ?? '#1f2937',
          '--shape-radius': `${zone.appearance?.radius ?? 0}px`,
          '--shape-opacity': zone.appearance?.opacity ?? 1,
          '--shape-stroke-width': `${zone.appearance?.strokeWidth ?? 1}px`,
          '--frame-width': `${zone.appearance?.frameWidth ?? 192}px`,
          '--frame-height': `${zone.appearance?.frameHeight ?? 18}px`,
        } as React.CSSProperties}
      >
        <div className="zone__header">
          {zone.label && <span className="zone__label">{zone.label}</span>}
          {zone.platform && <span className="zone__platform">{zone.platform}</span>}
        </div>
      </div>
    </>
  );
}

export function ServiceNode({ data, id, selected }: NodeProps) {
  const { node, editing, onResizeEnd } = data as ServiceNodeData;
  const style = kindStyle(node.kind);
  const faithful = node.tags.includes('drawio:faithful');
  const renderKind = node.tags.find((tag) => tag.startsWith('drawio:render:'))?.slice('drawio:render:'.length);
  const presentationClass = renderKind ? ` node--${renderKind}` : '';
  const hideLabel = node.tags.includes('drawio:hide-label');

  // En Draw.io el icono ya contiene la semántica; añadir "Servicio" o
  // "Azure API Management" debajo inventa una segunda tarjeta y ocupa el
  // espacio reservado por el autor. El tooltip/editor conserva `tech`.
  const subtitle = faithful ? '' : (node.tech ?? style.label);
  const endpoint = node.provides[0];
  const expanded = node.expanded && node.provides.length > 0;
  const vendorIcon = vendorIconPath(node.tags, node.label, node.tech, node.platform);
  const appearance = node.appearance;
  const shapeClass = appearance?.shape ? ` shape--${appearance.shape}` : '';
  const vertical = appearance?.verticalAlign === 'top' ? 'flex-start' : appearance?.verticalAlign === 'bottom' ? 'flex-end' : 'center';

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
        className={`node node--${node.kind}${node.external ? ' node--external' : ''}${expanded ? ' node--expanded' : ''}${faithful ? ' node--faithful' : ''}${presentationClass}${shapeClass}`}
        style={{
          '--accent': style.accent,
          '--shape-fill': appearance?.fill ?? '#ffffff',
          '--shape-stroke': appearance?.stroke ?? '#36393d',
          '--shape-text': appearance?.text ?? '#1f2937',
          '--shape-font-size': `${appearance?.fontSize ?? 12}px`,
          '--shape-font-family': appearance?.fontFamily ?? 'Arial, sans-serif',
          '--shape-font-weight': appearance?.bold ? 700 : 400,
          '--shape-font-style': appearance?.italic ? 'italic' : 'normal',
          '--shape-radius': `${appearance?.radius ?? 0}px`,
          '--shape-opacity': appearance?.opacity ?? 1,
          '--shape-align': appearance?.align ?? 'center',
          '--shape-justify': vertical,
          '--shape-stroke-width': `${appearance?.strokeWidth ?? 1}px`,
          '--frame-width': `${appearance?.frameWidth ?? 192}px`,
          '--frame-height': `${appearance?.frameHeight ?? 18}px`,
        } as React.CSSProperties}
        data-node-id={id}
        title={node.description ?? undefined}
      >
        {/* En modo suelto un mismo conector sirve de origen y de destino, así
            que basta uno por lado en vez de ocho solapados. */}
        {SIDES.map((position) => (
          <Handle key={position} type="source" position={position} id={position} className="node__handle" />
        ))}

        <span className={`node__icon${vendorIcon ? ' node__icon--vendor' : ''}`} aria-hidden="true">
          {vendorIcon ? (
            <img src={vendorIcon} alt="" />
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20">
              {style.icon}
            </svg>
          )}
        </span>

        {!hideLabel && <span className="node__text">
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
        </span>}
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
