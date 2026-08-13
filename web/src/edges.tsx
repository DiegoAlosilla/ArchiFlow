import { useEffect, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useReactFlow, useStore, type EdgeProps } from '@xyflow/react';
import { anchorPoint, endpointAnchorPoint, endpointBox, placeEdgeLabel, pointBelongsToBox, routeEdge } from '@archiflow/layout';
import { protocolColor } from './kinds';
import { clock } from './playback';
import { removeEdgePath, setEdgePath } from './edgeRegistry';
import type { EdgeData } from './layout';
import { anchorForPoint, closestPointOnBox, orthogonalImportedRoute, pointKeepingGrabOffset, projectWaypointToBox, sideFromAnchor, simplifyOrthogonalRoute, type EdgePoint } from './edgeGeometry';

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
  const activeLayout = edgeData?.activeStep?.layout ?? edge?.layout;
  const persistedPoints = activeLayout?.points ?? [];
  const pointsRevision = JSON.stringify(persistedPoints);
  const [previewPoints, setPreviewPoints] = useState<EdgePoint[] | null>(null);
  const [previewLabelPosition, setPreviewLabelPosition] = useState<EdgePoint | null>(null);
  const [previewSourceAnchor, setPreviewSourceAnchor] = useState<EdgePoint | null>(null);
  const [previewTargetAnchor, setPreviewTargetAnchor] = useState<EdgePoint | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => removeEdgePath(id), [id]);
  useEffect(() => setPreviewPoints(null), [pointsRevision, source, target]);
  useEffect(() => setPreviewLabelPosition(null), [edgeData?.activeStep?.labelPosition?.x, edgeData?.activeStep?.labelPosition?.y]);
  useEffect(() => setPreviewSourceAnchor(null), [activeLayout?.sourceAnchor?.x, activeLayout?.sourceAnchor?.y, source]);
  useEffect(() => setPreviewTargetAnchor(null), [activeLayout?.targetAnchor?.x, activeLayout?.targetAnchor?.y, target]);

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
  const sourceIrNode = (sourceNode.data as { node: import('@archiflow/schema').IrNode }).node;
  const targetIrNode = (targetNode.data as { node: import('@archiflow/schema').IrNode }).node;
  const sourceConnectionBox = endpointBox(sourceBox, sourceIrNode, edgeData?.sourceOperation) ?? sourceBox;
  const targetConnectionBox = endpointBox(targetBox, targetIrNode, edgeData?.targetOperation) ?? targetBox;
  const sourceOperationPoint = endpointAnchorPoint(
    sourceBox,
    sourceIrNode,
    edgeData?.sourceOperation,
    slot.sourceSide,
    slot.sourceIndex,
    slot.sourceCount,
  );
  const targetOperationPoint = endpointAnchorPoint(
    targetBox,
    targetIrNode,
    edgeData?.targetOperation,
    slot.targetSide,
    slot.targetIndex,
    slot.targetCount,
  );

  const sourceAnchor = previewSourceAnchor ?? activeLayout?.sourceAnchor;
  const targetAnchor = previewTargetAnchor ?? activeLayout?.targetAnchor;
  const importedPoints = previewPoints ?? persistedPoints;
  const sourcePoint = activeLayout?.sourcePoint;
  const targetPoint = activeLayout?.targetPoint;
  const from = sourceAnchor
    ? { x: sourceConnectionBox.x + sourceConnectionBox.width * sourceAnchor.x, y: sourceConnectionBox.y + sourceConnectionBox.height * sourceAnchor.y }
    : edge?.sourceInferred && sourcePoint
      ? sourcePoint!
      : pointBelongsToBox(sourcePoint, sourceConnectionBox)
        ? sourcePoint!
        : sourceOperationPoint
          ? sourceOperationPoint
        : importedPoints[0]
          ? projectWaypointToBox(sourceBox, importedPoints[0])
          : anchorPoint(sourceBox, slot.sourceSide, slot.sourceIndex, slot.sourceCount);
  const to = targetAnchor
    ? { x: targetConnectionBox.x + targetConnectionBox.width * targetAnchor.x, y: targetConnectionBox.y + targetConnectionBox.height * targetAnchor.y }
    : edge?.targetInferred && targetPoint
      ? targetPoint!
      : pointBelongsToBox(targetPoint, targetConnectionBox)
        ? targetPoint!
        : targetOperationPoint
          ? targetOperationPoint
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
  const labelObstacles = [...nodeLookup.values()].flatMap((node) => {
    const position = node.internals.positionAbsolute;
    const width = node.measured.width ?? 0;
    const height = node.type === 'zone' ? Math.min(44, node.measured.height ?? 44) : node.measured.height ?? 0;
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
  const startArrow = activeLayout?.startArrow ?? 'none';
  const endArrow = activeLayout?.endArrow ?? 'open';
  const markerStart = activeLayout?.startArrow && activeLayout.startArrow !== 'none'
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
  const label = edgeData?.activeStep?.label ?? edge?.labels[0];
  // Un protocolo genérico no aporta información en pantalla y convertido en
  // chip sobre cada flecha crea ruido. Se mantiene en el modelo, animación y
  // exportación; solo se oculta hasta que haya una operación o mensaje útil.
  const showLabel = label && label.toLowerCase() !== edge?.protocol.toLowerCase();
  const editablePoints = route.points.slice(1, -1);
  const automaticLabelPosition = placeEdgeLabel(
    route.points,
    labelObstacles,
    Math.min(240, Math.max(92, (label?.length ?? 12) * 6.2 + 26)),
    24,
  );
  const persistedLabelPosition = edgeData?.activeStep?.labelPosition;
  const labelPosition = previewLabelPosition ?? persistedLabelPosition ?? automaticLabelPosition;

  const startEndpointDrag = (event: React.PointerEvent<HTMLButtonElement>, end: 'source' | 'target') => {
    if (!edgeData?.onEndpointChange) return;
    clock.pause();
    event.preventDefault();
    event.stopPropagation();
    const box = end === 'source' ? sourceConnectionBox : targetConnectionBox;
    let draft = end === 'source'
      ? sourceAnchor ?? anchorForPoint(box, from)
      : targetAnchor ?? anchorForPoint(box, to);
    let moved = false;
    let saveTimer: number | undefined;
    let saved = '';
    const persist = () => {
      if (!moved) return;
      const revision = `${draft.x},${draft.y}`;
      if (revision === saved) return;
      saved = revision;
      edgeData.onEndpointChange?.(end, draft);
    };
    const move = (pointerEvent: PointerEvent) => {
      moved = true;
      const pointer = screenToFlowPosition({ x: pointerEvent.clientX, y: pointerEvent.clientY });
      const point = closestPointOnBox(box, pointer);
      draft = anchorForPoint(box, point);
      if (end === 'source') setPreviewSourceAnchor(draft);
      else setPreviewTargetAnchor(draft);
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(persist, 180);
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      window.clearTimeout(saveTimer);
      persist();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('mouseup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
  };

  const startPointDrag = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (!edgeData?.onRouteChange) return;
    clock.pause();
    event.preventDefault();
    event.stopPropagation();
    const initial = editablePoints.map((point) => ({ ...point }));
    let draft = initial;
    let moved = false;
    let saveTimer: number | undefined;
    let saved = '';
    const persist = () => {
      if (!moved) return;
      const revision = JSON.stringify(draft);
      if (revision === saved) return;
      saved = revision;
      edgeData.onRouteChange?.(draft);
    };
    const move = (pointerEvent: PointerEvent) => {
      moved = true;
      const point = screenToFlowPosition({ x: pointerEvent.clientX, y: pointerEvent.clientY });
      draft = initial.map((candidate, candidateIndex) => candidateIndex === index
        ? { x: Math.round(point.x), y: Math.round(point.y) }
        : candidate);
      setPreviewPoints(draft);
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(persist, 220);
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      window.clearTimeout(saveTimer);
      persist();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('mouseup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
  };

  const addPoint = (event: React.MouseEvent<HTMLButtonElement>, segmentIndex: number, point: EdgePoint) => {
    if (!edgeData?.onRouteChange) return;
    clock.pause();
    event.preventDefault();
    event.stopPropagation();
    const next = editablePoints.map((candidate) => ({ ...candidate }));
    next.splice(segmentIndex, 0, { x: Math.round(point.x), y: Math.round(point.y) });
    setPreviewPoints(next);
    edgeData.onRouteChange(next);
  };

  const removePoint = (event: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!edgeData?.onRouteChange) return;
    clock.pause();
    event.preventDefault();
    event.stopPropagation();
    const remaining = editablePoints.filter((_, candidateIndex) => candidateIndex !== index);
    const next = simplifyOrthogonalRoute([from, ...remaining, to]).slice(1, -1);
    setPreviewPoints(next);
    edgeData.onRouteChange(next);
  };

  const simplifyRoute = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!edgeData?.onRouteChange) return;
    clock.pause();
    event.preventDefault();
    event.stopPropagation();
    setPreviewPoints([]);
    edgeData.onRouteChange([]);
  };

  const startLabelDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!edgeData?.onLabelPositionChange) return;
    clock.pause();
    event.stopPropagation();
    const origin = { x: event.clientX, y: event.clientY };
    const pointerStart = screenToFlowPosition(origin);
    let draft = labelPosition;
    let moved = false;
    let saveTimer: number | undefined;
    let saved = '';
    const persist = () => {
      if (!moved) return;
      const revision = `${draft.x},${draft.y}`;
      if (revision === saved) return;
      saved = revision;
      edgeData.onLabelPositionChange?.(draft);
    };
    const move = (pointerEvent: PointerEvent) => {
      if (Math.hypot(pointerEvent.clientX - origin.x, pointerEvent.clientY - origin.y) > 3) moved = true;
      if (!moved) return;
      const point = screenToFlowPosition({ x: pointerEvent.clientX, y: pointerEvent.clientY });
      const translated = pointKeepingGrabOffset(labelPosition, pointerStart, point);
      draft = { x: Math.round(translated.x), y: Math.round(translated.y) };
      setPreviewLabelPosition(draft);
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(persist, 220);
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      window.clearTimeout(saveTimer);
      persist();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('mouseup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
  };

  const finishLabelEdit = (commit: boolean) => {
    const next = labelRef.current?.value.trim() ?? label ?? '';
    if (commit && next && next !== label) {
      edgeData?.onLabelChange?.(next);
      return;
    }
    if (labelRef.current) labelRef.current.value = label ?? '';
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
            className="edge-label nodrag nopan"
            style={
              {
                transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
                '--edge-color': color,
                '--label-length': Math.min(34, Math.max(12, label.length)),
              } as React.CSSProperties
            }
            title={edgeData?.onLabelChange ? 'Edita el texto aquí · arrastra desde el asa para mover' : undefined}
            onPointerDown={startLabelDrag}
          >
            {edgeData?.onLabelChange ? (
              <input
                ref={labelRef}
                className="edge-label__input nodrag nopan"
                defaultValue={label}
                aria-label={`Editar ${label}`}
                onPointerDown={(event) => event.stopPropagation()}
                onFocus={() => clock.pause()}
                onBlur={() => finishLabelEdit(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    labelRef.current?.blur();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    finishLabelEdit(false);
                    labelRef.current?.blur();
                  }
                }}
              />
            ) : <span>{label}</span>}
            {!edgeData?.activeStep && edge && edge.labels.length > 1 && (
              <span className="edge-label__more">+{edge.labels.length - 1}</span>
            )}
            {edgeData?.onLabelPositionChange && (
              <span
                className="edge-label__drag"
                aria-label={`Mover ${label}`}
                title="Arrastra para mover el mensaje"
              >⠿</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
      {edgeData?.editing && selected && edgeData.onRouteChange && (
        <EdgeLabelRenderer>
          <div className="edge-route-editor" aria-label={`Editar conexión ${edgeData.activeStep?.index !== undefined ? edgeData.activeStep.index + 1 : (edge?.declaredIndex ?? 0) + 1}`}>
            <button
              type="button"
              className="edge-route-simplify nodrag nopan"
              style={{ transform: `translate(-50%, -50%) translate(${automaticLabelPosition.x}px, ${automaticLabelPosition.y + 34}px)` }}
              aria-label="Simplificar ruta"
              title="Eliminar todos los codos manuales y recalcular la ruta"
              onClick={simplifyRoute}
            >Simplificar ruta</button>
            {edgeData.onEndpointChange && (
              <>
                <button
                  type="button"
                  className="edge-endpoint-handle edge-endpoint-handle--source nodrag nopan"
                  style={{ transform: `translate(-50%, -50%) translate(${from.x}px, ${from.y}px)` }}
                  aria-label="Mover inicio de flecha"
                  title="Arrastra el inicio por cualquier borde"
                  onPointerDown={(event) => startEndpointDrag(event, 'source')}
                />
                <button
                  type="button"
                  className="edge-endpoint-handle edge-endpoint-handle--target nodrag nopan"
                  style={{ transform: `translate(-50%, -50%) translate(${to.x}px, ${to.y}px)` }}
                  aria-label="Mover punta de flecha"
                  title="Arrastra la punta por cualquier borde"
                  onPointerDown={(event) => startEndpointDrag(event, 'target')}
                />
              </>
            )}
            {editablePoints.map((point, index) => (
              <button
                key={`point-${index}-${point.x}-${point.y}`}
                type="button"
                className="edge-route-handle nodrag nopan"
                style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
                aria-label={`Mover punto ${index + 1}`}
                title="Arrastra para mover · doble clic o Supr para eliminar"
                onPointerDown={(event) => startPointDrag(event, index)}
                onDoubleClick={(event) => removePoint(event, index)}
                onKeyDown={(event) => {
                  if (event.key === 'Delete' || event.key === 'Backspace') removePoint(event, index);
                }}
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
