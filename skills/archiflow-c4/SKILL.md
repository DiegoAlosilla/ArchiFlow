---
name: archiflow-c4
description: Genera y revisa diagramas C4 de contexto, contenedores o componentes en ArchiFlow, manteniendo el nivel correcto y relaciones trazables. Usar cuando pidan C4, contexto del sistema, contenedores, componentes o límites del proyecto abierto.
---

# ArchiFlow C4

Elegir una sola profundidad por archivo. Mantener los recorridos como `flows` para que la vista siga siendo animable.

## Selección de nivel

- `view: c4-context`: personas y sistemas externos, más un único sistema de interés. No mostrar endpoints, bases internas ni clases.
- `view: c4-container`: aplicaciones, web, app móvil, BFF, APIs, microservicios principales, bases y brokers dentro del sistema.
- `view: c4-component`: componentes internos de un contenedor concreto. Nombrar en la cabecera qué contenedor se abre.

## Procedimiento

1. Declarar sistema de interés, audiencia y pregunta que debe responder la vista.
2. Extraer elementos sólo del nivel elegido; mover el detalle inferior a otro archivo enlazado conceptualmente.
3. Definir límites con `zones` y relaciones con pasos o `edges` cuando no exista un escenario.
4. Etiquetar cada relación con intención y protocolo, no sólo con “usa”.
5. Crear uno o más flujos representativos sin mezclar métodos internos en contexto o contenedores.
6. Validar con `npx archiflow validate <directorio>`.

## Esqueleto serializable

Usar esta base cuando la tarea pida producir el archivo, ajustando tipos y relaciones a la evidencia:

```yaml
archiflow: 1
name: Nombre de la vista
view: c4-container
zones:
  - id: sistema
    label: Sistema de interés
nodes:
  - id: canal-web
    label: Canal web
    kind: frontend
    zone: sistema
  - id: servicio
    label: Servicio de negocio
    kind: service
    zone: sistema
  - id: dependencia
    label: Sistema externo
    kind: external
edges:
  - from: canal-web
    to: servicio
    label: Solicita operación
    protocol: https
flows:
  - id: escenario-principal
    name: Escenario principal
    steps:
      - from: canal-web
        to: servicio
        label: Solicita operación
```

Si la fuente es otro Draw.io, ejecutar primero `archiflow-import`. Para una relación estructural sin escenario verificable, conservarla como `edge`; no inventar un `flow`.

## Control de calidad

- Cada elemento debe tener responsabilidad clara.
- Toda relación debe poder rastrearse a contexto, código, contrato o diagrama fuente.
- Marcar inferencias y no mostrar infraestructura que no aporte a la pregunta de la vista.
