import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Node,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import { applyLayoutOverrides, computeBaseLayout, layoutSignature, type LaidOutGraph } from '@archiflow/layout';
import type { Ir, IrFlow } from '@archiflow/schema';
import type { Mutation } from '@archiflow/shared';
import { toReactFlow, type EdgeData } from './layout';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { FlowPackets } from './packets';
import { measurer } from './edgeRegistry';
import type { Selection } from './selection';

interface Props {
  ir: Ir;
  flow: IrFlow | null;
  editing: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onStepChange: (index: number) => void;
  mutate: (...mutations: Mutation[]) => Promise<boolean>;
}

function CanvasInner({ ir, flow, editing, selection, onSelect, onStepChange, mutate }: Props) {
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
  const decorate = useCallback(
    (list: Node[]): Node[] => {
      const active = flow ? new Set(flow.nodeIds) : null;
      return list.map((node) => {
        const classes: string[] = [];
        if (node.type !== 'zone' && active && !active.has(node.id) && !editing) {
          classes.push('is-out-of-flow');
        }
        if (
          (selection?.kind === 'node' && selection.id === node.id) ||
          (selection?.kind === 'zone' && `zone:${selection.id}` === node.id)
        ) {
          classes.push('is-selected');
        }
        return {
          ...node,
          className: classes.join(' ') || undefined,
          draggable: editing && node.type !== 'zone',
          connectable: editing && node.type !== 'zone',
          selectable: editing,
        };
      });
    },
    [flow, editing, selection],
  );

  useEffect(() => {
    if (!computed) return;
    measurer.invalidate();
    setNodes(decorate(computed.nodes));

    // Encuadrar solo al cambiar de diagrama. Hacerlo en cada guardado movería
    // la cámara bajo el ratón mientras se edita.
    if (lastDiagram.current !== ir.meta.name) {
      lastDiagram.current = ir.meta.name;
      requestAnimationFrame(() => fitView({ padding: 0.14, duration: 400 }));
    }
  }, [computed, decorate, fitView, ir.meta.name]);

  const edges = useMemo(() => {
    if (!computed) return [];
    if (!flow) return computed.edges;
    const active = new Set(flow.steps.map((step) => step.edgeId));
    return computed.edges.map((edge) => ({
      ...edge,
      className: active.has(edge.id) ? 'is-in-flow' : 'is-out-of-flow',
    }));
  }, [computed, flow]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

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

  if (!computed) {
    return (
      <div className="canvas canvas--loading">
        <span className="spinner" aria-hidden="true" />
        <p>Calculando el layout…</p>
      </div>
    );
  }

  return (
    <div className={`canvas${editing ? ' canvas--editing' : ''}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodeClick={(_event, node) =>
          onSelect(
            node.type === 'zone'
              ? { kind: 'zone', id: node.id.slice('zone:'.length) }
              : { kind: 'node', id: node.id },
          )
        }
        onPaneClick={() => onSelect(null)}
        nodesDraggable={editing}
        nodesConnectable={editing}
        elementsSelectable={editing}
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.15}
        maxZoom={2.5}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e293b" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="rgba(2,6,23,0.7)" />
        <FlowPackets flow={flow} onStepChange={onStepChange} />
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
