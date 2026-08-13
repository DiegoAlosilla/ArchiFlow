import { HTTP_METHODS, NODE_KINDS, PROTOCOLS, type Ir } from '@archiflow/schema';
import type { Mutation } from '@archiflow/shared';
import { CheckboxField, NumberField, SelectField, TextField } from './fields';
import { kindLabel } from './kinds';
import type { Selection } from './selection';

/**
 * Editor de propiedades de lo que esté seleccionado.
 *
 * Cada campo emite una mutación semántica, nunca un documento completo. El
 * `id` se edita con `*.rename`, que en el servidor arrastra todas las
 * referencias: renombrar un nodo desde aquí actualiza también los pasos que lo
 * usan, que a mano es justo lo que se olvida.
 */

interface Props {
  ir: Ir;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  mutate: (...mutations: Mutation[]) => Promise<boolean>;
}

const KIND_OPTIONS = NODE_KINDS.map((kind) => ({ value: kind, label: kindLabel[kind] }));
const PROTOCOL_OPTIONS = [...PROTOCOLS];

export function Inspector({ ir, selection, onSelect, mutate }: Props) {
  if (!selection) {
    return (
      <div className="inspector inspector--empty">
        <p>Selecciona un nodo, una zona o un paso para editarlo.</p>
        <p className="inspector__tip">
          Arrastra desde el borde de un nodo hasta otro para añadir un paso al flujo activo.
        </p>
      </div>
    );
  }

  if (selection.kind === 'node') return <NodeInspector {...{ ir, selection, onSelect, mutate }} />;
  if (selection.kind === 'operation') return <OperationInspector {...{ ir, selection, onSelect, mutate }} />;
  if (selection.kind === 'zone') return <ZoneInspector {...{ ir, selection, onSelect, mutate }} />;
  if (selection.kind === 'flow') return <FlowInspector {...{ ir, selection, onSelect, mutate }} />;
  if (selection.kind === 'edge') return <EdgeInspector {...{ ir, selection, onSelect, mutate }} />;
  return <StepInspector {...{ ir, selection, onSelect, mutate }} />;
}

function OperationInspector({ ir, selection, mutate }: Props) {
  if (selection?.kind !== 'operation') return null;
  const node = ir.nodes.find((candidate) => candidate.id === selection.nodeId);
  const operation = node?.provides[selection.index];
  if (!node || !operation) return <div className="inspector inspector--empty"><p>Este endpoint ya no existe.</p></div>;

  const patch = (fields: Record<string, unknown>) => {
    const provides = node.provides.map((candidate, index) => index === selection.index ? { ...candidate, ...fields } : candidate);
    void mutate({ op: 'node.update', id: node.id, patch: { provides } });
  };

  return <div className="inspector">
    <header className="inspector__header">
      <span className="inspector__kind">Endpoint · {node.label}</span>
    </header>
    <SelectField label="Método" value={operation.method} options={[...HTTP_METHODS]} allowEmpty="(sin método)" onCommit={(value) => patch({ method: value || undefined })} />
    <TextField label="Ruta completa" value={operation.path} mono placeholder="/v1/recurso/{id}" onCommit={(value) => patch({ path: value })} />
    <TextField label="Nombre" value={operation.label} onCommit={(value) => patch({ label: value })} />
    <TextField label="Descripción" value={operation.description} multiline onCommit={(value) => patch({ description: value })} />
    <div className="inspector__meta">ID de conexión: <code>{operation.id ?? '(sin id)'}</code>. La tarjeta pertenece al microservicio y no se mueve por separado. La ruta se muestra completa en el canvas.</div>
  </div>;
}

