---
title: "ADR-001: Modelo y arquitectura de ArchiFlow"
tags: [adr, arquitectura, archiflow, diagramas]
status: accepted
date: 2026-07-29
deciders: [Tech Lead]
---

# ADR-001: Modelo y arquitectura de ArchiFlow

## Estado

`accepted`

## Contexto

En el banco el flujo de trabajo es **arquitectura → contrato OpenAPI → generación del microservicio** (contract-first). El diagrama es el primer artefacto y, en teoría, la fuente de verdad.

En la práctica falla por tres razones:

1. **El diagrama es estático y difícil de leer.** Un diagrama de componentes con 15 cajas y 30 flechas no comunica *qué pasa cuando llega una petición*. El lector tiene que reconstruir mentalmente el recorrido siguiendo flechas cruzadas.
2. **El diagrama se desactualiza.** Con ~102 microservicios en un solo equipo, tras migraciones de framework o cambios de dependencia (el servicio ya no llama a la API B sino a la C), nadie vuelve al diagrama. El artefacto vive fuera del repositorio, así que ningún PR lo obliga a cambiar.
3. **Las herramientas actuales no ayudan.** Draw.io exporta XML de mxGraph, ilegible para una persona y hostil para un LLM. Copilot, cuando se le pide un diagrama, responde con un diagrama de secuencia **a nivel de métodos** (capa DAO, BO, util) cuando lo que se necesita es a **nivel de componentes de infraestructura** (Redis → ms-business → SQL → Kafka).

Referencia de inspiración: *Flujo*, que genera diagramas con animación de movimiento (peticiones viajando, cooldowns, cargas). La animación es exactamente lo que falta: convierte una topología estática en un recorrido comprensible.

**Restricciones reales del proyecto:**

- **100% local y gratuito.** Sin monetización, sin backend en la nube, sin telemetría. Es requisito de producto (decisión personal tras Node-Flow) y también de viabilidad: en el banco, código y arquitectura no pueden salir de la máquina.
- **Un desarrollador, tiempo limitado.** No hay presupuesto para escribir un analizador estático de Java completo.
- **La IA disponible en el banco es Copilot.** ArchiFlow debe funcionar con cualquier agente, no depender de Claude. El formato que produzca el agente tiene que ser trivial de escribir para *cualquier* LLM.
- **Stack objetivo del análisis de código:** Quarkus y Spring Boot (Java).

**Fuerzas en tensión:** legibilidad humana vs. procesabilidad por máquina; determinismo del análisis vs. heterogeneidad de 102 servicios; fidelidad con draw.io vs. libertad para animar.

## Opciones evaluadas

La decisión central es **cuál es el formato fuente de verdad**, porque de eso cuelga todo lo demás (qué escribe el agente, qué se versiona en git, qué renderiza la web).

### Opción 1: Draw.io XML (mxGraph) como fuente de verdad

**Pros:**
- Compatibilidad total con la herramienta que ya usa el banco.
- No hay que enseñar un formato nuevo a nadie.

**Contras:**
- El XML de mxGraph mezcla semántica con presentación (coordenadas, estilos, geometría). Un diff en un PR es ruido puro.
- No tiene ningún concepto de *flujo en el tiempo*: no hay dónde colgar la animación sin inventar convenciones sobre atributos.
- Un LLM genera mxGraph mal y de forma inconsistente; hay que corregirlo a mano.
- Obliga a resolver el layout antes de tener el modelo, que es exactamente al revés de lo que se quiere.

### Opción 2: Mermaid como fuente de verdad

**Pros:**
- Los LLM lo escriben muy bien, es el formato más entrenado.
- Se renderiza en GitHub, en descripciones de PR, en Obsidian.
- Muy compacto.

**Contras:**
- No modela *topología + N flujos sobre esa topología*. Un `sequenceDiagram` es un flujo sin topología; un `flowchart` es topología sin flujo. Habría que mantener dos diagramas desincronizados — exactamente el problema que queremos resolver.
- No hay dónde poner metadatos (plataforma AKS, protocolo, latencia, sync/async, endpoint expuesto).
- El layout de Mermaid no es controlable; con 15 nodos vuelve al espagueti de flechas.

### Opción 3: Estructura propia en JSON

**Pros:**
- Contrato de máquina explícito y validable con JSON Schema.
- Lo consume directo el renderer.

**Contras:**
- No admite comentarios, y un diagrama de arquitectura vive de las anotaciones ("esto es legacy", "pendiente migrar").
- Verboso de escribir y de revisar en un PR: mucho `{`, `"` y coma.
- Escribir JSON largo a mano (o vía agente) es más frágil que YAML por las comas finales y el escapado.

### Opción 4: DSL propio (`.archiflow`, tipo pseudocódigo)

**Pros:**
- Máxima legibilidad y concisión; se puede diseñar exactamente para el dominio.
- Estilo Structurizr DSL, un formato probado para el modelo C4.

