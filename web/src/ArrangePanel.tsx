import type { Ir } from '@archiflow/schema';
import type { Mutation } from '@archiflow/shared';
import { SelectField } from './fields';
import type { Selection } from './selection';

interface Props {
  ir: Ir;
  selection: Selection;
  mutate: (...mutations: Mutation[]) => Promise<boolean>;
}

export function ArrangePanel({ ir, selection, mutate }: Props) {
  if (!selection) return <Empty text="Selecciona un elemento para organizarlo." />;

  if (selection.kind === 'node') {
    const node = ir.nodes.find((candidate) => candidate.id === selection.id);
    if (!node) return null;
    return <div className="inspector arrange-panel">
      <header className="inspector__header"><span className="inspector__kind">Organizar cuadro</span></header>
      <SelectField label="Contenedor" value={node.zone} options={ir.zones.map((zone) => ({ value: zone.id, label: zone.label }))} allowEmpty="(sin contenedor)" onCommit={(value) => void mutate({ op: 'node.update', id: node.id, patch: { zone: value || undefined, layout: undefined } })} />
      <div className="arrange-panel__status"><b>Posición</b><span>{node.layout ? `${Math.round(node.layout.x)}, ${Math.round(node.layout.y)}` : 'Automática'}</span></div>
      <div className="arrange-panel__status"><b>Tamaño</b><span>{node.layout?.width && node.layout?.height ? `${Math.round(node.layout.width)} × ${Math.round(node.layout.height)}` : 'Automático'}</span></div>
      <p>Arrastra el cuadro para fijar su posición. Usa los tiradores del borde para cambiar su tamaño.</p>
      <button type="button" className="inspector__reset" disabled={!node.layout} onClick={() => void mutate({ op: 'node.update', id: node.id, patch: { layout: undefined } })}>Devolver al orden automático</button>
    </div>;
  }

  if (selection.kind === 'zone') {
    const zone = ir.zones.find((candidate) => candidate.id === selection.id);
    if (!zone) return null;
    return <div className="inspector arrange-panel">
      <header className="inspector__header"><span className="inspector__kind">Organizar contenedor</span></header>
      <div className="arrange-panel__status"><b>Cuadros dentro</b><span>{zone.nodeIds.length}</span></div>
      <div className="arrange-panel__status"><b>Posición</b><span>{zone.layout ? `${Math.round(zone.layout.x)}, ${Math.round(zone.layout.y)}` : 'Automática'}</span></div>
      <p>Arrastra el contenedor para mover el grupo. Redimensionarlo no cambia los textos internos.</p>
      <button type="button" className="inspector__reset" disabled={!zone.layout} onClick={() => void mutate({ op: 'zone.update', id: zone.id, patch: { layout: undefined } })}>Devolver al orden automático</button>
    </div>;
  }

  if (selection.kind === 'step') {
    const flow = ir.flows.find((candidate) => candidate.id === selection.flowId);
    const step = flow?.steps[selection.index];
    if (!flow || !step) return null;
    const { points: _points, ...layout } = step.layout ?? { points: [] };
    return <div className="inspector arrange-panel">
      <header className="inspector__header"><span className="inspector__kind">Organizar flecha</span></header>
      <div className="arrange-panel__status"><b>Codos manuales</b><span>{step.layout?.points?.length ?? 0}</span></div>
      <p>En el canvas: cuadrados azules mueven codos, rombos blancos crean uno y los extremos cambian el punto de conexión.</p>
      <button type="button" className="inspector__reset" onClick={() => void mutate({ op: 'step.update', flowId: flow.id, index: selection.index, patch: { layout: Object.keys(layout).length ? layout : undefined } })}>Simplificar ruta</button>
    </div>;
  }

  if (selection.kind === 'flow') {
    const flow = ir.flows.find((candidate) => candidate.id === selection.id);
    return <div className="inspector arrange-panel">
      <header className="inspector__header"><span className="inspector__kind">Orden del flujo</span></header>
      <div className="arrange-panel__status"><b>Pasos</b><span>{flow?.steps.length ?? 0}</span></div>
      <p>Selecciona un paso en el panel izquierdo y usa “Subir” o “Bajar” en Texto para cambiar su orden de ejecución.</p>
    </div>;
  }

  return <Empty text="Selecciona el paso correspondiente para organizar esta conexión." />;
}

function Empty({ text }: { text: string }) {
  return <div className="inspector inspector--empty"><p>{text}</p></div>;
}
