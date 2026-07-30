import { useEffect, useRef } from 'react';
import { ViewportPortal } from '@xyflow/react';
import type { IrFlow } from '@archiflow/schema';
import { clock } from './playback';
import { getEdgePath, measurer } from './edgeRegistry';
import { protocolColor } from './kinds';

/**
 * Capa de animación: los "paquetes" que recorren las aristas.
 *
 * Todo el trabajo por frame es imperativo (transform del paquete, clases en
 * nodos y aristas). React solo se entera del cambio de paso activo, que ocurre
 * una vez por segundo como mucho.
 */

interface Props {
  flow: IrFlow | null;
  onStepChange: (index: number) => void;
}

/** Ventana tras la llegada durante la que el nodo destino queda resaltado. */
const NODE_PULSE_MS = 420;
/** Fracción del trayecto a partir de la cual se considera que "está llegando". */
const ARRIVAL_THRESHOLD = 0.9;

export function FlowPackets({ flow, onStepChange }: Props) {
  const packetRefs = useRef<Array<HTMLDivElement | null>>([]);
  const hotNodes = useRef(new Set<string>());
  const firingEdges = useRef(new Set<string>());
  const lastStep = useRef(-1);

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

    const render = (timeMs: number) => {
      const nextHotNodes = new Set<string>();
      const nextFiringEdges = new Set<string>();
      let activeIndex = -1;

      flow.steps.forEach((step, i) => {
        const element = packetRefs.current[i];
        if (!element) return;

        const elapsed = timeMs - step.startMs;
        const progress = elapsed / step.durationMs;

        if (timeMs >= step.startMs) activeIndex = i;

        if (progress < 0 || progress > 1) {
          if (element.style.opacity !== '0') {
            element.style.opacity = '0';
            element.style.visibility = 'hidden';
          }
        } else {
          const d = getEdgePath(step.edgeId);
          if (d) {
            const { x, y } = measurer.pointAt(d, progress);
            element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
            element.style.visibility = 'visible';
            // Entrada y salida suaves para que no aparezca de golpe en el nodo.
            element.style.opacity = String(Math.min(1, Math.min(progress, 1 - progress) * 8 + 0.25));
          }
          nextFiringEdges.add(step.edgeId);
          if (progress >= ARRIVAL_THRESHOLD) nextHotNodes.add(step.to);
        }

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
  }, [flow, onStepChange]);

  if (!flow) return null;

  return (
    <ViewportPortal>
      {flow.steps.map((step, i) => (
        <div
          key={`${step.edgeId}-${i}`}
          ref={(element) => {
            packetRefs.current[i] = element;
          }}
          className={`packet${step.async ? ' packet--async' : ''}`}
          style={
            {
              '--packet-color': protocolColor[step.protocol],
              visibility: 'hidden',
              opacity: 0,
            } as React.CSSProperties
          }
        />
      ))}
    </ViewportPortal>
  );
}
