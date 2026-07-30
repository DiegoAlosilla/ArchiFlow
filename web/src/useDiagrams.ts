import { useEffect, useRef, useState } from 'react';
import type { DiagramsPayload, ServerMessage } from '@archiflow/shared';

/**
 * Conexión con el servidor del CLI: carga inicial por HTTP y actualizaciones
 * por WebSocket. El bucle de trabajo que buscamos es "el agente escribe el
 * YAML → el navegador se actualiza solo", así que la reconexión tiene que ser
 * automática y silenciosa.
 */

export type ConnectionState = 'connecting' | 'live' | 'offline';

const RECONNECT_DELAY_MS = 1200;

export function useDiagrams() {
  const [payload, setPayload] = useState<DiagramsPayload | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (!disposed) setConnection('live');
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as ServerMessage;
          if (message.type === 'diagrams' && !disposed) setPayload(message.payload);
        } catch {
          // Un mensaje corrupto no debe tumbar la sesión: se ignora y se sigue.
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        setConnection('offline');
        timerRef.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => socket.close();
    };

    fetch('/api/diagrams')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('sin datos'))))
      .then((data: DiagramsPayload) => {
        if (!disposed) setPayload(data);
      })
      .catch(() => {
        if (!disposed) setConnection('offline');
      });

    connect();

    return () => {
      disposed = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, []);

  return { payload, connection };
}
