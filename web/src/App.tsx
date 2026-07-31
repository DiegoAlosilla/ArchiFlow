import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimationSchema, type AnimationSettings, type Ir, type IrFlow } from '@archiflow/schema';
import { useDiagrams } from './useDiagrams';
import { useMutations } from './useMutations';
import { Canvas } from './Canvas';
import { Sidebar, freshId } from './Sidebar';
import { Inspector } from './Inspector';
import { ExportMenu } from './ExportMenu';
import { Timeline } from './Timeline';
import { clock } from './playback';
import type { Selection } from './selection';

/** Los valores de serie salen del esquema, para no tenerlos en dos sitios. */
const DEFAULT_ANIMATION = AnimationSchema.parse({});

export default function App() {
  const { payload, connection } = useDiagrams();
  const [diagramId, setDiagramId] = useState<string | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(-1);
  const [selection, setSelection] = useState<Selection>(null);

  /**
   * No hay modo "ver" y modo "editar": el lienzo siempre es editable y el
   * inspector aparece al seleccionar algo. Un conmutador obligaba a recordar
   * en qué modo estabas antes de poder tocar nada.
   */
  const editing = true;

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

  const { mutate, error, dismissError, saving, undo, redo } = useMutations(selectedDiagram);
  const history = selectedDiagram ? payload?.history[selectedDiagram.id] : undefined;

  const ir: Ir | null = selectedDiagram?.ir ?? null;
  const flows = ir?.flows ?? [];

  const selectedFlow: IrFlow | null = useMemo(() => {
    if (flows.length === 0) return null;
    return flows.find((flow) => flow.id === flowId) ?? flows[0]!;
  }, [flows, flowId]);

  useEffect(() => {
    if (selectedFlow && selectedFlow.id !== flowId) setFlowId(selectedFlow.id);
  }, [selectedFlow, flowId]);

  // Cambiar de flujo reinicia la reproducción y arranca sola: el usuario ha
  // pedido ver ese recorrido, no darle a play después.
  useEffect(() => {
    if (!selectedFlow) {
      clock.pause();
      clock.setDuration(0);
      setCurrentStep(-1);
      return;
    }
    clock.setDuration(selectedFlow.durationMs);
    clock.seek(0);
    clock.play();
  }, [selectedFlow]);

  /**
   * Ajustes de animación: el fichero manda y la barra inferior los cambia solo
   * para la sesión. Cambiar el YAML por mover un control escribiría en disco a
   * cada clic, y probar cómo se ve algo no debería ensuciar un diff.
   */
  const [animation, setAnimation] = useState<AnimationSettings | null>(null);
  useEffect(() => {
    if (!ir) return;
    // El `??` cubre un payload servido por un CLI más viejo que la web, que es
    // lo que pasa en desarrollo con el servidor levantado desde antes: sin él,
    // leer `.speed` de undefined deja la página en blanco.
    const next = ir.animation ?? DEFAULT_ANIMATION;
    setAnimation(next);
    clock.setSpeed(next.speed);
  }, [ir?.animation, selectedDiagram?.id]);
  const settings = animation ?? ir?.animation ?? DEFAULT_ANIMATION;

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void (event.shiftKey ? redo() : undo()); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); void redo(); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
        event.preventDefault();
        if (selection.kind === 'node') void mutate({ op: 'node.remove', id: selection.id }).then((ok) => ok && setSelection(null));
        if (selection.kind === 'zone') void mutate({ op: 'zone.remove', id: selection.id }).then((ok) => ok && setSelection(null));
        if (selection.kind === 'step') void mutate({ op: 'step.remove', flowId: selection.flowId, index: selection.index }).then((ok) => ok && setSelection(null));
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [mutate, redo, selection, undo]);

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
            <button type="button" className="tool" onClick={addNode}>
              + Nodo
            </button>
            <button type="button" className="tool" onClick={addZone}>
              + Zona
            </button>
            <button type="button" className="tool" onClick={() => void undo()} disabled={!history?.canUndo} aria-label="Deshacer">↶</button>
            <button type="button" className="tool" onClick={() => void redo()} disabled={!history?.canRedo} aria-label="Rehacer">↷</button>
            <span className="topbar__divider" />
            <ExportMenu ir={ir} flowId={selectedFlow?.id} fileName={selectedDiagram?.file ?? 'diagrama'} />
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
                animation={settings}
              />
            ) : (
              <div className="canvas canvas--error">
                <h2>No se pudo compilar este diagrama</h2>
                <p>Revisa los errores de validación en el panel lateral.</p>
              </div>
            )}
            <Timeline flow={selectedFlow} animation={settings} onAnimationChange={setAnimation} />
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
