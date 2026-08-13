import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimationSchema, type AnimationSettings, type Ir, type IrFlow, type Issue, type NodeKind } from '@archiflow/schema';
import type { ImportResponse, Mutation } from '@archiflow/shared';
import { useDiagrams } from './useDiagrams';
import { useMutations } from './useMutations';
import { Canvas } from './Canvas';
import { Sidebar, freshId } from './Sidebar';
import { Inspector } from './Inspector';
import { ExportMenu } from './ExportMenu';
import { Timeline } from './Timeline';
import { clock } from './playback';
import type { Selection } from './selection';
import { TrafficInspector } from './TrafficInspector';
import { ArrangePanel } from './ArrangePanel';
import type { FigureDefinition } from './figures';
import { explicitIconPath } from '../../src/icons';

/** Los valores de serie salen del esquema, para no tenerlos en dos sitios. */
const DEFAULT_ANIMATION = AnimationSchema.parse({});

export default function App() {
  const { payload, connection } = useDiagrams();
  const [diagramId, setDiagramId] = useState<string | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(-1);
  const [selection, setSelection] = useState<Selection>(null);
  const [presenting, setPresenting] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const [pathMode, setPathMode] = useState(false);
  const [pathStart, setPathStart] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<ImportResponse | null>(null);
  const [pendingImportedFile, setPendingImportedFile] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'style' | 'text' | 'arrange'>('style');
  const [focusRequest, setFocusRequest] = useState<{ selection: Selection; nonce: number } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  /**
   * No hay modo "ver" y modo "editar": el lienzo siempre es editable y el
   * inspector aparece al seleccionar algo. Un conmutador obligaba a recordar
   * en qué modo estabas antes de poder tocar nada.
   */
  const editing = !presenting;

  const diagrams = payload?.diagrams ?? [];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  useEffect(() => {
    if (!pendingImportedFile) return;
    const imported = diagrams.find((diagram) => diagram.file === pendingImportedFile);
    if (imported) {
      setDiagramId(imported.id);
      setPendingImportedFile(null);
    }
  }, [diagrams, pendingImportedFile]);

  const { mutate, error, dismissError, saving, undo, redo } = useMutations(selectedDiagram);
  // Un servidor que acaba de reiniciar puede entregar los diagramas antes de
  // inicializar su historial. Editar no debe dejar la aplicación en blanco.
  const history = selectedDiagram ? payload?.history?.[selectedDiagram.id] : undefined;

  const ir: Ir | null = selectedDiagram?.ir ?? null;
  const flows = ir?.flows ?? [];

  const selectedFlow: IrFlow | null = useMemo(() => {
    if (flows.length === 0) return null;
    return flows.find((flow) => flow.id === flowId) ?? flows[0]!;
  }, [flows, flowId]);

  useEffect(() => {
    if (selectedFlow && selectedFlow.id !== flowId) setFlowId(selectedFlow.id);
  }, [selectedFlow, flowId]);

  const playbackFlowKey = selectedFlow && selectedDiagram
    ? `${selectedDiagram.id}:${selectedFlow.id}`
    : null;
  const previousPlaybackFlow = useRef<string | null>(null);

  // Solo un cambio REAL de flujo reinicia y reproduce. Una edición reemplaza
  // el objeto IR completo al guardar, pero no debe convertir esa nueva
  // referencia en un falso cambio de flujo ni reactivar una pausa del usuario.
  useEffect(() => {
    if (!selectedFlow) {
      clock.pause();
      clock.setDuration(0);
      setCurrentStep(-1);
      previousPlaybackFlow.current = null;
      return;
    }
    clock.setDuration(selectedFlow.durationMs);
    if (previousPlaybackFlow.current !== playbackFlowKey) {
      previousPlaybackFlow.current = playbackFlowKey;
      clock.seek(0);
      clock.play();
    }
  }, [playbackFlowKey, selectedFlow?.durationMs]);

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
  const pinnedTrafficStep = selection?.kind === 'step' && selection.flowId === selectedFlow?.id
    ? selectedFlow.steps[selection.index] ?? null
    : null;
  const trafficStep = pinnedTrafficStep ?? (currentStep >= 0 ? selectedFlow?.steps[currentStep] ?? null : selectedFlow?.steps[0] ?? null);

  const focusIssue = useCallback((issue: Issue) => {
    if (!ir || !issue.path) return;
    const [section, rawIndex, third, fourth] = issue.path;
    let next: Selection = null;
    if (section === 'nodes' && typeof rawIndex === 'number') next = ir.nodes[rawIndex] ? { kind: 'node', id: ir.nodes[rawIndex]!.id } : null;
    if (section === 'zones' && typeof rawIndex === 'number') next = ir.zones[rawIndex] ? { kind: 'zone', id: ir.zones[rawIndex]!.id } : null;
    if (section === 'edges' && typeof rawIndex === 'number') next = { kind: 'edge', index: rawIndex };
    if (section === 'flows' && typeof rawIndex === 'number') {
      const targetFlow = ir.flows[rawIndex];
      if (targetFlow && third === 'steps' && typeof fourth === 'number') next = { kind: 'step', flowId: targetFlow.id, index: fourth };
      else if (targetFlow) next = { kind: 'flow', id: targetFlow.id };
    }
    if (!next) return;
    setSelection(next);
    setInspectorTab(next.kind === 'node' || next.kind === 'zone' ? 'style' : 'arrange');
    setFocusRequest({ selection: next, nonce: Date.now() });
  }, [ir]);

  const addNode = (kind: NodeKind = 'service', figure?: FigureDefinition, image?: string) => {
    if (!ir) return;
    const id = freshId('nodo', new Set(ir.nodes.map((node) => node.id)));
    const appearance = image
      ? { image }
      : figure && figure.group !== 'General'
        ? { icon: figure.id }
        : undefined;
    void mutate({
      op: 'node.add',
      node: {
        id,
        label: figure?.label ?? (image ? 'Imagen personalizada' : 'Nodo nuevo'),
        kind,
        ...(appearance ? { appearance } : {}),
        ...(ir.zones[0] ? { zone: ir.zones[0].id } : {}),
      },
    }).then((ok) => ok && setSelection({ kind: 'node', id }));
  };

  const useFigure = (figure: FigureDefinition) => {
    if (!ir || selection?.kind !== 'node') {
      addNode(figure.kind, figure);
      return;
    }
    const node = ir.nodes.find((candidate) => candidate.id === selection.id);
    if (!node) return;
    const { icon: _icon, image: _image, ...appearance } = node.appearance ?? {};
    const nextAppearance = { ...appearance, icon: figure.id };
    void mutate({
      op: 'node.update',
      id: node.id,
      patch: { appearance: nextAppearance },
    });
  };

  const useCustomImage = (image: string) => {
    if (!ir || selection?.kind !== 'node') {
      addNode('client', undefined, image);
      return;
    }
    const node = ir.nodes.find((candidate) => candidate.id === selection.id);
    if (!node) return;
    const { icon: _icon, ...appearance } = node.appearance ?? {};
    void mutate({ op: 'node.update', id: node.id, patch: { appearance: { ...appearance, image } } });
  };

  const addZone = () => {
    if (!ir) return;
    const id = freshId('zona', new Set(ir.zones.map((zone) => zone.id)));
    void mutate({ op: 'zone.add', zone: { id, label: 'Zona nueva' } }).then(
      (ok) => ok && setSelection({ kind: 'zone', id }),
    );
  };

  const togglePathMode = () => {
    if (selectedFlow) {
      setPathMode(!pathMode);
      setPathStart(null);
      return;
    }
    if (!ir) return;
    const id = freshId('flujo', new Set(flows.map((flow) => flow.id)));
    void mutate({ op: 'flow.add', flow: { id, label: 'Flujo nuevo' } }).then((ok) => {
      if (!ok) return;
      setFlowId(id);
      setSelection({ kind: 'flow', id });
      setPathStart(null);
      setPathMode(true);
    });
  };

  const importFile = async (file: File) => {
    setImportStatus(null);
    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: file.name, source: await file.text() }),
      });
      const result = (await response.json()) as ImportResponse;
      setImportStatus(result);
      if (result.ok && result.file) setPendingImportedFile(result.file);
    } catch (cause) {
      setImportStatus({ ok: false, error: (cause as Error).message });
    }
  };

  const onPathNodeClick = useCallback((nodeId: string) => {
    if (!pathMode || !selectedFlow) return false;
    if (!pathStart) {
      setPathStart(nodeId);
      setSelection({ kind: 'node', id: nodeId });
      return true;
    }
    if (pathStart === nodeId) return true;
    const index = selectedFlow.steps.length;
    void mutate({ op: 'step.add', flowId: selectedFlow.id, step: { from: pathStart, to: nodeId } }).then((ok) => {
      if (!ok) return;
      setPathStart(nodeId);
      setSelection({ kind: 'step', flowId: selectedFlow.id, index });
    });
    return true;
  }, [mutate, pathMode, pathStart, selectedFlow]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void (event.shiftKey ? redo() : undo()); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); void redo(); }
      if (event.key === 'Escape' && presenting) setPresenting(false);
      if (event.key === 'Escape' && pathMode) { setPathMode(false); setPathStart(null); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
        event.preventDefault();
        if (selection.kind === 'node') void mutate({ op: 'node.remove', id: selection.id }).then((ok) => ok && setSelection(null));
        if (selection.kind === 'zone') void mutate({ op: 'zone.remove', id: selection.id }).then((ok) => ok && setSelection(null));
        if (selection.kind === 'step') void mutate({ op: 'step.remove', flowId: selection.flowId, index: selection.index }).then((ok) => ok && setSelection(null));
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [mutate, pathMode, presenting, redo, selection, undo]);

  return (
    <div className={`app${presenting ? ' app--presenting' : ''}`}>
      <header className="app-chrome">
        <div className="menubar">
          <div className="topbar__brand">
            <span className="topbar__logo" aria-hidden="true">AF</span>
            <span className="topbar__name">ArchiFlow</span>
          </div>
          {!presenting && <nav className="app-menus" aria-label="Menú principal">
            {['Archivo', 'Editar', 'Ver', 'Insertar', 'Formato', 'Ayuda'].map((item) => (
              <button key={item} type="button" className="menu-button">{item}</button>
            ))}
          </nav>}
          {ir && <div className="topbar__diagram">
            <h1>{ir.meta.name}</h1>
            {ir.meta.view !== 'architecture' && <span className="topbar__view">{viewLabel(ir.meta.view)}</span>}
          </div>}
          <button type="button" className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? 'Oscuro' : 'Claro'}
          </button>
          <div className={`topbar__status topbar__status--${connection}`}>
            <span className="dot" aria-hidden="true" />
            {saving ? 'Guardando...' : connection === 'live' ? 'Local' : connection === 'connecting' ? 'Conectando...' : 'Sin conexión'}
          </div>
        </div>

        {ir && <div className="toolbar" role="toolbar" aria-label="Herramientas del diagrama">
          {presenting ? (
            <button type="button" className="tool tool--primary" onClick={() => setPresenting(false)}>Salir de presentación</button>
          ) : <>
            <button type="button" className="tool tool--icon" onClick={() => void undo()} disabled={!history?.canUndo} aria-label="Deshacer">↶</button>
            <button type="button" className="tool tool--icon" onClick={() => void redo()} disabled={!history?.canRedo} aria-label="Rehacer">↷</button>
            <span className="toolbar__divider" />
            <button type="button" className="tool" onClick={() => addNode()}>Nodo</button>
            <button type="button" className="tool" onClick={addZone}>Contenedor</button>
            <button
              type="button"
              className="tool"
              disabled={!selection || selection.kind === 'flow' || selection.kind === 'step'}
              onClick={() => selection && setFocusRequest({ selection, nonce: Date.now() })}
            >
              Ajustar selección
            </button>
            <button
              type="button"
              className={`tool${pathMode ? ' tool--active' : ''}`}
              onClick={togglePathMode}
              title="Selecciona nodos en el orden del recorrido"
            >
              Animar ruta
            </button>
            <span className="toolbar__divider" />
            <button type="button" className="tool" onClick={() => importInput.current?.click()}>Importar</button>
            <input
              ref={importInput}
              className="visually-hidden"
              type="file"
              accept=".drawio,.xml,text/xml,application/xml"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.currentTarget.value = '';
              }}
            />
            <ExportMenu ir={ir} flowId={selectedFlow?.id} fileName={selectedDiagram?.file ?? 'diagrama'} />
            <button type="button" className="tool" onClick={() => setPresenting(true)}>Presentar</button>
            {selectedDiagram && <span className="toolbar__file">{selectedDiagram.file}</span>}
          </>}
        </div>}
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={dismissError} aria-label="Cerrar">
            ×
          </button>
        </div>
      )}

      {importStatus && (
        <div className={`banner ${importStatus.ok ? 'banner--success' : 'banner--error'}`} role="status">
          <span>
            {importStatus.ok && importStatus.summary
              ? `Importado: ${importStatus.summary.shapes} figuras, ${importStatus.summary.links} conectores y ${importStatus.summary.pages} página(s).`
              : importStatus.error}
          </span>
          <button type="button" onClick={() => setImportStatus(null)} aria-label="Cerrar">×</button>
        </div>
      )}

      {pathMode && (
        <div className="path-hint" role="status">
          {pathStart ? 'Ahora selecciona el siguiente cuadro. Pulsa Esc para terminar.' : 'Selecciona el primer cuadro del recorrido.'}
        </div>
      )}

      {diagrams.length === 0 ? (
        <EmptyState connection={connection} root={payload?.root} />
      ) : (
        <div className="workspace">
          {!presenting && <Sidebar
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
              onUseFigure={useFigure}
              onUseCustomImage={useCustomImage}
              onIssueClick={focusIssue}
            />}

          <main className="main">
            {ir ? (
              <Canvas
                ir={ir}
                flow={selectedFlow}
                editing={editing}
                selection={selection}
                onSelect={(next) => {
                  setSelection(next);
                  if (next?.kind === 'edge') setInspectorTab('arrange');
                }}
                onStepChange={handleStepChange}
                currentStep={currentStep}
                mutate={mutate}
                animation={settings}
                presentation={presenting}
                pathMode={pathMode}
                pathStart={pathStart}
                onPathNodeClick={onPathNodeClick}
                focusRequest={focusRequest}
              />
            ) : (
              <div className="canvas canvas--error">
                <h2>No se pudo compilar este diagrama</h2>
                <p>Revisa los errores de validación en el panel lateral.</p>
              </div>
            )}
            {!presenting && <>
              <div className="pagebar">
                <button type="button" className="pagebar__tab is-active">Página-1</button>
                <button type="button" className="pagebar__add" aria-label="Añadir página">+</button>
                {ir && <span className="pagebar__meta">{ir.nodes.length + ir.zones.length} elementos · {ir.edges.length} conectores · {flows.length} flujos</span>}
              </div>
              <Timeline flow={selectedFlow} animation={settings} onAnimationChange={setAnimation} />
            </>}
          </main>

          {editing && ir && (
            <aside className="inspector-panel">
              <TrafficInspector
                step={trafficStep}
                pinned={Boolean(pinnedTrafficStep)}
                onFollow={() => setSelection(null)}
              />
              <div className="inspector-tabs" role="tablist" aria-label="Propiedades">
                {([['style', 'Estilo', 'Colores, bordes y figura'], ['text', 'Texto', 'Nombre, datos y contratos'], ['arrange', 'Organizar', 'Posición, zona, orden y rutas']] as const).map(([id, label, title]) => (
                  <button key={id} type="button" title={title} className={inspectorTab === id ? 'is-active' : ''} onClick={() => setInspectorTab(id)}>{label}</button>
                ))}
              </div>
              <div className="inspector-tab-help">
                {inspectorTab === 'style' && 'Apariencia visual del elemento seleccionado.'}
                {inspectorTab === 'text' && 'Contenido y propiedades semánticas del elemento.'}
                {inspectorTab === 'arrange' && 'Ubicación, agrupación, orden y recorrido en el canvas.'}
              </div>
              {inspectorTab === 'style'
                ? <StylePanel ir={ir} selection={selection} mutate={mutate} />
                : inspectorTab === 'arrange'
                  ? <ArrangePanel ir={ir} selection={selection} mutate={mutate} />
                  : <Inspector ir={ir} selection={selection} onSelect={setSelection} mutate={mutate} />}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function StylePanel({ ir, selection, mutate }: { ir: Ir; selection: Selection; mutate: (...mutations: Mutation[]) => Promise<boolean> }) {
  const item = selection?.kind === 'node'
    ? ir.nodes.find((node) => node.id === selection.id)
    : selection?.kind === 'zone'
      ? ir.zones.find((zone) => zone.id === selection.id)
      : undefined;
  if (!item || (selection?.kind !== 'node' && selection?.kind !== 'zone')) {
    return <div className="inspector inspector--empty"><p>Selecciona una figura o contenedor para cambiar su estilo.</p></div>;
  }
  const appearance = item.appearance ?? {};
  const figurePath = selection.kind === 'node' ? explicitIconPath(appearance.icon, appearance.image) : undefined;
  const update = (patch: Record<string, unknown>) => {
    const mutation = selection.kind === 'node'
      ? { op: 'node.update', id: item.id, patch: { appearance: { ...appearance, ...patch } } }
      : { op: 'zone.update', id: item.id, patch: { appearance: { ...appearance, ...patch } } };
    void mutate(mutation as Mutation);
  };
  return <div className="inspector style-panel">
    <header className="inspector__header"><span className="inspector__kind">Apariencia</span></header>
    {selection.kind === 'node' && <div className="style-figure">
      <span className="style-figure__preview">{figurePath ? <img src={figurePath} alt="" /> : 'AF'}</span>
      <span><b>{appearance.image ? 'Imagen propia' : appearance.icon ? appearance.icon.replace(':', ' · ') : 'Figura general'}</b><small>Elige otra desde la biblioteca izquierda.</small></span>
    </div>}
    <label className="style-row"><span>Relleno</span><input type="color" value={appearance.fill && appearance.fill !== 'none' ? appearance.fill : '#ffffff'} onChange={(event) => update({ fill: event.target.value })} /></label>
    <label className="style-row"><span>Línea</span><input type="color" value={appearance.stroke && appearance.stroke !== 'none' ? appearance.stroke : '#36393d'} onChange={(event) => update({ stroke: event.target.value })} /></label>
    <label className="style-row"><span>Texto</span><input type="color" value={appearance.text && appearance.text !== 'none' ? appearance.text : '#1f2937'} onChange={(event) => update({ text: event.target.value })} /></label>
    <label className="style-row"><span>Esquinas</span><input type="range" min="0" max="24" value={appearance.radius ?? 0} onChange={(event) => update({ radius: Number(event.target.value) })} /></label>
    <button type="button" className="inspector__reset" onClick={() => {
      const mutation = selection.kind === 'node'
        ? { op: 'node.update', id: item.id, patch: { appearance: undefined } }
        : { op: 'zone.update', id: item.id, patch: { appearance: undefined } };
      void mutate(mutation as Mutation);
    }}>Restablecer estilo</button>
    <div className="inspector__meta">Los colores importados de Draw.io permanecen editables.</div>
  </div>;
}

function viewLabel(view: Ir['meta']['view']): string {
  const labels = {
    sequence: 'Secuencia',
    'c4-context': 'C4 · Contexto',
    'c4-container': 'C4 · Contenedores',
    'c4-component': 'C4 · Componentes',
    architecture: 'Arquitectura',
  } as const;
  return labels[view];
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
