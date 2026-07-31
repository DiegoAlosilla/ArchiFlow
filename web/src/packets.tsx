import { useEffect, useMemo, useRef } from 'react';
import { ViewportPortal } from '@xyflow/react';
import type { AnimationSettings, IrFlow } from '@archiflow/schema';
import { clock } from './playback';
import { getEdgePath, measurer } from './edgeRegistry';
import { protocolColor } from './kinds';

/**
 * Capa de animación: los "paquetes" que recorren las aristas.
 *
 * Todo el trabajo por frame es imperativo (transform del paquete, clases en
 * nodos y aristas). React solo se entera del cambio de paso activo, que ocurre
 * una vez por segundo como mucho.
 *
 * Hay dos modos, y la diferencia no es estética:
 *
 * - **paso**: un punto por paso, en secuencia. Es el que hace legible un
 *   recorrido —se ve qué pasa antes y qué después— y sigue siendo el de serie.
 * - **continuo**: todas las aristas del flujo con varios puntos a la vez. Se
 *   pierde el orden y se gana la sensación de tráfico, que es lo que se quiere
 *   en una pantalla de sala o en un GIF de tres segundos.
 *
 * En los dos modos el reloj sigue siendo el mismo y la línea de tiempo sigue
 * marcando el paso activo: el modo continuo cambia lo que se dibuja, no lo que
 * se está contando.
 */

interface Props {
  flow: IrFlow | null;
  animation: AnimationSettings;
  onStepChange: (index: number) => void;
}

/** Ventana tras la llegada durante la que el nodo destino queda resaltado. */
const NODE_PULSE_MS = 420;
/** Fracción del trayecto a partir de la cual se considera que "está llegando". */
const ARRIVAL_THRESHOLD = 0.9;
/** Separación entre los puntos de una estela, en fracción del recorrido. */
const TRAIL_GAP = 0.028;

/** Un punto dibujado: o la cabeza de un paquete, o uno de su estela. */
interface Dot {
  key: string;
  edgeId: string;
  protocol: IrFlow['steps'][number]['protocol'];
  async: boolean;
  /** Solo en modo paso: a qué paso pertenece. */
  stepIndex?: number;
  /** Solo en modo continuo: desfase dentro de la arista. */
  offset: number;
  /** 0 es la cabeza; el resto es estela. */
  trailIndex: number;
  to: string;
  from: string;
}

function buildDots(flow: IrFlow, animation: AnimationSettings): Dot[] {
  const trail = animation.trail;
  const dots: Dot[] = [];

  if (animation.mode === 'paso') {
    flow.steps.forEach((step, index) => {
      for (let t = 0; t <= trail; t++) {
        dots.push({
          key: `s${index}-${t}`,
          edgeId: step.edgeId,
          protocol: step.protocol,
          async: step.async,
          stepIndex: index,
          offset: 0,
          trailIndex: t,
          from: step.from,
          to: step.to,
        });
      }
    });
    return dots;
  }

  // Una arista puede aparecer en varios pasos; en continuo se anima una vez.
  const seen = new Map<string, IrFlow['steps'][number]>();
  for (const step of flow.steps) if (!seen.has(step.edgeId)) seen.set(step.edgeId, step);

  [...seen.values()].forEach((step, index) => {
    for (let packet = 0; packet < animation.packetsPerEdge; packet++) {
      for (let t = 0; t <= trail; t++) {
        dots.push({
          key: `c${step.edgeId}-${packet}-${t}`,
          edgeId: step.edgeId,
          protocol: step.protocol,
          async: step.async,
          // Desfase por paquete, más uno por arista para que no salgan todos
          // los puntos del diagrama alineados como en un metrónomo.
          offset: packet / animation.packetsPerEdge + (index % 7) * 0.037,
          trailIndex: t,
          from: step.from,
          to: step.to,
        });
      }
    }
  });

  return dots;
}

