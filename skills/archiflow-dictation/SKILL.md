---
name: archiflow-dictation
description: Convierte un dictado técnico, notas de reunión o instrucciones breves sobre un diagrama guía en un diagrama animado de ArchiFlow. Úsala cuando el usuario diga "dicta", "haz el diagrama con esto", "igual que este pero", "modifica el diagrama guía" o describa endpoints, secuencias, C4 o arquitectura sin un formato estructurado.
---

# ArchiFlow: dictado a diagrama

Convierte lenguaje natural informal en un `.arch.yaml` local, legible y animado.

## Procedimiento

1. Extrae nodos, endpoints, llamadas, datos, eventos, condiciones y orden. Conserva las palabras del usuario como etiquetas cuando no exista un nombre técnico confirmado.
2. Si falta información que no puedes deducir, usa un nodo neutro como `servicio-destino-por-confirmar` y explica la incertidumbre; nunca inventes URL, secretos, tecnologías ni latencias.
3. Crea un flujo por escenario. `primero/después` son pasos síncronos; `publica/envía evento` genera `async: true`; `si hay cache miss` va en `condition`; caminos alternativos son flujos separados.
4. Por defecto usa `view: architecture`. Para endpoint a endpoint usa `view: sequence`; para C4 usa `c4-context`, `c4-container` o `c4-component` según el nivel solicitado.
5. Valida con `npx archiflow validate <directorio>` y muestra con `npx archiflow serve <directorio>`.

## Modificar un guía existente

Lee primero el `.arch.yaml` existente o importa el archivo de draw.io/ArchiMate con `/archiflow-import`. Aplica cambios mínimos: conserva identificadores de nodo, zonas, flujos y comentarios no afectados. En la respuesta final lista solo los nodos, relaciones y escenarios modificados.

## Salida honesta

Explica siempre qué se transcribió de forma literal, qué se dedujo y qué falta confirmar. El resultado de un dictado es un borrador revisable, no evidencia de la arquitectura real.