**Contras:**
- Hay que escribir y mantener un parser, con sus mensajes de error, su tolerancia a fallos y su soporte de editor. Es trabajo que no aporta valor de producto.
- Un LLM tiene que aprender la gramática desde cero en cada invocación; más propenso a alucinación sintáctica que un formato que ya conoce.
- Sin resaltado de sintaxis ni validación en el editor sin escribir además una extensión.

### Opción 5: YAML con esquema propio, validado, y draw.io/Mermaid como *exports*

**Pros:**
- Cero parser que mantener (`js-yaml`), pero un esquema propio y estricto validado con Zod/JSON Schema.
- Los LLM escriben YAML de forma nativa y fiable — incluido Copilot.
- Admite comentarios, es diffable y revisable en un PR como cualquier otro código.
- Puede vivir **dentro del repositorio del microservicio**, junto al código.

**Contras:**
- Es un formato nuevo que hay que documentar y enseñar.
- YAML tiene sus trampas conocidas (indentación, `no` interpretado como booleano).
- No se abre directamente en draw.io: requiere un paso de exportación.

## Decisión

**Elegimos: Opción 5 — YAML con esquema propio como fuente de verdad, y draw.io / Mermaid / SVG como formatos de exportación.**

El formato fuente y el formato de intercambio son problemas distintos y los separamos: se **autora** en YAML (legible, diffable, LLM-friendly), se **renderiza** desde un IR JSON compilado, y se **exporta** a draw.io cuando hay que compartir con quien vive en draw.io. Draw.io deja de ser la fuente de verdad y pasa a ser un destino, que es lo que permite tener animación sin pelearse con mxGraph.

Tres decisiones de modelado acompañan a la elección de formato y son igual de importantes:

**A. El modelo es una topología con N flujos superpuestos.** Un diagrama declara `nodes` (servicios, cachés, bases, brokers, externos) agrupados en `zones` (canales, experiencia/BFF, negocio, datos — el layering del banco), y por separado declara `flows`: escenarios de ejecución con nombre (`listar-cuentas`), cada uno una secuencia ordenada de `steps`. **La animación es un flujo reproduciéndose sobre la topología.** Esto resuelve el problema de legibilidad de raíz: el usuario no lee 30 flechas, elige un caso de uso y lo ve viajar.

**B. Las aristas se infieren de los flujos, no se declaran.** Si `listar-cuentas` tiene un paso `bff-cuentas → redis-cuentas`, la arista existe. Elimina la duplicación entre "el dibujo" y "la secuencia", que es la fuente clásica de desincronización interna.

**C. El análisis de código es híbrido: recolector determinista + síntesis por agente.** Escribir un analizador estático de Java que cubra 102 servicios heterogéneos no es viable con los recursos disponibles, y un analizador puramente basado en LLM alucina. La división: un **recolector de evidencias** determinista extrae señales de alta precisión —sobre todo de los ficheros de configuración, que son oro— y un **skill/agente** sintetiza el YAML a partir de esas evidencias más la lectura de los ficheros clave.

La evidencia determinista incluye:

| Señal | Quarkus | Spring Boot |
|---|---|---|
| Endpoints expuestos | `@Path`, `@GET`/`@POST` (JAX-RS) | `@RestController`, `@GetMapping` |
| Llamadas salientes | `@RegisterRestClient(configKey)` + `quarkus.rest-client.<key>.url` | `@FeignClient`, `RestTemplate`, `WebClient` |
| Mensajería | `@Incoming`/`@Outgoing` + `mp.messaging.*.topic` | `@KafkaListener`, `KafkaTemplate` |
| Base de datos | `quarkus.datasource.*.jdbc.url`, Panache | `spring.datasource.url`, repositorios JPA |
| Caché | extensión `quarkus-redis-client` | `@Cacheable`, Lettuce/Jedis |
| Tecnología | `pom.xml` / `build.gradle` | idem |

`quarkus.rest-client.customer-api.url=http://ms-customer.negocio.svc` da simultáneamente la arista, el destino y la zona. Ese *config mining* es la columna vertebral del análisis, no el AST.

**D. El fichero vive en el repositorio del microservicio.** `architecture.arch.yaml` junto al código. Esto es lo que ataca la desactualización: el agente puede re-escanear y **diferenciar** el YAML generado contra el commiteado, y reportar "tu diagrama miente: ya no llamas a la API B". Convierte el diagrama en algo verificable en CI, no en un PowerPoint olvidado.

## Consecuencias

### Positivas