function EdgeInspector({ ir, selection, mutate }: Props) {
  if (selection?.kind !== 'edge') return null;
  const edge = ir.edges.find((candidate) => candidate.declaredIndex === selection.index);
  if (!edge) return <div className="inspector inspector--empty"><p>Esta conexión ya no existe.</p></div>;
  const patch = (fields: Record<string, unknown>) => void mutate({ op: 'edge.update', index: selection.index, patch: fields });
  const nodeOptions = ir.nodes.map((node) => ({ value: node.id, label: node.label }));
  const styleParts = (edge.layout?.style ?? '').split(';').filter(Boolean);
  const styleValue = (key: string) => styleParts
    .map((part) => part.split('='))
    .find(([candidate]) => candidate?.toLowerCase() === key.toLowerCase())?.[1];
  const updateStyle = (key: string, value: string | number | undefined) => {
    const next = styleParts.filter((part) => part.split('=')[0]?.toLowerCase() !== key.toLowerCase());
    if (value !== undefined && value !== '') next.push(`${key}=${value}`);
    patch({ layout: { ...edge.layout, style: `${next.join(';')};` } });
  };
  const clearPoints = () => {
    const { points: _points, ...layout } = edge.layout ?? {};
    patch({ layout });
  };
  return (
    <div className="inspector">
      <header className="inspector__header"><span className="inspector__kind">Conexión {selection.index + 1}</span></header>
      {(edge.sourceInferred || edge.targetInferred) && (
        <div className="inspector__proposal">
          <b>Propuesta de ArquiFlow</b>
          <p>{edge.note ?? 'Draw.io dejó un extremo sin conectar. Se eligió la caja más cercana.'}</p>
          <button type="button" className="inspector__reset" onClick={() => patch({ sourceInferred: undefined, targetInferred: undefined, note: undefined })}>
            Aceptar propuesta
          </button>
        </div>
      )}
      <SelectField label="Desde" value={edge.source} options={nodeOptions} onCommit={(value) => patch({ from: value, sourceInferred: undefined })} />
      <SelectField label="Hasta" value={edge.target} options={nodeOptions} onCommit={(value) => patch({ to: value, targetInferred: undefined })} />
      <TextField label="Etiqueta" value={edge.labels[0]} mono onCommit={(value) => patch({ label: value })} />
      <SelectField label="Protocolo" value={edge.protocol} options={PROTOCOL_OPTIONS} onCommit={(value) => patch({ protocol: value })} />
      <CheckboxField label="Asíncrona" value={edge.async} onCommit={(value) => patch({ async: value ? true : undefined })} />
      <div className="inspector__section-title">Línea</div>
      <TextField label="Color" value={styleValue('strokeColor')} mono placeholder="#808080" onCommit={(value) => updateStyle('strokeColor', value)} />
      <NumberField label="Grosor" value={Number(styleValue('strokeWidth')) || 1} onCommit={(value) => updateStyle('strokeWidth', value)} />
      <SelectField
        label="Punta final"
        value={edge.layout?.endArrow ?? 'open'}
        options={[
          { value: 'open', label: 'Abierta' },
          { value: 'block', label: 'Bloque' },
          { value: 'diamond', label: 'Diamante' },
          { value: 'none', label: 'Sin punta' },
        ]}
        onCommit={(value) => patch({ layout: { ...edge.layout, endArrow: value } })}
      />
      <div className="inspector__route">
        <b>Editar recorrido</b>
        <p>{edge.layout?.points?.length ?? 0} puntos importados. En el lienzo, arrastra los cuadrados azules; pulsa un rombo blanco para crear otro codo.</p>
        <button type="button" className="inspector__reset" disabled={!edge.layout?.points?.length} onClick={clearPoints}>
          Quitar puntos de control
        </button>
      </div>
      <div className="inspector__meta">También puedes arrastrar los extremos de la flecha hacia otra caja, igual que en Draw.io.</div>
    </div>
  );
}

