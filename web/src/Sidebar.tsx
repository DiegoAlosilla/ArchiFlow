import { useState } from 'react';
import type { Ir, IrFlow } from '@archiflow/schema';
import type { DiagramEntry, Mutation } from '@archiflow/shared';
import { clock } from './playback';
import { protocolColor } from './kinds';
import type { Selection } from './selection';
import { FIGURES, type FigureDefinition, type FigureGroup } from './figures';
import { kindStyle } from './kinds';

interface Props {
  ir: Ir | null;
  diagrams: DiagramEntry[];
  selectedDiagram: DiagramEntry | null;
  aggregateSelected: boolean;
  onSelectDiagram: (id: string) => void;
  onSelectAggregate: () => void;
  flows: IrFlow[];
  selectedFlow: IrFlow | null;
  onSelectFlow: (id: string) => void;
  currentStep: number;
  editing: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  mutate: (...mutations: Mutation[]) => Promise<boolean>;
  onUseFigure: (figure: FigureDefinition) => void;
  onUseCustomImage: (image: string) => void;
  onIssueClick: (issue: DiagramEntry['issues'][number]) => void;
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
  aggregateSelected,
  onSelectDiagram,
  onSelectAggregate,
  flows,
  selectedFlow,
  onSelectFlow,
  currentStep,
  editing,
  selection,
  onSelect,
  mutate,
  onUseFigure,
  onUseCustomImage,
  onIssueClick,
}: Props) {
  const issues = selectedDiagram?.issues ?? [];
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  const [figureSearch, setFigureSearch] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageError, setImageError] = useState<string | null>(null);
  const selectedNode = selection?.kind === 'node'
    ? ir?.nodes.find((node) => node.id === selection.id)
    : undefined;
  const visibleFigures = FIGURES.filter((figure) => `${figure.label} ${figure.group}`.toLowerCase().includes(figureSearch.toLowerCase()));
  const groups: FigureGroup[] = ['General', 'Azure', 'UML'];

  const useUrl = () => {
    const value = imageUrl.trim();
    if (!/^https?:\/\//i.test(value)) {
      setImageError('Pega una URL que empiece por http:// o https://');
      return;
    }
    setImageError(null);
    onUseCustomImage(value);
  };

  const useFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      setImageError('Usa una imagen PNG, JPG, WebP o SVG.');
      return;
    }
    if (file.size > 1_800_000) {
      setImageError('La imagen debe pesar menos de 1.8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageError(null);
      onUseCustomImage(String(reader.result));
    };
    reader.onerror = () => setImageError('No se pudo leer la imagen.');
    reader.readAsDataURL(file);
  };

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
      {editing && <section className="panel shape-library">
        <input className="shape-library__search" aria-label="Buscar figuras" placeholder="Buscar Azure, UML…" value={figureSearch} onChange={(event) => setFigureSearch(event.target.value)} />
        {selectedNode && <div className="shape-library__target"><b>Aplicar a</b><span>{selectedNode.label}</span></div>}
        {groups.map((group) => {
          const figures = visibleFigures.filter((figure) => figure.group === group);
          if (figures.length === 0) return null;
          return <div className="shape-group" key={group}>
            <h2 className="panel__title">{group}</h2>
            <div className="shape-grid">
              {figures.map((figure) => (
                <button key={figure.id} type="button" className="shape-item" onClick={() => onUseFigure(figure)} title={`${selectedNode ? 'Aplicar a' : 'Añadir'} ${figure.label}`}>
                  <span className="shape-item__glyph" aria-hidden="true">
                    {figure.image ? <img src={figure.image} alt="" /> : <svg viewBox="0 0 24 24">{kindStyle(figure.kind).icon}</svg>}
                  </span>
                  <span>{figure.label}</span>
                </button>
              ))}
            </div>
          </div>;
        })}
        <div className="shape-custom">
          <h2 className="panel__title">Mi imagen</h2>
          <p>Selecciona un cuadro y pega una URL o carga un archivo.</p>
          <div className="shape-custom__url">
            <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…/iphone.svg" aria-label="URL de imagen propia" />
            <button type="button" onClick={useUrl}>Usar</button>
          </div>
          <label className="shape-custom__upload">Cargar PNG, JPG, WebP o SVG<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => useFile(event.target.files?.[0])} /></label>
          {imageError && <span className="shape-custom__error">{imageError}</span>}
        </div>
      </section>}

      {diagrams.length > 1 && (
        <section className="panel">
          <h2 className="panel__title">Diagramas</h2>
          <ul className="list">
            <li>
              <button
                type="button"
                className={`list__item${aggregateSelected ? ' is-selected' : ''}`}
                onClick={onSelectAggregate}
              >
                <span className="list__label">Todos los flujos</span>
                <span className="list__meta">{diagrams.filter((diagram) => diagram.ok).length} YAML consolidados · solo lectura</span>
              </button>
            </li>
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
                    {flow.steps.length} {flow.steps.length === 1 ? 'paso' : 'pasos'}
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
                          {step.request && <span className="tag tag--request">request</span>}
                          {(step.response || step.returns) && <span className="tag tag--response">response</span>}
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
                <button type="button" className="issue__button" onClick={() => onIssueClick(issue)} disabled={!issue.path?.length}>
                  {issue.line !== undefined && <span className="issue__line">L{issue.line}</span>}
                  <span>{issue.message}</span>
                  {issue.path?.length ? <span className="issue__action">Revisar</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

export { freshId };