- Un diagrama de arquitectura pasa a ser **código revisable en un PR**: se ve el diff, se comenta, se aprueba.
- La animación por flujo elimina el problema del espagueti de flechas sin necesidad de dibujar mejor: el layout puede ser incluso mediocre si el recorrido está animado.
- Un solo modelo alimenta varias salidas: web animada, draw.io, Mermaid (útil para pegar en descripciones de PR y para que Copilot lo entienda), SVG/PNG.
- El campo `provides` de cada servicio (método + ruta + operación) contiene lo necesario para, más adelante, **generar el esqueleto OpenAPI** desde el diagrama y cerrar el ciclo contract-first. El esquema se diseña desde hoy con ese objetivo.
- Al ser 100% local y sin egress, el argumento de seguridad para adoptarlo en el banco es trivial de defender.
- Independencia del proveedor de IA: el skill es un documento de instrucciones + un esquema. Funciona con Claude en casa y con Copilot en el banco.

### Negativas / Trade-offs

- **Formato propietario.** Nadie fuera de ArchiFlow lee `.arch.yaml`. Se mitiga con los exports, pero el import desde draw.io queda fuera de alcance (sería reconstruir semántica desde geometría, un problema mal planteado). Migrar diagramas existentes es trabajo manual o asistido por agente.
- **El análisis de código no será exacto.** Un recolector por configuración y anotaciones no ve llamadas construidas dinámicamente, URLs que llegan por variable de entorno resuelta en runtime, ni lógica de ruteo condicional. El resultado es un borrador de alta calidad que un humano revisa, no una verdad automática. Hay que comunicarlo así o se pierde la confianza.
- **La animación es opinada.** Modelar un flujo como secuencia de pasos no captura bien retries, circuit breakers, timeouts ni paralelismo complejo. El esquema reserva `async` y grupos paralelos, pero los casos avanzados (reintentos, sagas, compensaciones) quedan como deuda explícita.
- **YAML tiene aristas.** Se mitiga con validación estricta y mensajes de error que apunten a línea y columna, no con confiar en el usuario.
- **Doble granularidad = doble superficie.** Soportar nivel componente *y* nivel método puede diluir el foco. Se resuelve priorizando: componente es el MVP, método es una vista más sobre el mismo esquema, no un modelo distinto.

### Notas de implementación

**Stack elegido:**

- **Renderer:** React + TypeScript + Vite. **React Flow (xyflow)** para el canvas y los nodos personalizados (MIT, funciona offline). **ELK.js** para el auto-layout jerárquico por capas, que respeta las `zones` como contenedores — es lo que evita el espagueti.
- **Animación:** las aristas son `path` SVG; un "paquete" recorre el path con `getPointAtLength`, controlado por un reloj propio. Timeline con play/pausa/scrub y velocidad. Los pasos `async` no bloquean el avance y se dibujan con trazo discontinuo.
- **Distribución:** un único paquete npm `archiflow`, ejecutable con `npx archiflow serve ./diagrams`. El CLI levanta un servidor local que sirve el bundle web ya construido, vigila la carpeta con `chokidar`, valida y compila a IR, y empuja los cambios por WebSocket. El bucle de trabajo es: **el agente escribe el YAML → el navegador se actualiza solo.** Es el mismo patrón que el skill de edición de vídeo que sirve de referencia.
- **Validación:** Zod como fuente única, generando JSON Schema para autocompletado en el editor.
- **Paquete único, no monorepo.** Con un solo desarrollador, el coste de orquestación de un monorepo (workspaces, builds cruzados, versionado) supera el beneficio de la separación. Las fronteras se mantienen por carpetas: `src/schema`, `src/analyzer`, `src/cli`, `web/`.

**Comandos previstos del CLI:**

| Comando | Función |
|---|---|
| `archiflow serve <dir>` | Levanta la web local con hot-reload sobre los YAML |
| `archiflow scan <repo>` | Recolecta evidencias de un repo Quarkus/Spring → `evidence.json` |
| `archiflow validate <file>` | Valida contra el esquema |
| `archiflow export <file> --to drawio\|mermaid\|svg` | Exporta |
| `archiflow diff <file> <repo>` | Compara el diagrama commiteado contra la realidad del código |

**Skills a construir:**

1. `archiflow-design` — de contexto en lenguaje natural a `.arch.yaml`.
2. `archiflow-scan` — de repositorio a `.arch.yaml`, consumiendo la salida de `archiflow scan`.
3. `archiflow-contract` *(futuro)* — de `.arch.yaml` a esqueleto OpenAPI, cerrando el ciclo contract-first.

**Fuera de alcance de la v1** (declarado para evitar deriva): importar desde draw.io, colaboración multiusuario, exportación a vídeo/GIF, y generación de código del microservicio.

> [!note] Alcance ampliado
> Este ADR declaraba también la **edición gráfica bidireccional** fuera de alcance. Resultó ser un recorte demasiado agresivo: revisar un diagrama generado por un agente casi siempre exige tres o cuatro retoques, y obligar a abrir el YAML para eso rompe el flujo. Se implementó en [[ADR-002_Edicion_bidireccional_por_mutaciones]].

## Notas Relacionadas

- [[ADR-002_Edicion_bidireccional_por_mutaciones]]
- [[Esquema_arch_yaml]]
