---
name: archiflow-tech-lead
description: Convierte un diagrama de arquitectura de referencia (Draw.io/XML o ArchiFlow) en una propuesta objetivo o inventario técnico trazable. Genera vistas por flujo, inventarios Markdown o Excel de servicios, capas, endpoints, consumos, Redis/mapas y bases de datos, análisis de complejidad y cobertura OpenAPI/Swagger. Úsala al interpretar dependencias de un XML, contar endpoints, adaptar MBBK/BMU a NHBK, preparar una revisión de arquitectura, dimensionar trabajo o validar contratos.
---

# ArchiFlow Tech Lead

Transforma una referencia visual en una propuesta arquitectónica explicable y verificable. No confunde fidelidad gráfica con validez técnica: conserva el original como evidencia y registra aparte toda corrección o inferencia.

## Cargar las reglas necesarias

- Lee `references/channel-adaptation.md` al trasladar una solución entre canales.
- Lee `references/output-contract.md` antes de producir entregables.
- Lee `references/swagger-coverage.md` cuando existan contratos OpenAPI/Swagger.
- Lee `references/xml-excel-contract.md` antes de convertir un Draw.io/XML en Excel.
- Usa `scripts/inventory.mjs` para obtener el inventario base determinista de un `.arch.yaml`; después añade interpretación y evidencia, sin alterar los conteos observados.
- Usa `scripts/xml-inventory.mjs` después de `archiflow import --evidence` para normalizar servicios, endpoints, dependencias, Redis/mapas y almacenes desde XML.
- Usa `scripts/flow-inventory.mjs` para convertir el inventario técnico en recorridos completos con componentes y saltos trazables por `flow_id`.
- Usa `scripts/generate-flow-diagrams.mjs` para producir un `.arch.yaml` independiente por flujo y validarlos como conjunto.
- Usa `scripts/build-flow-inventory-xlsx.mjs` con el runtime del skill de hojas de cálculo para crear y verificar el libro centrado en flujos. Conserva `scripts/build-inventory-xlsx.mjs` solo para compatibilidad con inventarios históricos centrados en endpoints.
- Usa también `$arquiflow`, `$archiflow-import`, `$archiflow-design`, `$archiflow-endpoints`, `$archiflow-sequence` o `$archiflow-c4` cuando la tarea requiera sus formatos específicos.

## Flujo de trabajo

### 1. Fijar alcance y canales

Registra: archivo de referencia, canal origen, canal objetivo, equipo responsable y nivel de confianza. Si el usuario dice BMU o MBBK de forma indistinta, conserva el término literal y marca la equivalencia como pendiente; no la corrijas silenciosamente. Para este caso, NHBK es el canal web objetivo.

### 2. Extraer primero, interpretar después

Haz dos pasadas:

1. **Inventario observado:** cajas, contenedores, conectores, etiquetas, endpoints, APIs, datos, eventos y estilos que existen en la fuente.
2. **Modelo semántico:** propósito, propiedad, dirección probable, flujos y cambios requeridos.

Cada afirmación usa uno de estos estados:

- `confirmado`: aparece explícitamente en la fuente o contrato.
- `inferido`: se deduce de nombre, endpoint, jerarquía o varias relaciones coherentes.
- `por-validar`: falta evidencia o hay contradicción.

Una flecha conectada gráficamente no prueba la dirección de ejecución. Contrasta el verbo HTTP, el endpoint ofrecido, el contenedor propietario, la pantalla que dispara la acción y las dependencias. Conserva la geometría original en la vista fiel, pero corrige la semántica solo en las vistas derivadas y documenta la diferencia.

### 3. Clasificar los componentes

Clasifica cada elemento como:

- `construir`: responsabilidad del equipo objetivo.
- `adaptar`: existe en el canal origen, pero cambia contrato o comportamiento para NHBK.
- `reutilizar`: dependencia ya existente.
- `por-validar`: propiedad o necesidad incierta.

