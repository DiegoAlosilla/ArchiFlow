# ArchiFlow

Diagramas de arquitectura **animados**, generados desde una descripción o desde el código de tus microservicios. Local, gratuito y sin que nada salga de tu máquina.

## El problema

Un diagrama de componentes con quince cajas y treinta flechas no comunica *qué pasa cuando llega una petición*. Hay que reconstruir el recorrido mentalmente siguiendo flechas cruzadas. Y con más de cien microservicios, el diagrama se desactualiza en cuanto alguien migra de framework o cambia una dependencia: vive fuera del repositorio, así que ningún PR lo obliga a cambiar.

ArchiFlow ataca las dos cosas:

- **La animación.** Eliges un caso de uso y lo ves viajar: la petición entra por el canal, pasa por el gateway, consulta Redis, va al servicio de negocio, lee de Oracle y publica un evento en Kafka. Lo que no participa en ese flujo se atenúa.
- **El diagrama vive en el repositorio**, como código revisable en un PR, y se puede contrastar contra la realidad del código.

## Arranque rápido

```bash
npm install && npm run build
```

```bash
npx archiflow serve ./examples
```

Abre `http://localhost:4123`. Edita el `.arch.yaml` y el navegador se actualiza solo.

## Editar desde la web

El lienzo siempre es editable: al seleccionar un objeto aparece el inspector. Puedes:

- Arrastrar nodos y que la posición quede fijada en el YAML.
- **Redimensionar** nodos y zonas con las asas del elemento seleccionado.
- Cambiar cualquier propiedad desde el inspector, incluido el `id` (se actualizan en cascada todos los pasos que lo referencian).
- Añadir y borrar nodos, zonas y flujos.
- Arrastrar de un conector a otro para **añadir un paso** al flujo activo. No se dibujan aristas: las aristas se infieren de los pasos, así que ofrecer un gesto de "dibujar flecha" mentiría sobre el modelo.
- Reordenar y editar los pasos de un flujo.
- Importar `.drawio` o `.xml` desde **Importar**, conservando geometría, colores, anclas y puntos intermedios.
- Activar **Animar ruta** y seleccionar cuadros consecutivos para construir el recorrido sin arrastrar conectores.
- Cambiar entre tema claro y oscuro sin alterar los colores propios del diagrama.

Lo importante de cómo está hecho: la web **no reescribe el fichero entero**. Envía mutaciones semánticas que el servidor aplica sobre el AST del YAML, de modo que **tus comentarios, el orden y el formato sobreviven** — un retoque produce un diff de una línea. Antes de escribir se valida el resultado completo; si la edición dejaría el diagrama inválido, no se toca el disco y se te dice por qué.

Puedes tener el fichero abierto a la vez en la web y en tu editor de texto: cada escritura comprueba una huella del contenido y, si cambió por otra vía, la web avisa en vez de pisarlo.

La barra incluye deshacer y rehacer para los cambios realizados durante la sesión. Git sigue siendo el historial persistente del diagrama.

## Cómo es un diagrama

Un diagrama son **dos cosas separadas**: una topología y N flujos que se superponen sobre ella.

```yaml
archiflow: 1
name: Consulta de Cuentas

zones:
  - id: experiencia
    label: Experiencia (BFF)
    platform: AKS-PROD-01

nodes:
  - id: bff-cuentas
    kind: service
    zone: experiencia
    tech: Quarkus 3
    provides:
      - method: GET
        path: /v1/cuentas

  - id: redis-cuentas
    kind: cache
    zone: experiencia

flows:
  - id: listar-cuentas
    trigger: El usuario abre "Mis cuentas"
    steps:
      - from: bff-cuentas
        to: redis-cuentas
        op: GET cuentas:{clienteId}
        protocol: redis
        latencyMs: 2
```

**Las flechas se infieren de los pasos.** No hay que declararlas aparte: esa duplicación es justo lo que desincroniza los diagramas.

Referencia completa del formato: [`docs/02_Referencia/Esquema_arch_yaml.md`](docs/02_Referencia/Esquema_arch_yaml.md).

## Los dos caminos para generar un diagrama

### Desde una descripción

Le describes la arquitectura a un agente con la skill `archiflow-design` y produce el `.arch.yaml`. Es el flujo del arquitecto: primero el diagrama, luego el contrato, luego el microservicio.

### Desde el código

```bash
npx archiflow scan ./mi-microservicio -o evidence.json
```

Recolecta evidencias de un repositorio **Quarkus o Spring Boot**: endpoints expuestos, clientes REST y su URL real, canales de Kafka, bases de datos, cachés. La skill `archiflow-scan` convierte esas evidencias en un recorrido completo: flechas separadas de request y response, bodies, parámetros, headers obligatorios y recursos concretos como endpoints destino, mapas Redis, pools, tablas, colecciones y topics. Si un valor solo existe fuera del repositorio, conserva la variable y deja un marcador visible para completarlo.

La estrategia es híbrida a propósito: el recolector es determinista y solo reporta lo que puede demostrar (con fichero y línea); la interpretación —cómo se llama el destino, en qué zona vive, en qué orden ocurren los pasos— la hace el agente. **El resultado es un borrador de alta calidad para revisar, no una verdad automática.** El análisis estático no ve llamadas construidas en tiempo de ejecución ni URLs que llegan por variable de entorno, y el propio comando avisa de lo que no supo resolver.

Lo más valioso del recolector no es el escaneo del código Java sino la minería de la configuración: una línea como

```properties
quarkus.rest-client.customer-api.url=http://ms-customer.negocio.svc.cluster.local:8080
```

da a la vez la arista, el nombre del destino y hasta la zona.

## Instalar las skills de ArchiFlow

