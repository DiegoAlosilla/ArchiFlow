import { useEffect } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useStore, type EdgeProps } from '@xyflow/react';
import { anchorPoint, pointBelongsToBox, routeEdge } from '@archiflow/layout';
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
  const nodeLookup = useStore((state) => state.nodeLookup);

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

  const sourceAnchor = edge?.layout?.sourceAnchor;
  const targetAnchor = edge?.layout?.targetAnchor;
  const from = pointBelongsToBox(edge?.layout?.sourcePoint, sourceBox) ? edge!.layout!.sourcePoint! : (sourceAnchor
    ? { x: sourceBox.x + sourceBox.width * sourceAnchor.x, y: sourceBox.y + sourceBox.height * sourceAnchor.y }
    : anchorPoint(sourceBox, slot.sourceSide, slot.sourceIndex, slot.sourceCount));
  const to = pointBelongsToBox(edge?.layout?.targetPoint, targetBox) ? edge!.layout!.targetPoint! : (targetAnchor
    ? { x: targetBox.x + targetBox.width * targetAnchor.x, y: targetBox.y + targetBox.height * targetAnchor.y }
    : anchorPoint(targetBox, slot.targetSide, slot.targetIndex, slot.targetCount));

  // `nodeLookup` conserva posiciones absolutas vivas durante el arrastre. Las
  // zonas son contenedores visuales: solo los servicios bloquean una flecha.
  const obstacles = [...nodeLookup.values()].flatMap((node) => {
    if (node.id === source || node.id === target || node.type !== 'service') return [];
    const position = node.internals.positionAbsolute;
    const width = node.measured.width ?? 0;
    const height = node.measured.height ?? 0;
    return width > 0 && height > 0 ? [{ x: position.x, y: position.y, width, height }] : [];
  });
  const importedPoints = edge?.layout?.points ?? [];
  // Un único endpoint absoluto no define toda la polilínea. En ese caso se
  // conserva dicho extremo, pero se deja que el router ortogonal cierre el
  // tramo: unirlo directamente al otro extremo producía diagonales sueltas.
  const route = importedPoints.length > 0
    ? {
        points: [from, ...importedPoints, to],
        d: `M ${[from, ...importedPoints, to].map((point) => `${point.x} ${point.y}`).join(' L ')}`,
        labelOffset: importedPoints[Math.floor(importedPoints.length / 2)] ?? {
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2,
        },
      }
    : routeEdge(from, slot.sourceSide, to, slot.targetSide, obstacles);

  // La capa de paquetes lee el trazado desde el registro, no desde React.
  setEdgePath(id, route.d);

  const color = edge ? protocolColor[edge.protocol] : '#64748b';
  // Los marcadores se declaran junto al path final. Aunque React Flow no
  // reproduce todas las puntas propietarias de mxGraph, conserva su presencia,
  // sentido y los casos explícitos `none` del XML.
  const markerId = `archiflow-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const markerStart = edge?.layout?.startArrow && edge.layout.startArrow !== 'none'
    ? `url(#${markerId})`
    : undefined;
  const markerEnd = edge?.layout?.endArrow !== 'none'
    ? `url(#${markerId})`
    : undefined;
  const label = edge?.labels[0];
  // Un protocolo genérico no aporta información en pantalla y convertido en
  // chip sobre cada flecha crea ruido. Se mantiene en el modelo, animación y
  // exportación; solo se oculta hasta que haya una operación o mensaje útil.
  const showLabel = label && label.toLowerCase() !== edge?.protocol.toLowerCase();

  return (
    <>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={route.d}
        style={{
          stroke: color,
          strokeWidth: 1.8,
          strokeDasharray: edge?.async ? '6 5' : undefined,
        }}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={
              {
                transform: `translate(-50%, -50%) translate(${route.labelOffset.x}px, ${route.labelOffset.y}px)`,
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