function NodeInspector({ ir, selection, onSelect, mutate }: Props) {
  if (selection?.kind !== 'node') return null;
  const node = ir.nodes.find((candidate) => candidate.id === selection.id);
  if (!node) return null;

  const patch = (fields: Record<string, unknown>) =>
    void mutate({ op: 'node.update', id: node.id, patch: fields });

  const usedIn = ir.flows.filter((flow) => flow.nodeIds.includes(node.id));

  return (
    <div className="inspector">
      <header className="inspector__header">
        <span className="inspector__kind">Nodo</span>
        <button
          type="button"
          className="inspector__delete"
          onClick={() => void mutate({ op: 'node.remove', id: node.id }).then((ok) => ok && onSelect(null))}
        >
          Borrar
        </button>
      </header>

      <TextField
        label="id"
        value={node.id}
        mono
        hint="Al cambiarlo se actualizan todos los pasos que lo referencian."
        onCommit={(value) => {
          if (value && value !== node.id) {
            void mutate({ op: 'node.rename', id: node.id, newId: value }).then(
              (ok) => ok && onSelect({ kind: 'node', id: value }),
            );
          }
        }}
      />

      <TextField label="Nombre" value={node.label} onCommit={(value) => patch({ label: value })} />

      <SelectField
        label="Tipo"
        value={node.kind}
        options={KIND_OPTIONS}
        onCommit={(value) => patch({ kind: value })}
      />

      <SelectField
        label="Zona"
        value={node.zone}
        options={ir.zones.map((zone) => ({ value: zone.id, label: zone.label }))}
        allowEmpty="(sin zona)"
        onCommit={(value) => patch({ zone: value || undefined, layout: undefined })}
        hint="Cambiar de zona descarta la posición fijada."
      />

      <TextField
        label="Tecnología"
        value={node.tech}
        placeholder="Quarkus 3, Oracle 19c…"
        onCommit={(value) => patch({ tech: value })}
      />

      <TextField
        label="Plataforma"
        value={node.platform}
        placeholder="Hereda la de la zona"
        onCommit={(value) => patch({ platform: value })}
      />

      <TextField
        label="Descripción"
        value={node.description}
        multiline
        onCommit={(value) => patch({ description: value })}
      />

      <TextField
        label="Repositorio"
        value={node.repo}
        mono
        placeholder="git@…"
        onCommit={(value) => patch({ repo: value })}
      />

      <CheckboxField
        label="Externo al equipo"
        value={node.external}
        hint="Se dibuja con trazo discontinuo."
        onCommit={(value) => patch({ external: value ? true : undefined })}
      />

      {node.layout && (
        <button type="button" className="inspector__reset" onClick={() => patch({ layout: undefined })}>
          Devolver al layout automático
        </button>
      )}

      {usedIn.length > 0 && (
        <div className="inspector__meta">
          Participa en: {usedIn.map((flow) => flow.label).join(', ')}
        </div>
      )}
    </div>
  );
}

function ZoneInspector({ ir, selection, onSelect, mutate }: Props) {
  if (selection?.kind !== 'zone') return null;
  const zone = ir.zones.find((candidate) => candidate.id === selection.id);
  if (!zone) return null;

  const patch = (fields: Record<string, unknown>) =>
    void mutate({ op: 'zone.update', id: zone.id, patch: fields });

  return (
    <div className="inspector">
      <header className="inspector__header">
        <span className="inspector__kind">Zona</span>
        <button
          type="button"
          className="inspector__delete"
          onClick={() => void mutate({ op: 'zone.remove', id: zone.id }).then((ok) => ok && onSelect(null))}
        >
          Borrar
        </button>
      </header>

      <TextField
        label="id"
        value={zone.id}
        mono
        hint="Los nodos de la zona se reapuntan solos."
        onCommit={(value) => {
          if (value && value !== zone.id) {
            void mutate({ op: 'zone.rename', id: zone.id, newId: value }).then(
              (ok) => ok && onSelect({ kind: 'zone', id: value }),
            );
          }
        }}
      />

      <TextField label="Nombre" value={zone.label} onCommit={(value) => patch({ label: value })} />

      <TextField
        label="Plataforma"
        value={zone.platform}
        placeholder="AKS-PROD-01, On-premise…"
        onCommit={(value) => patch({ platform: value })}
      />

      <TextField
        label="Color"
        value={zone.color}
        mono
        placeholder="#6366f1"
        onCommit={(value) => patch({ color: value })}
      />

      <div className="inspector__meta">{zone.nodeIds.length} nodo(s)</div>
    </div>
  );
}

function FlowInspector({ ir, selection, onSelect, mutate }: Props) {
  if (selection?.kind !== 'flow') return null;
  const flow = ir.flows.find((candidate) => candidate.id === selection.id);
  if (!flow) return null;

  const patch = (fields: Record<string, unknown>) =>
    void mutate({ op: 'flow.update', id: flow.id, patch: fields });

  return (
    <div className="inspector">
      <header className="inspector__header">
        <span className="inspector__kind">Flujo</span>
        <button
          type="button"
          className="inspector__delete"
          onClick={() => void mutate({ op: 'flow.remove', id: flow.id }).then((ok) => ok && onSelect(null))}
        >
          Borrar
        </button>
      </header>

      <TextField label="Nombre" value={flow.label} onCommit={(value) => patch({ label: value })} />

      <TextField
        label="Disparador"
        value={flow.trigger}
        placeholder='El usuario abre "Mis cuentas"'
        onCommit={(value) => patch({ trigger: value })}
      />

      <TextField
        label="Descripción"
        value={flow.description}
        multiline
        onCommit={(value) => patch({ description: value })}
      />

      <SelectField
        label="Nivel"
        value={flow.level}
        options={[
          { value: 'component', label: 'Componente (infraestructura)' },
          { value: 'method', label: 'Método (interno del servicio)' },
        ]}
        onCommit={(value) => patch({ level: value })}
      />

      <SelectField
        label="Entrada"
        value={flow.entry}
        options={ir.nodes.map((node) => ({ value: node.id, label: node.label }))}
        allowEmpty="(el origen del primer paso)"
        onCommit={(value) => patch({ entry: value || undefined })}
      />
    </div>
  );
}