export function FlowPackets({ flow, animation, onStepChange }: Props) {
  const dotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const hotNodes = useRef(new Set<string>());
  const firingEdges = useRef(new Set<string>());
  const lastStep = useRef(-1);

  const dots = useMemo(() => (flow ? buildDots(flow, animation) : []), [flow, animation]);

  useEffect(() => {
    // El layout cambió: las longitudes de path cacheadas ya no valen.
    measurer.invalidate();
    lastStep.current = -1;
  }, [flow]);

  useEffect(() => {
    if (!flow) return undefined;

    const nodeElements = new Map<string, HTMLElement | null>();
    const nodeElement = (id: string) => {
      if (!nodeElements.has(id)) {
        nodeElements.set(id, document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`));
      }
      return nodeElements.get(id) ?? null;
    };

    const edgeElements = new Map<string, HTMLElement | null>();
    const edgeElement = (id: string) => {
      if (!edgeElements.has(id)) {
        edgeElements.set(
          id,
          document.querySelector<HTMLElement>(`.react-flow__edge[data-id="${id}"]`),
        );
      }
      return edgeElements.get(id) ?? null;
    };

    /** Sentido del recorrido. `alterna` cambia en cada vuelta completa. */
    const orient = (progress: number, lap: number): number => {
      if (animation.direction === 'inversa') return 1 - progress;
      if (animation.direction === 'alterna' && lap % 2 === 1) return 1 - progress;
      return progress;
    };

    const place = (dot: Dot, index: number, progress: number, visible: boolean) => {
      const element = dotRefs.current[index];
      if (!element) return;

      if (!visible || progress < 0 || progress > 1) {
        if (element.style.visibility !== 'hidden') {
          element.style.visibility = 'hidden';
          element.style.opacity = '0';
        }
        return;
      }

      const d = getEdgePath(dot.edgeId);
      if (!d) return;
      const { x, y } = measurer.pointAt(d, progress);
      // La estela se dibuja más pequeña y más tenue cuanto más atrás va.
      const fade = dot.trailIndex === 0 ? 1 : 1 - dot.trailIndex / (animation.trail + 1);
      const scale = dot.trailIndex === 0 ? 1 : 0.4 + fade * 0.5;
      element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale.toFixed(2)})`;
      element.style.visibility = 'visible';
      element.style.opacity = String(fade * 0.9);
    };

    const render = (timeMs: number) => {
      const nextHotNodes = new Set<string>();
      const nextFiringEdges = new Set<string>();
      let activeIndex = -1;

      // El paso activo se calcula siempre: la línea de tiempo y la lista de
      // pasos siguen contando el recorrido aunque los puntos vayan sueltos.
      flow.steps.forEach((step, i) => {
        if (timeMs >= step.startMs) activeIndex = i;
      });

      if (animation.mode === 'continuo') {
        const lap = Math.floor(timeMs / animation.cycleMs);
        dots.forEach((dot, index) => {
          const raw = (timeMs / animation.cycleMs + dot.offset) % 1;
          const head = orient(raw, lap);
          const progress = head - dot.trailIndex * TRAIL_GAP * (animation.direction === 'inversa' ? -1 : 1);
          place(dot, index, progress, true);
          nextFiringEdges.add(dot.edgeId);
          if (dot.trailIndex === 0 && raw >= ARRIVAL_THRESHOLD) nextHotNodes.add(dot.to);
        });
      } else {
        dots.forEach((dot, index) => {
          const step = flow.steps[dot.stepIndex!]!;
          const elapsed = timeMs - step.startMs;
          const head = elapsed / step.durationMs;
          const progress = orient(head, 0) - dot.trailIndex * TRAIL_GAP;
          const inFlight = head >= 0 && head <= 1;

          place(dot, index, progress, inFlight);
          if (dot.trailIndex !== 0) return;

          if (inFlight) {
            nextFiringEdges.add(step.edgeId);
            if (head >= ARRIVAL_THRESHOLD) nextHotNodes.add(step.to);
          }
          // El nodo destino sigue caliente un instante después de la llegada.
          if (elapsed >= step.durationMs && elapsed <= step.durationMs + NODE_PULSE_MS) {
            nextHotNodes.add(step.to);
          }
          // Y el origen se marca justo cuando emite.
          if (elapsed >= 0 && elapsed <= NODE_PULSE_MS) nextHotNodes.add(step.from);
        });
      }

      for (const id of hotNodes.current) {
        if (!nextHotNodes.has(id)) nodeElement(id)?.classList.remove('is-hot');
      }
      for (const id of nextHotNodes) {
        if (!hotNodes.current.has(id)) nodeElement(id)?.classList.add('is-hot');
      }
      hotNodes.current = nextHotNodes;

      for (const id of firingEdges.current) {
        if (!nextFiringEdges.has(id)) edgeElement(id)?.classList.remove('is-firing');
      }
      for (const id of nextFiringEdges) {
        if (!firingEdges.current.has(id)) edgeElement(id)?.classList.add('is-firing');
      }
      firingEdges.current = nextFiringEdges;

      if (activeIndex !== lastStep.current) {
        lastStep.current = activeIndex;
        onStepChange(activeIndex);
      }
    };

    const unsubscribe = clock.subscribeFrame(render);

    return () => {
      unsubscribe();
      for (const id of hotNodes.current) nodeElement(id)?.classList.remove('is-hot');
      for (const id of firingEdges.current) edgeElement(id)?.classList.remove('is-firing');
      hotNodes.current = new Set();
      firingEdges.current = new Set();
    };
  }, [animation, dots, flow, onStepChange]);

  if (!flow) return null;

  return (
    <ViewportPortal>
      {dots.map((dot, index) => (
        <div
          key={dot.key}
          ref={(element) => {
            dotRefs.current[index] = element;
          }}
          className={`packet${dot.async ? ' packet--async' : ''}${dot.trailIndex > 0 ? ' packet--trail' : ''}`}
          style={
            {
              '--packet-color': protocolColor[dot.protocol],
              visibility: 'hidden',
              opacity: 0,
            } as React.CSSProperties
          }
        />
      ))}
    </ViewportPortal>
  );
}
