import { useEffect, useMemo, useRef } from 'react';
import { ViewportPortal } from '@xyflow/react';
import type { AnimationSettings, IrFlow } from '@archiflow/schema';
import {
  ARRIVAL_THRESHOLD,
  buildDots,
  dotFade,
  dotProgress,
  type AnimationDot,
} from '@archiflow/animation';
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

export function FlowPackets({ flow, animation, onStepChange }: Props) {
  const dotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const contractRefs = useRef<Array<HTMLDivElement | null>>([]);
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

    const serviceElements = [...document.querySelectorAll<HTMLElement>('.react-flow__node-service')];
    const intersects = (a: DOMRect, b: DOMRect, margin = 5) =>
      a.right + margin > b.left
      && a.left - margin < b.right
      && a.bottom + margin > b.top
      && a.top - margin < b.bottom;

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

    const place = (dot: AnimationDot, index: number, progress: number | null) => {
      const element = dotRefs.current[index];
      const contract = contractRefs.current[index];
      if (!element) return;

      if (progress === null) {
        if (element.style.visibility !== 'hidden') {
          element.style.visibility = 'hidden';
          element.style.opacity = '0';
        }
        if (contract) {
          contract.style.visibility = 'hidden';
          contract.style.opacity = '0';
        }
        return;
      }

      const d = getEdgePath(dot.edgeId);
      if (!d) return;
      const { x, y } = measurer.pointAt(d, progress);
      const { opacity, scale } = dotFade(dot, animation);
      element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale.toFixed(2)})`;
      element.style.visibility = 'visible';
      element.style.opacity = String(opacity);
      if (contract) {
        // La tarjeta pertenece al tramo que recorre el paquete. Colocarla a la
        // derecha hacía que, en retornos horizontales, invadiera la siguiente
        // dependencia. Centrada y por encima conserva la lectura de la flecha
        // y deja libre la caja de destino.
        contract.style.visibility = 'visible';
        contract.style.opacity = String(opacity);
        const transforms = [
          `translate(${x}px, ${y - 14}px) translate(-50%, -100%) scale(${scale.toFixed(2)})`,
          `translate(${x - 14}px, ${y - 14}px) translate(-100%, -100%) scale(${scale.toFixed(2)})`,
          `translate(${x + 14}px, ${y - 14}px) translate(0, -100%) scale(${scale.toFixed(2)})`,
        ];
        for (const transform of transforms) {
          contract.style.transform = transform;
          const contractRect = contract.getBoundingClientRect();
          const touchesService = serviceElements.some((service) => intersects(contractRect, service.getBoundingClientRect()));
          if (!touchesService) break;
        }
      }
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

      dots.forEach((dot, index) => {
        const progress = dotProgress(dot, flow, animation, timeMs);
        place(dot, index, progress);
        if (dot.trailIndex !== 0) return;

        if (progress !== null) {
          nextFiringEdges.add(dot.edgeId);
          if (progress >= ARRIVAL_THRESHOLD) nextHotNodes.add(dot.to);
        }

        // El pulso de los nodos solo tiene sentido en modo paso: en continuo
        // todo está llegando a todo y encender la mitad del diagrama a la vez
        // no señala nada.
        if (animation.mode !== 'paso') return;
        const step = flow.steps[dot.stepIndex ?? -1];
        if (!step) return;
        const elapsed = timeMs - step.startMs;
        // El nodo destino sigue caliente un instante después de la llegada.
        if (elapsed >= step.durationMs && elapsed <= step.durationMs + NODE_PULSE_MS) {
          nextHotNodes.add(step.to);
        }
        // Y el origen se marca justo cuando emite.
        if (elapsed >= 0 && elapsed <= NODE_PULSE_MS) nextHotNodes.add(step.from);
      });

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
        <div key={dot.key}>
          <div
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
          {dot.trailIndex === 0 && dot.stepIndex !== undefined && (() => {
            const step = flow.steps[dot.stepIndex];
            if (!step || (!step.request && !step.response && !step.returns)) return null;
            return (
              <div
                ref={(element) => {
                  contractRefs.current[index] = element;
                }}
                className={`packet-contract${step.request ? ' packet-contract--request' : ' packet-contract--response'}`}
                style={
                  {
                    '--packet-color': protocolColor[dot.protocol],
                    visibility: 'hidden',
                    opacity: 0,
                  } as React.CSSProperties
                }
              >
                <strong>{step.label}</strong>
                {step.request && <span><b>Request</b><em>Detalles en el inspector de tráfico</em></span>}
                {(step.response || step.returns) && <span><b>Response</b><em>Detalles en el inspector de tráfico</em></span>}
              </div>
            );
          })()}
        </div>
      ))}
    </ViewportPortal>
  );
}
