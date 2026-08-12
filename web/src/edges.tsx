import { useEffect, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useReactFlow, useStore, type EdgeProps } from '@xyflow/react';
import { anchorPoint, pointBelongsToBox, routeEdge } from '@archiflow/layout';
import { protocolColor } from './kinds';
import { removeEdgePath, setEdgePath } from './edgeRegistry';
import type { EdgeData } from './layout';
import { orthogonalImportedRoute, projectWaypointToBox, sideFromAnchor, type EdgePoint } from './edgeGeometry';

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

export function ArchiflowEdge({ id, source, target, data, selected }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const nodeLookup = useStore((state) => state.nodeLookup);
  const { screenToFlowPosition } = useReactFlow();

  const edgeData = data as EdgeData | undefined;
  const edge = edgeData?.edge;
  const slot = edgeData?.slot;
  const persistedPoints = edge?.layout?.points ?? [];
  const pointsRevision = JSON.stringify(persistedPoints);
  const [previewPoints, setPreviewPoints] = useState<EdgePoint[] | null>(null);

  useEffect(() => () => removeEdgePath(id), [id]);
  useEffect(() => setPreviewPoints(null), [pointsRevision, source, target]);

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
  const importedPoints = previewPoints ?? persistedPoints;
  const sourcePoint = edge?.layout?.sourcePoint;
  const targetPoint = edge?.layout?.targetPoint;
  const from = edge?.sourceInferred && sourcePoint
    ? sourcePoint
    : pointBelongsToBox(sourcePoint, sourceBox)
      ? sourcePoint!
      : sourceAnchor
        ? { x: sourceBox.x + sourceBox.width * sourceAnchor.x, y: sourceBox.y + sourceBox.height * sourceAnchor.y }
        : importedPoints[0]
          ? projectWaypointToBox(sourceBox, importedPoints[0])
          : anchorPoint(sourceBox, slot.sourceSide, slot.sourceIndex, slot.sourceCount);
  const to = edge?.targetInferred && targetPoint
    ? targetPoint
    : pointBelongsToBox(targetPoint, targetBox)
      ? targetPoint!
      : targetAnchor
        ? { x: targetBox.x + targetBox.width * targetAnchor.x, y: targetBox.y + targetBox.height * targetAnchor.y }
        : importedPoints.at(-1)
          ? projectWaypointToBox(targetBox, importedPoints.at(-1)!)
          : anchorPoint(targetBox, slot.targetSide, slot.targetIndex, slot.targetCount);

  // `nodeLookup` conserva posiciones absolutas vivas durante el arrastre. Las
  // zonas son contenedores visuales: solo los servicios bloquean una flecha.
  const obstacles = [...nodeLookup.values()].flatMap((node) => {
    if (node.id === source || node.id === target || node.type !== 'service') return [];
    const position = node.internals.positionAbsolute;
    const width = node.measured.width ?? 0;
    const height = node.measured.height ?? 0;
    return width > 0 && height > 0 ? [{ x: position.x, y: position.y, width, height }] : [];
  });
  // Un único endpoint absoluto no define toda la polilínea. En ese caso se
  // conserva dicho extremo, pero se deja que el router ortogonal cierre el
  // tramo: unirlo directamente al otro extremo producía diagonales sueltas.
  const importedRoute = importedPoints.length > 0
    ? orthogonalImportedRoute(
        [from, ...importedPoints, to],
        sideFromAnchor(sourceAnchor, slot.sourceSide),
        sideFromAnchor(targetAnchor, slot.targetSide),
      )
    : [];
  const route = importedRoute.length > 0
    ? {
        points: importedRoute,
        d: `M ${importedRoute.map((point) => `${point.x} ${point.y}`).join(' L ')}`,
        labelOffset: importedPoints[Math.floor(importedPoints.length / 2)] ?? {
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2,
        },
      }
    : routeEdge(from, slot.sourceSide, to, slot.targetSide, obstacles);

  // La capa de paquetes lee el trazado desde el registro, no desde React.
  setEdgePath(id, route.d);

  const color = edge ? protocolColor[edge.protocol] : '#64748b';
  const styleToken = (key: string) => edge?.layout?.style
    ?.split(';')
    .map((part) => part.split('='))
    .find(([candidate]) => candidate?.toLowerCase() === key.toLowerCase())?.[1];
  const importedStroke = styleToken('strokeColor');
  const stroke = importedStroke && /^#[0-9a-f]{3,6}$/i.test(importedStroke)
    ? importedStroke
    : edge?.layout?.style
      ? 'var(--drawio-edge)'
      : color;
  const importedStrokeWidth = Number(styleToken('strokeWidth'));
  // Los marcadores se declaran junto al path final. Aunque React Flow no
  // reproduce todas las puntas propietarias de mxGraph, conserva su presencia,
  // sentido y los casos explícitos `none` del XML.
  const markerId = `archiflow-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const markerStartId = `${markerId}-start`;
  const markerEndId = `${markerId}-end`;
  const startArrow = edge?.layout?.startArrow ?? 'none';
  const endArrow = edge?.layout?.endArrow ?? 'open';
  const markerStart = edge?.layout?.startArrow && edge.layout.startArrow !== 'none'
    ? `url(#${markerStartId})`
    : undefined;
  const markerEnd = endArrow !== 'none'
    ? `url(#${markerEndId})`
    : undefined;
  const markerShape = (arrow: string, fill: boolean) => {
    if (arrow === 'open') return <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={stroke} strokeWidth="1.35" />;
    if (arrow === 'diamond' || arrow === 'diamondThin') {
      return <path d="M 0.5 5 L 5 1 L 9.5 5 L 5 9 Z" fill={fill ? stroke : '#fff'} stroke={stroke} strokeWidth="1.1" />;
    }
    return <path d="M 0 0 L 10 5 L 0 10 Z" fill={fill ? stroke : '#fff'} stroke={stroke} strokeWidth="1" />;
  };
  const label = edge?.labels[0];
  // Un protocolo genérico no aporta información en pantalla y convertido en
  // chip sobre cada flecha crea ruido. Se mantiene en el modelo, animación y
  // exportación; solo se oculta hasta que haya una operación o mensaje útil.
  const showLabel = label && label.toLowerCase() !== edge?.protocol.toLowerCase();
  const editablePoints = route.points.slice(1, -1);

  const startPointDrag = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (!edge || edge.declaredIndex === undefined || !edgeData?.onRouteChange) return;
    event.preventDefault();
    event.stopPropagation();
    const initial = editablePoints.map((point) => ({ ...point }));
    let draft = initial;
    let moved = false;
    const move = (pointerEvent: PointerEvent) => {
      moved = true;
      const point = screenToFlowPosition({ x: pointerEvent.clientX, y: pointerEvent.clientY });
      draft = initial.map((candidate, candidateIndex) => candidateIndex === index
        ? { x: Math.round(point.x), y: Math.round(point.y) }
        : candidate);
      setPreviewPoints(draft);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      if (moved && edge.declaredIndex !== undefined) edgeData.onRouteChange?.(edge.declaredIndex, draft);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };

  const addPoint = (event: React.MouseEvent<HTMLButtonElement>, segmentIndex: number, point: EdgePoint) => {
    if (!edge || edge.declaredIndex === undefined || !edgeData?.onRouteChange) return;
    event.preventDefault();
    event.stopPropagation();
    const next = editablePoints.map((candidate) => ({ ...candidate }));
    next.splice(segmentIndex, 0, { x: Math.round(point.x), y: Math.round(point.y) });
    setPreviewPoints(next);
    edgeData.onRouteChange(edge.declaredIndex, next);
  };

  return (
    <>
      <defs>
        <marker id={markerStartId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          {markerShape(startArrow, styleToken('startFill') !== '0')}
        </marker>
        <marker id={markerEndId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          {markerShape(endArrow, styleToken('endFill') !== '0')}
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={route.d}
        style={{
          stroke,
          strokeWidth: Number.isFinite(importedStrokeWidth) && importedStrokeWidth > 0
            ? importedStrokeWidth
            : edge?.layout?.style
              ? 1
              : 1.4,
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
      {edgeData?.editing && selected && edge && edge.declaredIndex !== undefined && (
        <EdgeLabelRenderer>
          <div className="edge-route-editor" aria-label={`Editar conexión ${edge.declaredIndex + 1}`}>
            {editablePoints.map((point, index) => (
              <button
                key={`point-${index}-${point.x}-${point.y}`}
                type="button"
                className="edge-route-handle nodrag nopan"
                style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
                aria-label={`Mover punto ${index + 1}`}
                title="Arrastra para mover el codo"
                onPointerDown={(event) => startPointDrag(event, index)}
              />
            ))}
            {route.points.slice(0, -1).map((point, index) => {
              const next = route.points[index + 1]!;
              const middle = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
              return (
                <button
                  key={`mid-${index}-${middle.x}-${middle.y}`}
                  type="button"
                  className="edge-route-add nodrag nopan"
                  style={{ transform: `translate(-50%, -50%) translate(${middle.x}px, ${middle.y}px)` }}
                  aria-label={`Añadir punto en tramo ${index + 1}`}
                  title="Añadir un punto de control"
                  onClick={(event) => addPoint(event, index, middle)}
                />
              );
            })}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { archiflow: ArchiflowEdge };
