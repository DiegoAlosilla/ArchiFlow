import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiagramEntry, MutateRequest, MutateResponse, Mutation } from '@archiflow/shared';

/**
 * Cliente de edición contra `POST /api/mutate`.
 *
 * Dos detalles que no son opcionales:
 *
 * 1. **La revisión se encadena desde la respuesta**, no desde el payload del
 *    WebSocket. Al arrastrar varios nodos seguidos, la segunda mutación sale
 *    antes de que llegue la difusión de la primera; usar la revisión del
 *    payload provocaría un falso conflicto en cada movimiento.
 * 2. **Las peticiones se serializan.** Dos mutaciones en vuelo a la vez sobre
 *    el mismo fichero se invalidan mutuamente por diseño del control de
 *    revisión, así que se encolan.
 */

export interface MutationClient {
  mutate: (...mutations: Mutation[]) => Promise<boolean>;
  /** Último error, para mostrarlo y dejar que el usuario reaccione. */
  error: string | null;
  dismissError: () => void;
  saving: boolean;
}

export function useMutations(entry: DiagramEntry | null): MutationClient {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const revision = useRef<string>('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(0);

  // El servidor manda mientras no haya nada en vuelo. Si lo hay, la revisión
  // buena es la que devolvió la última mutación, no la del payload.
  useEffect(() => {
    if (entry && inFlight.current === 0) revision.current = entry.revision;
  }, [entry]);

  const mutate = useCallback(
    (...mutations: Mutation[]): Promise<boolean> => {
      if (!entry || mutations.length === 0) return Promise.resolve(false);

      const run = async (): Promise<boolean> => {
        inFlight.current += 1;
        setSaving(true);

        const request: MutateRequest = {
          id: entry.id,
          baseRevision: revision.current || entry.revision,
          mutations,
        };

        try {
          const response = await fetch('/api/mutate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
          });
          const result = (await response.json()) as MutateResponse;

          if (result.ok && result.revision) {
            revision.current = result.revision;
            setError(null);
            return true;
          }

          const detail = result.issues?.[0]?.message;
          setError(
            result.reason === 'stale'
              ? 'El fichero cambió por fuera. Recarga la página para no perder lo que hay en disco.'
              : [result.error, detail].filter(Boolean).join(' — '),
          );
          return false;
        } catch (cause) {
          setError(`No se pudo guardar: ${(cause as Error).message}`);
          return false;
        } finally {
          inFlight.current -= 1;
          if (inFlight.current === 0) setSaving(false);
        }
      };

      const next = queue.current.then(run, run);
      queue.current = next.catch(() => undefined);
      return next;
    },
    [entry],
  );

  return { mutate, error, dismissError: () => setError(null), saving };
}