Distingue como mínimo canal/pantalla, fachada o API UX, microservicio UX/dominio, business core, cross, cache, base de datos, Firebase, broker/evento y sistema externo. No cuentes una copia visual del mismo servicio como un microservicio nuevo: deduplica por identidad semántica y deja la multiplicidad visual en una columna aparte.

### 4. Descubrir los flujos

Agrupa los pasos por intención de negocio, no por cercanía en el lienzo. Nombres habituales para créditos incluyen obtener reglas y características, visualizar oferta, validar oferta, simular, registrar solicitud, confirmar/autorizar y ejecutar; úsalos solo cuando la evidencia los respalde.

Para cada flujo entrega:

- objetivo, disparador y resultado;
- participantes y endpoints;
- pasos secuenciales, paralelos y asíncronos;
- condiciones, fallos y datos persistidos;
- confianza y dudas abiertas.

Si la fuente no declara orden, propón el orden más coherente y marca todos esos pasos como inferidos. Nunca crees una animación gigante con todas las relaciones.

### 5. Generar tres vistas enlazadas

Mantén el mismo `flow_id` entre las vistas:

1. **Fiel:** geometría, cajas, estilos y conectores de la fuente para comparación visual.
2. **Negocio:** entre 5 y 9 capacidades, lenguaje de negocio, sin paths, frameworks ni detalles de red.
3. **Técnica:** canal, gateway/APIM, fachadas, microservicios, endpoint exacto, core/cross, cache, datos y eventos.

Cada flujo debe ser un `.arch.yaml` independiente o una vista filtrable. La animación recorre únicamente sus pasos confirmados o inferidos en orden; muestra los paralelos como ramas y los eventos como asíncronos. Valida cada archivo con `npx archiflow validate <directorio>`.

### 6. Dimensionar e inventariar

Produce el Markdown definido en `references/output-contract.md`. Separa siempre:

- conteo observado en la referencia;
- propuesta para NHBK;
- alcance del equipo;
- dependencias reutilizadas;
- elementos pendientes.

Ordena la complejidad con una heurística transparente: volumen de endpoints, dependencias síncronas, integraciones asíncronas, persistencia, seguridad/documentos y ambigüedad. El servicio con más endpoints no siempre es el más complejo; explica el motivo del ranking.

Cuando el entregable sea Excel, aplica `references/xml-excel-contract.md`: el flujo es la entidad raíz. Conserva literalmente las rutas del XML, incluye `Mapa1`, `Mapa2`, `Mapa3` y mapas adicionales, separa Redis de base de datos y genera hojas de resumen, flujos, componentes por flujo, dependencias por flujo, endpoints y auditoría. Un servicio que consume dos mapas y dos servicios debe conservar los cuatro saltos como dependencias independientes del mismo flujo.

### 7. Validar contratos

Cuando existan Swagger/OpenAPI, aplica `references/swagger-coverage.md`. Ningún contrato se considera cubierto solo por parecido textual: valida método, path normalizado, propietario, request/response, seguridad y códigos relevantes. Reporta `cubierto`, `faltante`, `extra`, `incompatible` o `por-validar`.

## Criterios de aceptación

- La vista fiel se compara con la referencia, sin auto-layout ni re-enrutamiento involuntario.
- Cada elemento de la propuesta tiene evidencia, confianza y decisión de construir/adaptar/reutilizar/validar.
- Negocio y tecnología comparten los mismos flujos, pero distinta granularidad.
- El inventario Markdown permite estimar equipo y contratos sin abrir el diagrama.
- El inventario Excel permite filtrar por flujo, servicio, capa, endpoint, dependencia, Redis/mapa y base de datos, y sus conteos reconcilian con las hojas de detalle.
- Las animaciones explican escenarios concretos y no ocultan pasos inferidos.
- La matriz Swagger detecta tanto faltantes como endpoints extra.
- Los `.arch.yaml` y el Markdown quedan junto al proyecto y pasan validación.