El repositorio incluye ocho skills: `archiflow-design`, `archiflow-import`,
`archiflow-scan`, `archiflow-dictation`, `archiflow-endpoints`, `archiflow-c4`
y `archiflow-sequence`, además de `archiflow-tech-lead`. Instálalas después de clonar el repositorio para que
el asistente pueda importar con fidelidad, inventariar endpoints y separar
vistas C4 y secuencias sin mezclar niveles, o preparar una propuesta técnica
trazable y contrastarla con contratos OpenAPI.

```bash
git clone https://github.com/DiegoAlosilla/ArchiFlow.git
cd ArchiFlow
npm install
npm run skills:install
```

El comando instala o actualiza las skills en `~/.claude/skills/` y reemplaza
solo las carpetas `archiflow-*`. Reinicia Claude Code y estarán disponibles,
por ejemplo, como `/archiflow-design` o `/archiflow-import`.

Para Codex, copia las carpetas de `skills/` a la carpeta local de skills y
reinicia la aplicación:

```powershell
Copy-Item -Recurse -Force .\skills\archiflow-* "$env:USERPROFILE\.codex\skills\"
```

En ambos casos, vuelve a ejecutar la instalación tras actualizar el repositorio
para recibir cambios en las instrucciones de las skills. La instalación es
local: no sube diagramas, código ni credenciales a ningún servicio.

## Comandos

| Comando | Qué hace |
|---|---|
| `archiflow serve [dir]` | Web local con recarga en caliente sobre los `.arch.yaml` |
| `archiflow validate [dir]` | Valida contra el esquema, con línea y columna en cada error |
| `archiflow scan [repo]` | Recolecta evidencias de un microservicio Quarkus/Spring |
| `archiflow import <file>` | Convierte un `.drawio` o un ArchiMate en un `.arch.yaml` borrador |
| `archiflow export <file> --to drawio\|svg\|mermaid\|json\|archimate` | Exporta |

## Exportar

La web animada es el entregable. Los exports existen para compartir con quien no tiene ArchiFlow. Están en el menú **Exportar** de la web y en `archiflow export`:

| Formato | Para qué |
|---|---|
| **draw.io** (`.drawio`) | Una página con la topología y **una por flujo, con los pasos numerados**. Traducción honesta de una animación a un formato estático: se pierde el movimiento, se conserva el orden. |
| **SVG** | Vectorial y autocontenido. Se abre en cualquier sitio, se incrusta en un correo y draw.io también lo importa. |
| **PNG / JPG** | Rasterizados del SVG a 1×, 2× o 3×, con tema claro u oscuro y fondo opcionalmente transparente. |
| **GIF animado** | Una vuelta completa del flujo activo, en bucle. Es lo que se pega en un Confluence o en un Teams, donde acaba viviendo la documentación. |
| **PDF** | Una página con el diagrama, para imprimir o adjuntar. |
| **Mermaid** (`.md`) | Topología como `flowchart` y cada flujo como `sequenceDiagram`. Para pegar en un PR — GitHub lo renderiza — y porque un LLM lo entiende sin contexto. |
| **JSON** | El modelo compilado, con las aristas ya inferidas y la línea de tiempo calculada, para alimentar otra herramienta. |
| **ArchiMate** (`.xml`) | *Open Exchange File Format* de The Open Group, que Archi importa nativamente. Lleva los elementos, las relaciones y una vista con la geometría, para que al abrirlo haya un diagrama y no solo un árbol de modelo. |

El export a draw.io acepta además `--archimate`, que dibuja cada tipo con la forma ArchiMate que le corresponde en vez de con rectángulos.

Todos los formatos de imagen salen del **mismo layout y el mismo trazador de aristas que usa la web**, así que el fichero exportado es el diagrama que estabas viendo, no una reconstrucción parecida. Y todo se genera en tu máquina: nada sale de ella.

```bash
npx archiflow export mi-diagrama.arch.yaml --to svg --flow listar-cuentas --light
```

## Desarrollo

```bash
npm run dev          # Vite en :4124 (necesita `npm run cli -- serve ./examples` en otra terminal)
npm run typecheck
npm test
npm run build
```

## Estado

Versión temprana. Funciona el ciclo completo (esquema → validación → render animado → edición → export) y el recolector de evidencias para Quarkus y Spring.

Del inspector aún faltan `provides`, `topics` y `tags`: esos campos hay que tocarlos en el YAML.

**Limitaciones conocidas hoy:**

- El importador de draw.io y ArchiMate produce **borradores**: reconstruir semántica desde geometría acierta mucho y falla algo, y el orden de los pasos es una conjetura salvo que las flechas vengan numeradas. La skill `/archiflow-import` es la que lo interpreta bien.
- La exportación a ArchiMate valida contra el XSD oficial, pero **nadie la ha abierto todavía en Archi**.
- El historial de deshacer vive en la sesión del servidor: se pierde al reiniciarlo, y solo cubre las escrituras hechas desde la web. El respaldo real sigue siendo git.
- Las páginas son ficheros de la carpeta: no se pueden crear ni renombrar desde la web.
- Los ajustes de animación se escriben a mano en el YAML (clave `animation:`); los controles de la barra inferior valen solo para la sesión.

**Siguientes pasos**, priorizados y con las decisiones de diseño ya tomadas: [HANDOFF.md](HANDOFF.md) y [ADR-003](docs/01_Arquitectura/ADR-003_Modelo_extendido_paginas_e_interoperabilidad.md). Más allá de eso: `archiflow diff` (contrastar el diagrama contra el código en CI) y la generación del esqueleto OpenAPI, que cierra el ciclo contract-first.

## Licencia

MIT.