function StepInspector({ ir, selection, onSelect, mutate }: Props) {
  if (selection?.kind !== 'step') return null;
  const flow = ir.flows.find((candidate) => candidate.id === selection.flowId);
  const step = flow?.steps[selection.index];
  if (!flow || !step) return null;

  const patch = (fields: Record<string, unknown>) =>
    void mutate({ op: 'step.update', flowId: flow.id, index: selection.index, patch: fields });

  const nodeOptions = ir.nodes.map((node) => ({ value: node.id, label: node.label }));
  const last = flow.steps.length - 1;

  const move = (to: number) => {
    if (to < 0 || to > last) return;
    void mutate({ op: 'step.move', flowId: flow.id, from: selection.index, to }).then(
      (ok) => ok && onSelect({ kind: 'step', flowId: flow.id, index: to }),
    );
  };

  return (
    <div className="inspector">
      <header className="inspector__header">
        <span className="inspector__kind">
          Paso {selection.index + 1} de {flow.steps.length}
        </span>
        <button
          type="button"
          className="inspector__delete"
          onClick={() =>
            void mutate({ op: 'step.remove', flowId: flow.id, index: selection.index }).then(
              (ok) => ok && onSelect({ kind: 'flow', id: flow.id }),
            )
          }
        >
          Borrar
        </button>
      </header>

      <div className="inspector__reorder">
        <button type="button" disabled={selection.index === 0} onClick={() => move(selection.index - 1)}>
          ↑ Subir
        </button>
        <button type="button" disabled={selection.index === last} onClick={() => move(selection.index + 1)}>
          ↓ Bajar
        </button>
      </div>

      <SelectField
        label="Desde"
        value={step.from}
        options={nodeOptions}
        onCommit={(value) => patch({ from: value })}
      />

      <SelectField label="Hasta" value={step.to} options={nodeOptions} onCommit={(value) => patch({ to: value })} />

      <TextField
        label="Operación"
        value={step.label}
        mono
        placeholder="GET /v1/cuentas"
        onCommit={(value) => patch({ op: value })}
      />

      <SelectField
        label="Protocolo"
        value={step.protocol}
        options={PROTOCOL_OPTIONS}
        onCommit={(value) => patch({ protocol: value })}
      />

      <CheckboxField
        label="Asíncrono"
        value={step.async}
        hint="No bloquea el flujo; se dibuja discontinuo."
        onCommit={(value) => patch({ async: value ? true : undefined })}
      />

      <TextField
        label="Condición"
        value={step.condition}
        placeholder="cache miss"
        onCommit={(value) => patch({ condition: value })}
      />

      <NumberField
        label="Latencia (ms)"
        value={step.latencyMs}
        placeholder="sin medir"
        hint="Modula la duración de la animación."
        onCommit={(value) => patch({ latencyMs: value })}
      />

      <TextField
        label="Devuelve"
        value={step.returns}
        placeholder="Listado de cuentas"
        onCommit={(value) => patch({ returns: value })}
      />

      <TextField
        label="Request de ejemplo"
        value={step.request}
        mono
        multiline
        hint="Texto libre; puede ser JSON incompleto durante el diseño."
        onCommit={(value) => patch({ request: value })}
      />

      <TextField
        label="Response de ejemplo"
        value={step.response}
        mono
        multiline
        hint="Texto libre; puede ser JSON incompleto durante el diseño."
        onCommit={(value) => patch({ response: value })}
      />

      <button
        type="button"
        className="inspector__reset"
        onClick={() => {
          const format = (value: string | undefined) => {
            if (!value) return value;
            try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
          };
          void mutate({ op: 'step.update', flowId: flow.id, index: selection.index, patch: { request: format(step.request), response: format(step.response) } });
        }}
      >
        Formatear JSON
      </button>

      <TextField label="Nota" value={step.note} multiline onCommit={(value) => patch({ note: value })} />
    </div>
  );
}
