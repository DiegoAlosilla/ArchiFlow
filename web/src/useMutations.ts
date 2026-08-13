import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiagramEntry, MutateRequest, MutateResponse, Mutation } from '@archiflow/shared';
import { clock } from './playback';

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
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
}

export function useMutations(entry: DiagramEntry | null): MutationClient {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const revision = useRef<string>('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(0);

  const post = useCallback(async (url: string, body: unknown): Promise<MutateResponse> => {
    let failure: unknown;
    // Una reconstrucción local o una reconexión del navegador puede cortar una
    // petición durante unos milisegundos. Reintentar una vez evita exponer el
    // poco útil `Failed to fetch`; el servidor serializa la operación.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await response.text();
        const result = text ? JSON.parse(text) as MutateResponse : { ok: false, reason: 'failed' as const, error: `respuesta vacía (${response.status})` };
        return result;
      } catch (cause) {
        failure = cause;
        if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
    }
    throw failure;
  }, []);

  // El servidor manda mientras no haya nada en vuelo. Si lo hay, la revisión
  // buena es la que devolvió la última mutación, no la del payload.
  useEffect(() => {
    if (entry && inFlight.current === 0) revision.current = entry.revision;
  }, [entry]);

  const mutate = useCallback(
    (...mutations: Mutation[]): Promise<boolean> => {
      if (!entry || mutations.length === 0) return Promise.resolve(false);
      // Toda edición, sin importar si nació en el canvas o en un inspector,
      // congela la narración. El guardado posterior conserva esta pausa.
      clock.pause();

      const run = async (): Promise<boolean> => {
        inFlight.current += 1;
        setSaving(true);

        const request: MutateRequest = {
          id: entry.id,
          baseRevision: revision.current || entry.revision,
          mutations,
        };

        try {
          const result = await post('/api/mutate', request);

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
          setError('El servidor local se desconectó y no se pudo guardar. Recarga ArquiFlow; el archivo en disco no fue modificado.');
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
    [entry, post],
  );

  const history = useCallback((action: 'undo' | 'redo'): Promise<boolean> => {
    if (!entry) return Promise.resolve(false);
    clock.pause();
    const run = async (): Promise<boolean> => {
      inFlight.current += 1;
      setSaving(true);
      try {
        const result = await post(`/api/${action}`, { id: entry.id });
        if (result.ok && result.revision) {
          revision.current = result.revision;
          setError(null);
          return true;
        }
        setError(result.error ?? `No se pudo ${action === 'undo' ? 'deshacer' : 'rehacer'}`);
      } catch {
        setError('El servidor local se desconectó. Recarga ArquiFlow para continuar; el historial no se modificó.');
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setSaving(false);
      }
      return false;
    };
    const next = queue.current.then(run, run);
    queue.current = next.catch(() => undefined);
    return next;
  }, [entry, post]);

  return { mutate, error, dismissError: () => setError(null), saving, undo: () => history('undo'), redo: () => history('redo') };
}
