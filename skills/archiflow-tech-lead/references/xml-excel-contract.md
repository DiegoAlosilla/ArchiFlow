# Contrato XML → inventario por flujo y Excel

Usar este contrato cuando el usuario entregue un Draw.io `.xml`/`.drawio` y solicite inventario de arquitectura, dependencias, endpoints, cachés, datos o diagramas individuales.

## Principio de modelado

El **flujo de negocio es la entidad raíz**. Los endpoints son una vista secundaria del recorrido. Cada flujo debe responder, sin reconstrucción manual:

- dónde comienza y cuál es su endpoint de entrada;
- qué componentes atraviesa, en qué orden y en qué rama;
- qué servicio consume a cuál y mediante qué endpoint;
- si accede a Redis, qué mapa o mapas utiliza;
- si accede a una base de datos o almacén y cuál;
- qué evidencia XML respalda cada componente y cada salto.

No colapsar dependencias múltiples. Si un orquestador consulta dos mapas Redis y dos microservicios, registrar cuatro saltos independientes dentro del mismo `flow_id`.

## Flujo reproducible

1. Extraer evidencia sin interpretar:

   ```powershell
   npx archiflow import <diagrama.xml> --evidence -o <evidencias.json>
   ```

2. Normalizar servicios, endpoints y relaciones técnicas:

   ```powershell
   node scripts/xml-inventory.mjs <evidencias.json> --source <diagrama.xml> --out <inventario.json>
   ```

3. Construir el modelo centrado en recorridos:

   ```powershell
   node scripts/flow-inventory.mjs <inventario.json> --evidence <evidencias.json> --out <inventario-flujos.json>
   ```

4. Generar y validar un diagrama por flujo:

   ```powershell
   node scripts/generate-flow-diagrams.mjs <inventario-flujos.json> --out <flows>
   npx archiflow validate <flows>
   ```

5. Crear el `.xlsx` con el skill de hojas de cálculo y `scripts/build-flow-inventory-xlsx.mjs`:

   ```powershell
   node build-flow-inventory-xlsx.mjs <inventario-flujos.json> --out <inventario-por-flujo.xlsx> --preview-dir <previews>
   ```

6. Inspeccionar valores, fórmulas y errores; renderizar todas las hojas y corregir texto cortado o conteos inconsistentes antes de entregar.

## Entidades mínimas

### Flujo

Una fila por `flow_id`: nombre, endpoint de entrada, totales de componentes/dependencias/endpoints/servicios, presencia de caché, mapas, presencia de base de datos, almacenes, diagrama individual, confianza y estado de revisión.

### Componente por flujo

Una fila por aparición semántica dentro del recorrido: orden, rama, componente, tipo, capa, rol, endpoints, recursos, propósito, uso de caché/datos, confianza y evidencia XML. Los mapas Redis y almacenes son componentes explícitos.

### Dependencia por flujo

Una fila por salto normalizado `componente origen → componente destino`: paso, rama, endpoint origen, tipo de dependencia, endpoint o recurso destino, protocolo, confianza y evidencia XML. La numeración reinicia en 1 para cada flujo.

### Endpoint

Una fila por `servicio propietario + método + ruta conservada`. Mantener la ruta literalmente, incluidos dobles separadores, mayúsculas, variables, errores y query strings. Si consume varias dependencias, mostrarlas sin pérdida; la hoja de dependencias conserva una relación por fila.

## Reglas de interpretación

- Agrupar por intención de negocio, no por cercanía visual. Los títulos de flujo del XML tienen prioridad; la semántica de rutas permite corregir asociaciones inequívocas.
- Asignar cada endpoint al servicio más pequeño que lo contiene geométricamente.
- Deduplicar apariciones del mismo servicio sin perder su evidencia ni sus participaciones en varios flujos.
- Detectar la dirección por puntas de flecha y contexto. Normalizar siempre la ejecución como consumidor → proveedor y declarar la corrección cuando difiera del dibujo.
- Incluir canal/pantalla y gateway/APIM como inicio del recorrido cuando sean parte del diagrama, aunque no sean microservicios.
- Asociar caché y almacenes a la aparición concreta del servicio; no propagar recursos de una copia visual a todas las apariciones homónimas.
- Inferir el endpoint consumido solo cuando exista una única operación candidata inequívoca. En cualquier otro caso escribir `PENDIENTE`.
- No contar MiniApps, pantallas, acciones, eventos, mapas Redis ni rótulos como microservicios.
- Conservar `inferido` y `Por validar con OpenAPI/código` cuando falte contrato o código fuente.

## Hojas mínimas del libro

1. `Resumen`: conteos de flujos, componentes, dependencias, endpoints, flujos con caché y flujos con datos.
2. `Flujos`: una fila por recorrido completo y enlace al diagrama individual.
3. `Componentes por flujo`: participantes ordenados, incluidos mapas Redis y almacenes.
4. `Dependencias por flujo`: una fila por salto y rama.
5. `Endpoints`: catálogo secundario con rutas conservadas del XML.
6. `Auditoría XML`: figuras, conectores, advertencias y criterios de interpretación.

Todos los conteos del resumen y de `Flujos` deben derivarse mediante fórmulas de las hojas de detalle y reconciliar con el JSON normalizado.
