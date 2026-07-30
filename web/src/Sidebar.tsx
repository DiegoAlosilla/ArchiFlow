import type { Ir, IrFlow } from '@archiflow/schema';
import type { DiagramEntry, Mutation } from '@archiflow/shared';
import { clock } from './playback';
import { protocolColor } from './kinds';
import type { Selection } from './selection';

interface Props {
  ir: Ir | null;
  diagrams: DiagramEntry[];
  selectedDiagram: DiagramEntry | null;
  onSelectDiagram: (id: string) => void;
  flows: IrFlow[];
  selectedFlow: IrFlow | null;
  onSelectFlow: (id: string) => void;
  currentStep: number;
  editing: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  mutate: (...mutations: Mutation[]) => Promise<boolean>;
}

/** Sufija un id numérico hasta que no colisione. */
function freshId(prefix: string, taken: Set<string>): string {
  for (let i = 1; ; i++) {
    const candidate = `${prefix}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function Sidebar({
  ir,
  diagrams,
  selectedDiagram,
  onSelectDiagram,
  flows,
  selectedFlow,
  onSelectFlow,
  currentStep,
  editing,
  selection,
  onSelect,
  mutate,
}: Props) {
  const issues = selectedDiagram?.issues ?? [];
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');

  const addFlow = () => {
    const id = freshId('flujo', new Set(flows.map((flow) => flow.id)));
    void mutate({ op: 'flow.add', flow: { id, label: 'Flujo nuevo' } }).then((ok) => {
      if (ok) {
        onSelectFlow(id);
        onSelect({ kind: 'flow', id });
      }
    });
  };

  const addStep = () => {
    if (!selectedFlow || !ir || ir.nodes.length < 2) return;
    const from = selectedFlow.steps.at(-1)?.to ?? ir.nodes[0]!.id;
    const to = ir.nodes.find((node) => node.id !== from)?.id ?? ir.nodes[0]!.id;
    const index = selectedFlow.steps.length;
    void mutate({ op: 'step.add', flowId: selectedFlow.id, step: { from, to } }).then((ok) => {
      if (ok) onSelect({ kind: 'step', flowId: selectedFlow.id, index });
    });
  };

  return (
    <aside className="sidebar">
      {diagrams.length > 1 && (
        <section className="panel">
          <h2 className="panel__title">Diagramas</h2>
          <ul className="list">
            {diagrams.map((diagram) => (
              <li key={diagram.id}>
                <button
                  type="button"
                  className={`list__item${diagram.id === selectedDiagram?.id ? ' is-selected' : ''}`}
                  onClick={() => onSelectDiagram(diagram.id)}
                >
                  <span className="list__label">{diagram.name}</span>
                  <span className="list__meta">{diagram.file}</span>
                  {!diagram.ok && <span className="badge badge--error">error</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">
          Flujos
          {editing && (
            <button type="button" className="panel__action" onClick={addFlow}>
              + Nuevo
            </button>
          )}
        </h2>
        {flows.length === 0 ? (
          <p className="panel__empty">
            Este diagrama no declara flujos.{' '}
            {editing ? 'Crea uno para poder animarlo.' : 'Añade una sección flows: para poder animarlo.'}
          </p>
        ) : (
          <ul className="list">
            {flows.map((flow) => (
              <li key={flow.id}>
                <button
                  type="button"
                  className={`list__item${flow.id === selectedFlow?.id ? ' is-selected' : ''}`}
                  onClick={() => {
                    onSelectFlow(flow.id);
                    if (editing) onSelect({ kind: 'flow', id: flow.id });
                  }}
                >
                  <span className="list__label">{flow.label}</span>
                  <span className="list__meta">
                    {flow.steps.length} pasos
                    {flow.level === 'method' && ' · nivel método'}
                  </span>
                  {flow.trigger && <span className="list__note">{flow.trigger}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedFlow && (
        <section className="panel panel--grow">
          <h2 className="panel__title">
            Recorrido
            {editing && (
              <button type="button" className="panel__action" onClick={addStep}>
                + Paso
              </button>
            )}
          </h2>

          {selectedFlow.steps.length === 0 ? (
            <p className="panel__empty">
              Flujo sin pasos.{' '}
              {editing && 'Añade uno, o arrastra de un nodo a otro en el lienzo.'}
            </p>
          ) : (
            <ol className="steps">
              {selectedFlow.steps.map((step, i) => {
                const isSelected =
                  selection?.kind === 'step' && selection.flowId === selectedFlow.id && selection.index === i;
                return (
                  <li key={`${step.edgeId}-${i}`}>
                    <button
                      type="button"
                      className={`step${i === currentStep ? ' is-current' : ''}${step.async ? ' step--async' : ''}${isSelected ? ' is-picked' : ''}`}
                      style={{ '--step-color': protocolColor[step.protocol] } as React.CSSProperties}
                      onClick={() => {
                        clock.seek(step.startMs);
                        if (editing) onSelect({ kind: 'step', flowId: selectedFlow.id, index: i });
                      }}
                    >
                      <span className="step__index">{i + 1}</span>
                      <span className="step__body">
                        <span className="step__route">
                          {step.from} <span className="step__arrow">→</span> {step.to}
                        </span>
                        <span className="step__op">{step.label}</span>
                        <span className="step__tags">
                          <span className="tag" style={{ color: protocolColor[step.protocol] }}>
                            {step.protocol}
                          </span>
                          {step.async && <span className="tag tag--async">async</span>}
                          {step.condition && <span className="tag tag--cond">{step.condition}</span>}
                          {step.latencyMs !== undefined && (
                            <span className="tag tag--latency">{step.latencyMs} ms</span>
                          )}
                        </span>
                        {step.note && <span className="step__note">{step.note}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {issues.length > 0 && (
        <section className="panel panel--issues">
          <h2 className="panel__title">
            Validación
            {errors.length > 0 && <span className="badge badge--error">{errors.length}</span>}
            {warnings.length > 0 && <span className="badge badge--warning">{warnings.length}</span>}
          </h2>
          <ul className="issues">
            {issues.map((issue, i) => (
              <li key={i} className={`issue issue--${issue.level}`}>
                {issue.line !== undefined && <span className="issue__line">L{issue.line}</span>}
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

export { freshId };
