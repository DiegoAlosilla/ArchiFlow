import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type OnReconnect,
  type Node,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import { applyLayoutOverrides, computeBaseLayout, layoutSignature, type LaidOutGraph } from '@archiflow/layout';
import type { AnimationSettings, Ir, IrFlow } from '@archiflow/schema';
import type { Mutation } from '@archiflow/shared';
import { toReactFlow, type EdgeData } from './layout';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { FlowPackets } from './packets';
import { measurer } from './edgeRegistry';
import { clock } from './playback';
import type { Selection } from './selection';

/**
 * Encuadre inicial. El `minZoom` es lo que evita que un diagrama grande entre
 * entero pero ilegible: por debajo de la mitad, el nombre de un servicio deja
 * de leerse y lo que se ve es un mapa de cajas de colores. Mejor entrar cerca y
 * que el usuario se aleje si quiere.
 */
// Un import fiel puede tener un lienzo grande; limitarlo a 0.5 recortaba los
// elementos superiores/laterales en vez de aplicar un fit uniforme.
const FIT_VIEW = { padding: 0.1, duration: 400, minZoom: 0.12, maxZoom: 1.1 };

interface Props {
  ir: Ir;
  flow: IrFlow | null;
  editing: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onStepChange: (index: number) => void;
  currentStep: number;
  mutate: (...mutations: Mutation[]) => Promise<boolean>;
  animation: AnimationSettings;
  presentation?: boolean;
  pathMode?: boolean;
  pathStart?: string | null;
  onPathNodeClick?: (nodeId: string) => boolean;
  focusRequest?: { selection: Selection; nonce: number } | null;
}

