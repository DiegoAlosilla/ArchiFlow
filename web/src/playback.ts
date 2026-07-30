/**
 * Reloj de reproducción.
 *
 * Deliberadamente vive fuera de React: el tiempo avanza a 60 fps y hacer que
 * eso provoque un re-render del árbol de React Flow haría inservible cualquier
 * diagrama de tamaño real. Los consumidores que necesitan el tiempo exacto
 * (los paquetes animados, la barra de progreso) se suscriben por frame y
 * escriben en el DOM de forma imperativa. React solo se entera de los cambios
 * de estado discretos: play/pausa, velocidad y paso actual.
 */

type FrameListener = (timeMs: number) => void;
type StateListener = () => void;

export class PlaybackClock {
  timeMs = 0;
  playing = false;
  speed = 1;
  durationMs = 0;
  loop = true;

  private frameListeners = new Set<FrameListener>();
  private stateListeners = new Set<StateListener>();
  private rafId: number | null = null;
  private lastFrameAt = 0;

  subscribeFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    listener(this.timeMs);
    return () => this.frameListeners.delete(listener);
  }

  subscribeState = (listener: StateListener): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  /** Instantánea estable para `useSyncExternalStore`. */
  getState = (): PlaybackState => this.snapshot;

  private snapshot: PlaybackState = { playing: false, speed: 1, durationMs: 0, loop: true };

  private notifyState() {
    this.snapshot = {
      playing: this.playing,
      speed: this.speed,
      durationMs: this.durationMs,
      loop: this.loop,
    };
    for (const listener of this.stateListeners) listener();
  }

  private notifyFrame() {
    for (const listener of this.frameListeners) listener(this.timeMs);
  }

  setDuration(durationMs: number) {
    this.durationMs = durationMs;
    if (this.timeMs > durationMs) this.timeMs = 0;
    this.notifyState();
    this.notifyFrame();
  }

  play() {
    if (this.playing || this.durationMs <= 0) return;
    // Reproducir desde el final reinicia, que es lo que espera quien pulsa play.
    if (this.timeMs >= this.durationMs) this.timeMs = 0;
    this.playing = true;
    this.lastFrameAt = performance.now();
    this.notifyState();
    this.tick();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.notifyState();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(timeMs: number) {
    this.timeMs = Math.min(Math.max(timeMs, 0), this.durationMs);
    this.notifyFrame();
  }

  restart() {
    this.seek(0);
    this.play();
  }

  setSpeed(speed: number) {
    this.speed = speed;
    this.notifyState();
  }

  setLoop(loop: boolean) {
    this.loop = loop;
    this.notifyState();
  }

  private tick = () => {
    if (!this.playing) return;
    const now = performance.now();
    // Un salto grande significa que la pestaña estuvo en segundo plano; avanzar
    // 20 segundos de golpe no aporta nada, así que se acota el delta.
    const delta = Math.min(now - this.lastFrameAt, 100);
    this.lastFrameAt = now;

    this.timeMs += delta * this.speed;

    if (this.timeMs >= this.durationMs) {
      if (this.loop) {
        this.timeMs = this.timeMs % Math.max(this.durationMs, 1);
      } else {
        this.timeMs = this.durationMs;
        this.notifyFrame();
        this.pause();
        return;
      }
    }

    this.notifyFrame();
    this.rafId = requestAnimationFrame(this.tick);
  };

  dispose() {
    this.pause();
    this.frameListeners.clear();
    this.stateListeners.clear();
  }
}

export interface PlaybackState {
  playing: boolean;
  speed: number;
  durationMs: number;
  loop: boolean;
}

export const clock = new PlaybackClock();
