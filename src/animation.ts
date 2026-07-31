import type { AnimationSettings, Protocol } from './schema/schema.js';
import type { IrFlow } from './schema/compile.js';

/**
 * Dónde está cada punto de la animación en un instante dado.
 *
 * Vive fuera de la web porque lo usan dos sitios: el lienzo, que lo pinta a 60
 * fps, y el exportador a GIF, que congela el tiempo fotograma a fotograma. Si
 * cada uno calculara las posiciones a su manera, el GIF no sería la animación
 * que se estaba viendo sino una parecida — el mismo motivo por el que el
 * trazado de aristas es compartido (invariante 4 del handoff).
 *
 * La API está partida en dos a propósito: `buildDots` da la lista estable —el
 * lienzo crea un `div` por punto una sola vez— y `dotProgress` es una función
 * pura que se llama por frame y por punto sin reservar memoria.
 */

export interface AnimationDot {
  /** Clave estable para React. */
  key: string;
  edgeId: string;
  protocol: Protocol;
  async: boolean;
  /** Solo en modo paso: a qué paso pertenece. */
  stepIndex?: number;
  /** Solo en modo continuo: desfase dentro de la arista, en fracción. */
  offset: number;
  /** 0 es la cabeza del paquete; el resto es estela. */
  trailIndex: number;
  from: string;
  to: string;
}

/** Separación entre los puntos de una estela, en fracción del recorrido. */
export const TRAIL_GAP = 0.028;
/** Fracción a partir de la cual el paquete "está llegando" al destino. */
export const ARRIVAL_THRESHOLD = 0.9;

export function buildDots(flow: IrFlow, animation: AnimationSettings): AnimationDot[] {
  const dots: AnimationDot[] = [];

  if (animation.mode === 'paso') {
    flow.steps.forEach((step, index) => {
      for (let trail = 0; trail <= animation.trail; trail++) {
        dots.push({
          key: `s${index}-${trail}`,
          edgeId: step.edgeId,
          protocol: step.protocol,
          async: step.async,
          stepIndex: index,
          offset: 0,
          trailIndex: trail,
          from: step.from,
          to: step.to,
        });
      }
    });
    return dots;
  }

  // Una arista puede aparecer en varios pasos; en continuo se anima una vez.
  const unique = new Map<string, IrFlow['steps'][number]>();
  for (const step of flow.steps) if (!unique.has(step.edgeId)) unique.set(step.edgeId, step);

  [...unique.values()].forEach((step, index) => {
    for (let packet = 0; packet < animation.packetsPerEdge; packet++) {
      for (let trail = 0; trail <= animation.trail; trail++) {
        dots.push({
          key: `c${step.edgeId}-${packet}-${trail}`,
          edgeId: step.edgeId,
          protocol: step.protocol,
          async: step.async,
          // Desfase por paquete, más uno por arista para que no salgan todos
          // los puntos del diagrama alineados como en un metrónomo.
          offset: packet / animation.packetsPerEdge + (index % 7) * 0.037,
          trailIndex: trail,
          from: step.from,
          to: step.to,
        });
      }
    }
  });

  return dots;
}

function orient(progress: number, animation: AnimationSettings, lap: number): number {
  if (animation.direction === 'inversa') return 1 - progress;
  if (animation.direction === 'alterna' && lap % 2 === 1) return 1 - progress;
  return progress;
}

/**
 * Fracción del recorrido en la que está el punto, o `null` si en ese instante
 * no se dibuja. En modo paso solo hay punto mientras dura su paso; en continuo
 * siempre hay.
 */
export function dotProgress(
  dot: AnimationDot,
  flow: IrFlow,
  animation: AnimationSettings,
  timeMs: number,
): number | null {
  if (animation.mode === 'continuo') {
    const lap = Math.floor(timeMs / animation.cycleMs);
    const head = orient((timeMs / animation.cycleMs + dot.offset) % 1, animation, lap);
    const progress = head - dot.trailIndex * TRAIL_GAP * (animation.direction === 'inversa' ? -1 : 1);
    return progress < 0 || progress > 1 ? null : progress;
  }

  const step = flow.steps[dot.stepIndex ?? -1];
  if (!step) return null;
  const head = (timeMs - step.startMs) / step.durationMs;
  if (head < 0 || head > 1) return null;
  const progress = orient(head, animation, 0) - dot.trailIndex * TRAIL_GAP;
  return progress < 0 || progress > 1 ? null : progress;
}

/** Opacidad y tamaño relativos: la estela se apaga y encoge hacia atrás. */
export function dotFade(dot: AnimationDot, animation: AnimationSettings): { opacity: number; scale: number } {
  if (dot.trailIndex === 0) return { opacity: 0.9, scale: 1 };
  const fade = 1 - dot.trailIndex / (animation.trail + 1);
  return { opacity: fade * 0.9, scale: 0.4 + fade * 0.5 };
}

/**
 * Cuánto dura una vuelta completa, que es lo que hay que recorrer para que un
 * GIF cierre sin salto: el recorrido entero en modo paso, y un ciclo de la
 * arista en modo continuo.
 */
export function loopDurationMs(flow: IrFlow, animation: AnimationSettings): number {
  if (animation.mode === 'paso') return Math.max(flow.durationMs, 1);
  // Con dirección alterna hacen falta dos ciclos para volver al principio.
  return animation.cycleMs * (animation.direction === 'alterna' ? 2 : 1);
}
