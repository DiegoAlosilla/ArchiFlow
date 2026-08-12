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
  mutate: (...mutations: Mutation[]) => Promise<boolean>;
  animation: AnimationSettings;
  presentation?: boolean;
  pathMode?: boolean;
  pathStart?: string | null;
  onPathNodeClick?: (nodeId: string) => boolean;
  focusRequest?: { selection: Selection; nonce: number } | null;
}

function CanvasInner({ ir, flow, editing, selection, onSelect, onStepChange, mutate, animation, presentation = false, pathMode = false, pathStart = null, onPathNodeClick, focusRequest }: Props) {
  const [base, setBase] = useState<LaidOutGraph | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
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
          data: { ...node.data, editing, onResizeEnd },
          className: classes.join(' ') || undefined,
          // El resizer solo aparece en el nodo seleccionado de React Flow, así
          // que la selección del inspector tiene que reflejarse aquí también.
          selected: isSelected,
          draggable: editing && node.type !== 'zone',
          selectable: editing,
        };
      });
    },
    [flow, editing, selection, onResizeEnd, pathMode, pathStart],
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
      const isSelected = selection?.kind === 'edge' && declaredIndex === selection.index;
      if (isSelected) classes.push('is-selected');
      return {
        ...edge,
        className: classes.join(' ') || undefined,
        selected: isSelected,
        reconnectable: editing,
        data: {
          ...edge.data,
          editing,
          onRouteChange: (index: number, points: Array<{ x: number; y: number }>) => {
            const current = ir.edges.find((candidate) => candidate.declaredIndex === index);
            if (!current) return;
            void mutate({
              op: 'edge.update',
              index,
              patch: { layout: { ...current.layout, points } },
            });
          },
        },
      };
    });
  }, [computed, editing, flow, ir.edges, mutate, selection]);
  const selectedStep = selection?.kind === 'step' ? ir.flows.find((candidate) => candidate.id === selection.flowId)?.steps[selection.index] : undefined;

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  // Con el diagrama moviéndose bajo el ratón, la animación estorba.
  const onNodeDragStart = useCallback<OnNodeDrag>(() => clock.pause(), []);

  /** Al soltar un nodo se fija su posición en el YAML. */
  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) => {
      if (node.type === 'zone') return;
      void mutate({
        op: 'node.update',
        id: node.id,
        patch: { layout: { x: Math.round(node.position.x), y: Math.round(node.position.y) } },
      });
    },
    [mutate],
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
      const edge = (oldEdge.data as EdgeData | undefined)?.edge;
      if (!edge || edge.declaredIndex === undefined || !connection.source || !connection.target) return;
      const anchor = (handle: string | null | undefined) => {
        if (handle === 'top') return { x: 0.5, y: 0 };
        if (handle === 'right') return { x: 1, y: 0.5 };
        if (handle === 'bottom') return { x: 0.5, y: 1 };
        if (handle === 'left') return { x: 0, y: 0.5 };
        return undefined;
      };
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
    [mutate],
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
    <div className={`canvas${editing ? ' canvas--editing' : ''}${presentation ? ' canvas--presentation' : ''}${ir.meta.layoutMode === 'faithful' ? ' canvas--faithful' : ''}`}>
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
        <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="var(--minimap-mask)" />
        <FlowPackets flow={flow} animation={animation} onStepChange={onStepChange} />
        {selectedStep && (selectedStep.request || selectedStep.response) && (
          <div className="contract-panel">
            {selectedStep.request && <details open><summary>Request</summary><pre>{selectedStep.request}</pre></details>}
            {selectedStep.response && <details open><summary>Response</summary><pre>{selectedStep.response}</pre></details>}
          </div>
        )}
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