function CanvasInner({ ir, flow, editing, selection, onSelect, onStepChange, currentStep, mutate, animation, presentation = false, pathMode = false, pathStart = null, onPathNodeClick, focusRequest }: Props) {
  const [base, setBase] = useState<LaidOutGraph | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const { fitView } = useReactFlow();

  const signature = layoutSignature(ir);
  const lastSignature = useRef<string | null>(null);
  const lastDiagram = useRef<string | null>(null);

  // ELK solo se relanza cuando cambia la estructura del grafo. Arrastrar un
  // nodo cambia su posición fijada, no la estructura, así que no dispara un
  // recálculo: por eso el arrastre responde al instante.
  useEffect(() => {
    let cancelled = false;
    computeBaseLayout(ir).then((result) => {
      if (cancelled) return;
      setBase(result);
      lastSignature.current = signature;
    });
    return () => {
      cancelled = true;
    };
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const laid = useMemo(() => (base ? applyLayoutOverrides(base, ir) : null), [base, ir]);

  const computed = useMemo(() => {
    if (!laid) return null;
    return toReactFlow(laid, ir);
  }, [laid, ir]);

  /**
   * Lo que hace legible un diagrama grande no es dibujar mejor las flechas,
   * sino apagar las que no participan en el flujo que se está viendo. Durante
   * la edición se atenúa menos, porque hay que poder alcanzar todo.
   */
  /** Guarda el tamaño tras soltar una asa de redimensionado. */
  const onResizeEnd = useCallback(
    (id: string, box: { x: number; y: number; width: number; height: number }) => {
      const isZone = id.startsWith('zone:');
      const layout = {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
      void mutate(
        isZone
          ? { op: 'zone.update', id: id.slice('zone:'.length), patch: { layout } }
          : { op: 'node.update', id, patch: { layout } },
      );
    },
    [mutate],
  );

  const decorate = useCallback(
    (list: Node[]): Node[] => {
      const active = flow ? new Set(flow.nodeIds) : null;
      return list.map((node) => {
        const classes: string[] = [];
        if (node.type !== 'zone' && active && !active.has(node.id) && !editing) {
          classes.push('is-out-of-flow');
        }
        const isSelected =
          (selection?.kind === 'node' && selection.id === node.id) ||
          (selection?.kind === 'zone' && `zone:${selection.id}` === node.id);
        if (isSelected) classes.push('is-selected');
        if (pathMode && node.id === pathStart) classes.push('is-path-start');

        return {
          ...node,
          data: {
            ...node.data,
            editing,
            onResizeEnd,
            onLabelChange: (id: string, label: string) => {
              void mutate(
                node.type === 'zone'
                  ? { op: 'zone.update', id, patch: { label } }
                  : { op: 'node.update', id, patch: { label } },
              );
            },
          },
          className: classes.join(' ') || undefined,
          // El resizer solo aparece en el nodo seleccionado de React Flow, así
          // que la selección del inspector tiene que reflejarse aquí también.
          selected: isSelected,
          draggable: editing,
          selectable: editing,
        };
      });
    },
    [flow, editing, selection, onResizeEnd, pathMode, pathStart, mutate],
  );

  useEffect(() => {
    if (!computed) return;
    measurer.invalidate();
    setNodes(decorate(computed.nodes));

    // Encuadrar solo al cambiar de diagrama. Hacerlo en cada guardado movería
    // la cámara bajo el ratón mientras se edita.
    if (lastDiagram.current !== ir.meta.name) {
      lastDiagram.current = ir.meta.name;
      requestAnimationFrame(() => fitView(FIT_VIEW));
    }
  }, [computed, decorate, fitView, ir.meta.name]);

  // El modo presentación cambia mucho el área útil. Reencuadrar aquí evita
  // que conserve el zoom estrecho que tenía mientras se editaba con paneles.
  useEffect(() => {
    if (!presentation) return;
    // React Flow recibe la medida ampliada por ResizeObserver un frame después
    // de que desaparecen los paneles. Dos frames aseguran que `fitView` use
    // el lienzo de presentación, no el ancho residual del editor.
    let nestedFrame = 0;
    const frame = requestAnimationFrame(() => {
      nestedFrame = requestAnimationFrame(() => {
        fitView({ padding: 0.07, duration: 260, minZoom: 0.12, maxZoom: 1.15 });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nestedFrame);
    };
  }, [presentation, fitView]);

  useEffect(() => {
    const target = focusRequest?.selection;
    if (!target || !computed) return;
    const ids = target.kind === 'node'
      ? [target.id]
      : target.kind === 'zone'
        ? [`zone:${target.id}`]
        : target.kind === 'edge'
          ? (() => {
              const edge = ir.edges.find((candidate) => candidate.declaredIndex === target.index);
              return edge ? [edge.source, edge.target] : [];
            })()
          : [];
    if (ids.length === 0) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ nodes: ids.map((id) => ({ id })), padding: 0.8, duration: 380, maxZoom: 1.35 });
    });
    return () => cancelAnimationFrame(frame);
  }, [computed, fitView, focusRequest, ir.edges]);

  const edges = useMemo(() => {
    if (!computed) return [];
    const active = flow ? new Set(flow.steps.map((step) => step.edgeId)) : null;
    return computed.edges.map((edge) => {
      const classes = [];
      if (active) classes.push(active.has(edge.id) ? 'is-in-flow' : 'is-out-of-flow');
      const declaredIndex = (edge.data as EdgeData | undefined)?.edge.declaredIndex;
      const selectedStep = selection?.kind === 'step' && selection.flowId === flow?.id
        ? flow.steps[selection.index]
        : undefined;
      const playingStep = currentStep >= 0 ? flow?.steps[currentStep] : undefined;
      const preferredStep = selectedStep ?? playingStep;
      const activeStep = preferredStep?.edgeId === edge.id
        ? preferredStep
        : flow?.steps.find((step) => step.edgeId === edge.id);
      const isSelected = (selection?.kind === 'edge' && declaredIndex === selection.index)
        || (selection?.kind === 'step' && selection.flowId === flow?.id && activeStep?.index === selection.index);
      if (isSelected) classes.push('is-selected');
      return {
        ...edge,
        className: classes.join(' ') || undefined,
        selected: isSelected,
        reconnectable: editing,
        data: {
          ...edge.data,
          sourceOperation: activeStep?.fromOp,
          targetOperation: activeStep?.toOp,
          activeFlowId: flow?.id,
          activeStep,
          editing,
          onRouteChange: (points: Array<{ x: number; y: number }>) => {
            if (flow && activeStep) {
              void mutate({
                op: 'step.update',
                flowId: flow.id,
                index: activeStep.index,
                patch: { layout: { ...activeStep.layout, points } },
              });
              return;
            }
            const current = ir.edges.find((candidate) => candidate.declaredIndex === declaredIndex);
            if (current?.declaredIndex === undefined) return;
            void mutate({ op: 'edge.update', index: current.declaredIndex, patch: { layout: { ...current.layout, points } } });
          },
          onEndpointChange: (end: 'source' | 'target', anchor: { x: number; y: number }) => {
            if (flow && activeStep) {
              void mutate({
                op: 'step.update',
                flowId: flow.id,
                index: activeStep.index,
                patch: {
                  layout: {
                    ...activeStep.layout,
                    [end === 'source' ? 'sourceAnchor' : 'targetAnchor']: anchor,
                  },
                },
              });
              return;
            }
            const current = ir.edges.find((candidate) => candidate.declaredIndex === declaredIndex);
            if (current?.declaredIndex === undefined) return;
            void mutate({
              op: 'edge.update',
              index: current.declaredIndex,
              patch: {
                layout: {
                  ...current.layout,
                  [end === 'source' ? 'sourceAnchor' : 'targetAnchor']: anchor,
                },
              },
            });
          },
          onLabelPositionChange: (position: { x: number; y: number }) => {
            if (!flow || !activeStep) return;
            void mutate({ op: 'step.update', flowId: flow.id, index: activeStep.index, patch: { labelPosition: position } });
          },
          onLabelChange: (label: string) => {
            if (!flow || !activeStep) return;
            void mutate({ op: 'step.update', flowId: flow.id, index: activeStep.index, patch: { label } });
          },
        },
      };
    });
  }, [computed, currentStep, editing, flow, ir.edges, mutate, selection]);
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  // Con el diagrama moviéndose bajo el ratón, la animación estorba.
  const onNodeDragStart = useCallback<OnNodeDrag>(() => clock.pause(), []);

  /** Al soltar un nodo se fija su posición en el YAML. */
  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) => {
      if (node.type === 'zone') {
        const zone = ir.zones.find((candidate) => `zone:${candidate.id}` === node.id);
        void mutate({
          op: 'zone.update',
          id: node.id.slice('zone:'.length),
          patch: {
            layout: {
              x: Math.round(node.position.x),
              y: Math.round(node.position.y),
              width: Math.round(node.measured?.width ?? zone?.layout?.width ?? 260),
              height: Math.round(node.measured?.height ?? zone?.layout?.height ?? 140),
            },
          },
        });
        return;
      }
      void mutate({
        op: 'node.update',
        id: node.id,
        patch: { layout: { x: Math.round(node.position.x), y: Math.round(node.position.y) } },
      });
    },
    [ir.zones, mutate],
  );

  /**
   * Conectar dos nodos no crea una arista: crea un PASO en el flujo activo.
   * Las aristas del diagrama se infieren de los pasos, así que exponer un
   * "dibujar flecha" sería mentirle al usuario sobre el modelo.
   */
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!flow || !connection.source || !connection.target) return;
      void mutate({
        op: 'step.add',
        flowId: flow.id,
        step: { from: connection.source, to: connection.target },
      }).then((ok) => {
        if (ok) onSelect({ kind: 'step', flowId: flow.id, index: flow.steps.length });
      });
    },
    [flow, mutate, onSelect],
  );

  const onReconnect = useCallback<OnReconnect>(
    (oldEdge, connection) => {
      const data = oldEdge.data as EdgeData | undefined;
      const edge = data?.edge;
      if (!edge || !connection.source || !connection.target) return;
      const anchor = (handle: string | null | undefined) => {
        if (handle === 'top') return { x: 0.5, y: 0 };
        if (handle === 'right') return { x: 1, y: 0.5 };
        if (handle === 'bottom') return { x: 0.5, y: 1 };
        if (handle === 'left') return { x: 0, y: 0.5 };
        return undefined;
      };
      if (flow && data?.activeStep) {
        const step = data.activeStep;
        const reference = (nodeId: string, previousNode: string, operation: string | undefined) =>
          nodeId === previousNode && operation ? `${nodeId}/${operation}` : nodeId;
        void mutate({
          op: 'step.update',
          flowId: flow.id,
          index: step.index,
          patch: {
            from: reference(connection.source, step.from, step.fromOp),
            to: reference(connection.target, step.to, step.toOp),
            layout: {
              ...step.layout,
              sourceAnchor: anchor(connection.sourceHandle) ?? step.layout?.sourceAnchor,
              targetAnchor: anchor(connection.targetHandle) ?? step.layout?.targetAnchor,
            },
          },
        });
        return;
      }
      if (edge.declaredIndex === undefined) return;
      const { sourcePoint: _sourcePoint, targetPoint: _targetPoint, ...layout } = edge.layout ?? {};
      void mutate({
        op: 'edge.update',
        index: edge.declaredIndex,
        patch: {
          from: connection.source,
          to: connection.target,
          sourceInferred: undefined,
          targetInferred: undefined,
          note: undefined,
          layout: {
            ...layout,
            sourceAnchor: anchor(connection.sourceHandle) ?? edge.layout?.sourceAnchor,
            targetAnchor: anchor(connection.targetHandle) ?? edge.layout?.targetAnchor,
          },
        },
      });
    },
    [flow, mutate],
  );

  if (!computed) {
    return (
      <div className="canvas canvas--loading">
        <span className="spinner" aria-hidden="true" />
        <p>Calculando el layout…</p>
      </div>
    );
  }

  return (
    <div className={`canvas${editing ? ' canvas--editing' : ''}${presentation ? ' canvas--presentation' : ''}${minimapOpen && !presentation ? ' canvas--minimap-open' : ''}${ir.meta.layoutMode === 'faithful' ? ' canvas--faithful' : ''}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onReconnect={onReconnect}
        reconnectRadius={6}
        onNodeClick={(_event, node) => {
          if (node.type !== 'zone' && onPathNodeClick?.(node.id)) return;
          onSelect(node.type === 'zone' ? { kind: 'zone', id: node.id.slice('zone:'.length) } : { kind: 'node', id: node.id });
        }}
        onEdgeClick={(_event, edge) => {
          const activeStep = (edge.data as EdgeData | undefined)?.activeStep;
          if (flow && activeStep) {
            onSelect({ kind: 'step', flowId: flow.id, index: activeStep.index });
            return;
          }
          const index = (edge.data as EdgeData | undefined)?.edge.declaredIndex;
          if (index !== undefined) onSelect({ kind: 'edge', index });
        }}
        onPaneClick={() => onSelect(null)}
        nodesDraggable={editing}
        nodesConnectable={editing}
        elementsSelectable={editing}
        edgesFocusable={editing}
        edgesReconnectable={editing}
        // En modo suelto cualquier conector sirve de origen y de destino, que
        // es lo que permite tener uno por lado sin duplicarlos.
        connectionMode={ConnectionMode.Loose}
        proOptions={{ hideAttribution: true }}
        minZoom={0.15}
        maxZoom={2.5}
        fitView
        fitViewOptions={FIT_VIEW}
      >
        {/* Cuadrícula en dos niveles: la fina para alinear al arrastrar, la
            gruesa para dar escala sin saturar la vista. */}
        <Background id="fina" variant={BackgroundVariant.Lines} gap={24} lineWidth={1} color="var(--grid-fine)" />
        <Background id="gruesa" variant={BackgroundVariant.Lines} gap={120} lineWidth={1} color="var(--grid-major)" />
        <Controls showInteractive={false} />
        {minimapOpen && <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="var(--minimap-mask)" />}
        {!presentation && (
          <button
            type="button"
            className={`minimap-toggle nodrag nopan${minimapOpen ? ' is-open' : ''}`}
            aria-label={minimapOpen ? 'Minimizar vista previa' : 'Mostrar vista previa'}
            title={minimapOpen ? 'Minimizar vista previa' : 'Mostrar vista previa'}
            onClick={() => setMinimapOpen((open) => !open)}
          >{minimapOpen ? '−' : 'Mapa'}</button>
        )}
        <FlowPackets flow={flow} animation={animation} onStepChange={onStepChange} />
      </ReactFlow>
    </div>
  );
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export type { EdgeData };
