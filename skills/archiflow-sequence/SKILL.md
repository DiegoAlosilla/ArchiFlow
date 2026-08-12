---
name: archiflow-sequence
description: Convierte un flujo funcional o técnico en diagramas de secuencia ArchiFlow, separando escenarios y ordenando llamadas endpoint a endpoint. Usar cuando pidan sequence diagram, diagrama de secuencia, camino feliz, errores, caché, eventos o el detalle temporal de un microservicio abierto.
---

# ArchiFlow Sequence

Usar `view: sequence`. Un archivo puede compartir nodos con la arquitectura, pero cada `flow` debe ser un escenario temporal coherente.

## Procedimiento

1. Identificar actor o evento iniciador y operación de entrada.
2. Seguir la ejecución real en orden. Priorizar numeración explícita, código del handler, etiquetas de flecha y luego lectura visual.
3. Separar camino feliz, error, cache hit, cache miss y procesamiento asíncrono en flujos distintos.
4. Apuntar a operaciones concretas con `servicio/operacion` cuando existan en `provides`.
5. Registrar `op`, `protocol`, `condition`, `async`, `request`, `response` y `latencyMs` sólo cuando estén evidenciados.
6. Validar y reproducir el flujo completo antes de entregar.

## Reglas

- No concatenar todas las flechas de un diagrama grande en un único flujo.
- Un evento consumido inicia su propia secuencia; una publicación termina la secuencia que lo produce salvo confirmación explícita.
- Una llamada de retorno no necesita duplicar la arista: usar `returns` o `response`.
- Leer `source` y `target` del XML, pero comprobar el sentido semántico por capas. Si las flechas fueron dibujadas proveedor→consumidor, documentar esa convención y representar las solicitudes consumidor→proveedor.
- Cuando varias preparaciones puedan ser paralelas y no exista orden probado, crear escenarios independientes o marcarlos como borrador; no imponer una secuencia por cercanía horizontal.
- Si el orden no puede probarse, proponerlo como borrador y enumerar los puntos que requieren confirmación.
