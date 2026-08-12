---
name: archiflow-endpoints
description: Identifica APIs, microservicios y endpoints desde Draw.io, OpenAPI, código o contexto; explica el propósito de cada operación y genera una vista ArchiFlow con servicios expandidos. Usar cuando pidan un diagrama de endpoints, inventario de APIs, mapeo endpoint por microservicio o contexto del proyecto abierto.
---

# ArchiFlow Endpoints

Construir primero el inventario verificable y después el diagrama. No tratar una pantalla, acción de negocio o rótulo como microservicio.

## Procedimiento

1. Recolectar evidencia. Para Draw.io ejecutar `npx archiflow import <archivo> --evidence -o evidencias.json`; para código ejecutar `npx archiflow scan <repo> -o evidencias.json`. Si la tarea exige sólo lectura, analizar el XML o la salida estándar en memoria y no crear `evidencias.json`.
2. Identificar servicios por estereotipo y nombre (`API UX`, `API BS`, `MS UX`, `BFF`, `ms-`). Agrupar cajas duplicadas con el mismo nombre como una sola definición y conservar sus apariciones visuales.
3. Asignar endpoints al contenedor más pequeño que los encierra. Reconocer método y ruta; conservar variables, errores ortográficos y campos incompletos tal como aparecen.
4. Entregar una matriz `servicio | propósito | método | ruta | consumidor | dependencia | evidencia | confianza`.
5. Convertir cada servicio a un nodo con `expanded: true` y cada endpoint a `provides`. Usar ids estables en las operaciones para que los pasos puedan apuntar a `servicio/endpoint`.
6. Validar con `npx archiflow validate <directorio>`.

## Reglas

- Separar endpoints expuestos de llamadas salientes.
- Determinar la dirección por `source` y `target` del XML antes de usar la posición visual. Si el diagrama usa flechas proveedor→consumidor, declararlo y normalizar la matriz como consumidor→proveedor sin alterar la evidencia original.
- No contar el mismo endpoint dos veces cuando aparece en canal, API UX y API BS: son operaciones distintas solo si el servicio dueño es distinto.
- Explicar el propósito a partir del nombre y del flujo; marcarlo como inferido si no existe descripción explícita.
- No inventar hosts, contratos, autenticación, latencias ni códigos de respuesta.
- Si el proyecto abierto contiene OpenAPI o controladores, contrastarlos y señalar diferencias con el diagrama.
