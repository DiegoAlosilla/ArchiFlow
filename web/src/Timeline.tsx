import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { IrFlow } from '@archiflow/schema';
import { clock } from './playback';
import { protocolColor } from './kinds';

/**
 * Controles de transporte. La posición del cursor se escribe directamente en
 * el DOM desde el reloj; el componente solo se re-renderiza cuando cambian
 * play/pausa o la velocidad.
 */

const SPEEDS = [0.5, 1, 2, 4];

function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function Timeline({ flow }: { flow: IrFlow | null }) {
  const state = useSyncExternalStore(clock.subscribeState, clock.getState);
  const trackRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const draggingRef = useRef(false);

  useEffect(
    () =>
      clock.subscribeFrame((timeMs) => {
        const ratio = state.durationMs > 0 ? timeMs / state.durationMs : 0;
        const percent = `${(ratio * 100).toFixed(2)}%`;
        if (progressRef.current) progressRef.current.style.width = percent;
        if (cursorRef.current) cursorRef.current.style.left = percent;
        if (timeRef.current) timeRef.current.textContent = formatTime(timeMs);
      }),
    [state.durationMs],
  );

  const seekFromPointer = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    clock.seek(ratio * clock.durationMs);
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (draggingRef.current) seekFromPointer(event.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [seekFromPointer]);

  // Espacio para play/pausa es el atajo que todo el mundo prueba primero.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        clock.toggle();
      }
      if (event.code === 'KeyR') clock.restart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!flow) {
    return (
      <footer className="timeline timeline--empty">
        <span className="timeline__hint">Selecciona un flujo para reproducirlo.</span>
      </footer>
    );
  }

  return (
    <footer className="timeline">
      <div className="timeline__controls">
        <button
          type="button"
          className="timeline__play"
          onClick={() => clock.toggle()}
          aria-label={state.playing ? 'Pausar' : 'Reproducir'}
        >
          {state.playing ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="timeline__button"
          onClick={() => clock.restart()}
          aria-label="Reiniciar"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 12a8 8 0 1 0 2.4-5.7" />
            <path d="M4 4v4h4" />
          </svg>
        </button>
      </div>

      <div className="timeline__scrubber">
        <div
          ref={trackRef}
          className="timeline__track"
          onPointerDown={(event) => {
            draggingRef.current = true;
            seekFromPointer(event.clientX);
          }}
        >
          <div ref={progressRef} className="timeline__progress" />

          {/* Cada paso marca su tramo, para poder saltar a ojo a la parte lenta. */}
          {flow.steps.map((step, i) => (
            <button
              key={`${step.edgeId}-${i}`}
              type="button"
              className="timeline__marker"
              title={`${i + 1}. ${step.from} → ${step.to} · ${step.label}`}
              style={{
                left: `${(step.startMs / flow.durationMs) * 100}%`,
                width: `${(step.durationMs / flow.durationMs) * 100}%`,
                background: protocolColor[step.protocol],
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                clock.seek(step.startMs);
              }}
            />
          ))}

          <div ref={cursorRef} className="timeline__cursor" />
        </div>
      </div>

      <div className="timeline__meta">
        <span ref={timeRef} className="timeline__time">
          0.0s
        </span>
        <span className="timeline__separator">/</span>
        <span className="timeline__duration">{formatTime(flow.durationMs)}</span>

        <select
          className="timeline__speed"
          value={state.speed}
          onChange={(event) => clock.setSpeed(Number(event.target.value))}
          aria-label="Velocidad"
        >
          {SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>

        <label className="timeline__loop">
          <input
            type="checkbox"
            checked={state.loop}
            onChange={(event) => clock.setLoop(event.target.checked)}
          />
          Bucle
        </label>
      </div>
    </footer>
  );
}
