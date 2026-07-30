import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Ir, IrFlow } from '@archiflow/schema';
import { useDiagrams } from './useDiagrams';
import { useMutations } from './useMutations';
import { Canvas } from './Canvas';
import { Sidebar, freshId } from './Sidebar';
import { Inspector } from './Inspector';
import { ExportMenu } from './ExportMenu';
import { Timeline } from './Timeline';
import { clock } from './playback';
import type { Selection } from './selection';

export default function App() {
  const { payload, connection } = useDiagrams();
  const [diagramId, setDiagramId] = useState<string | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(-1);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);

  const diagrams = payload?.diagrams ?? [];

  // Mantener la selección entre recargas: si el fichero que estabas viendo
  // sigue ahí tras un guardado, no debe saltar a otro.
  const selectedDiagram = useMemo(() => {
    if (diagrams.length === 0) return null;
    return (
      diagrams.find((entry) => entry.id === diagramId) ?? diagrams.find((entry) => entry.ok) ?? diagrams[0]!
    );
  }, [diagrams, diagramId]);

  useEffect(() => {
    if (selectedDiagram && selectedDiagram.id !== diagramId) setDiagramId(selectedDiagram.id);
  }, [selectedDiagram, diagramId]);

  const { mutate, error, dismissError, saving } = useMutations(selectedDiagram);

  const ir: Ir | null = selectedDiagram?.ir ?? null;
  const flows = ir?.flows ?? [];

  const selectedFlow: IrFlow | null = useMemo(() => {
    if (flows.length === 0) return null;
    return flows.find((flow) => flow.id === flowId) ?? flows[0]!;
  }, [flows, flowId]);

  useEffect(() => {
    if (selectedFlow && selectedFlow.id !== flowId) setFlowId(selectedFlow.id);
  }, [selectedFlow, flowId]);

  /**
   * Cambiar de flujo reinicia la reproducción. Durante la edición no arranca
   * sola: con el diagrama moviéndose bajo el ratón, la animación estorba.
   */
  useEffect(() => {
    if (!selectedFlow) {
      clock.pause();
      clock.setDuration(0);
      setCurrentStep(-1);
      return;
    }
    clock.setDuration(selectedFlow.durationMs);
    clock.seek(0);
    if (!editing) clock.play();
  }, [selectedFlow, editing]);

  useEffect(() => {
    if (editing) clock.pause();
  }, [editing]);

  const handleStepChange = useCallback((index: number) => setCurrentStep(index), []);

  const addNode = () => {
    if (!ir) return;
    const id = freshId('nodo', new Set(ir.nodes.map((node) => node.id)));
    void mutate({
      op: 'node.add',
      node: { id, label: 'Nodo nuevo', kind: 'service', ...(ir.zones[0] ? { zone: ir.zones[0].id } : {}) },
    }).then((ok) => ok && setSelection({ kind: 'node', id }));
  };

  const addZone = () => {
    if (!ir) return;
    const id = freshId('zona', new Set(ir.zones.map((zone) => zone.id)));
    void mutate({ op: 'zone.add', zone: { id, label: 'Zona nueva' } }).then(
      (ok) => ok && setSelection({ kind: 'zone', id }),
    );
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="5" cy="6" r="2.5" />
              <circle cx="19" cy="12" r="2.5" />
              <circle cx="5" cy="18" r="2.5" />
              <path d="M7.4 7.2 16.6 11M16.6 13 7.4 16.8" />
            </svg>
          </span>
          <span className="topbar__name">ArchiFlow</span>
        </div>

        {ir && (
          <div className="topbar__diagram">
            <h1>{ir.meta.name}</h1>
            {selectedDiagram && <p>{selectedDiagram.file}</p>}
          </div>
        )}

        {ir && (
          <div className="topbar__tools">
            <ExportMenu ir={ir} flowId={selectedFlow?.id} fileName={selectedDiagram?.file ?? 'diagrama'} />
            <span className="topbar__divider" />

            {editing && (
              <>
                <button type="button" className="tool" onClick={addNode}>
                  + Nodo
                </button>
                <button type="button" className="tool" onClick={addZone}>
                  + Zona
                </button>
                <span className="topbar__divider" />
              </>
            )}

            <div className="mode" role="group" aria-label="Modo">
              <button
                type="button"
                className={`mode__button${editing ? '' : ' is-active'}`}
                onClick={() => setEditing(false)}
              >
                Ver
              </button>
              <button
                type="button"
                className={`mode__button${editing ? ' is-active' : ''}`}
                onClick={() => setEditing(true)}
              >
                Editar
              </button>
            </div>
          </div>
        )}

        <div className={`topbar__status topbar__status--${connection}`}>
          <span className="dot" aria-hidden="true" />
          {saving ? 'Guardando…' : connection === 'live' ? 'En vivo' : connection === 'connecting' ? 'Conectando…' : 'Sin conexión'}
        </div>
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={dismissError} aria-label="Cerrar">
            ×
          </button>
        </div>
      )}

      {diagrams.length === 0 ? (
        <EmptyState connection={connection} root={payload?.root} />
      ) : (
        <div className="workspace">
          <Sidebar
            ir={ir}
            diagrams={diagrams}
            selectedDiagram={selectedDiagram}
            onSelectDiagram={setDiagramId}
            flows={flows}
            selectedFlow={selectedFlow}
            onSelectFlow={setFlowId}
            currentStep={currentStep}
            editing={editing}
            selection={selection}
            onSelect={setSelection}
            mutate={mutate}
          />

          <main className="main">
            {ir ? (
              <Canvas
                ir={ir}
                flow={selectedFlow}
                editing={editing}
                selection={selection}
                onSelect={setSelection}
                onStepChange={handleStepChange}
                mutate={mutate}
              />
            ) : (
              <div className="canvas canvas--error">
                <h2>No se pudo compilar este diagrama</h2>
                <p>Revisa los errores de validación en el panel lateral.</p>
              </div>
            )}
            <Timeline flow={selectedFlow} />
          </main>

          {editing && ir && (
            <aside className="inspector-panel">
              <Inspector ir={ir} selection={selection} onSelect={setSelection} mutate={mutate} />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ connection, root }: { connection: string; root?: string }) {
  return (
    <div className="empty">
      <h2>No hay diagramas todavía</h2>
      {connection === 'offline' ? (
        <p>
          No hay conexión con el servidor. Arráncalo con <code>archiflow serve ./diagrams</code>.
        </p>
      ) : (
        <>
          <p>
            Crea un fichero <code>.arch.yaml</code> en <code>{root ?? './diagrams'}</code> y aparecerá aquí solo.
          </p>
          <p className="empty__hint">
            ¿No sabes por dónde empezar? Copia <code>examples/consulta-cuentas.arch.yaml</code>.
          </p>
        </>
      )}
    </div>
  );
}
