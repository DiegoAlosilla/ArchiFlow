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

La web tiene dos modos. En **Ver** el diagrama se reproduce; en **Editar** puedes:

- Arrastrar nodos y que la posición quede fijada en el YAML.
- Cambiar cualquier propiedad desde el inspector, incluido el `id` (se actualizan en cascada todos los pasos que lo referencian).
- Añadir y borrar nodos, zonas y flujos.
- Arrastrar de un nodo a otro para **añadir un paso** al flujo activo. No se dibujan aristas: las aristas se infieren de los pasos, así que ofrecer un gesto de "dibujar flecha" mentiría sobre el modelo.
- Reordenar y editar los pasos de un flujo.

Lo importante de cómo está hecho: la web **no reescribe el fichero entero**. Envía mutaciones semánticas que el servidor aplica sobre el AST del YAML, de modo que **tus comentarios, el orden y el formato sobreviven** — un retoque produce un diff de una línea. Antes de escribir se valida el resultado completo; si la edición dejaría el diagrama inválido, no se toca el disco y se te dice por qué.

Puedes tener el fichero abierto a la vez en la web y en tu editor de texto: cada escritura comprueba una huella del contenido y, si cambió por otra vía, la web avisa en vez de pisarlo.

No hay deshacer: cada edición se guarda al momento. El respaldo es git, que es coherente con tratar el diagrama como código.

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

Recolecta evidencias de un repositorio **Quarkus o Spring Boot**: endpoints expuestos, clientes REST y su URL real, canales de Kafka, bases de datos, cachés. La skill `archiflow-scan` convierte esas evidencias en el diagrama.

La estrategia es híbrida a propósito: el recolector es determinista y solo reporta lo que puede demostrar (con fichero y línea); la interpretación —cómo se llama el destino, en qué zona vive, en qué orden ocurren los pasos— la hace el agente. **El resultado es un borrador de alta calidad para revisar, no una verdad automática.** El análisis estático no ve llamadas construidas en tiempo de ejecución ni URLs que llegan por variable de entorno, y el propio comando avisa de lo que no supo resolver.

Lo más valioso del recolector no es el escaneo del código Java sino la minería de la configuración: una línea como

```properties
quarkus.rest-client.customer-api.url=http://ms-customer.negocio.svc.cluster.local:8080
```

da a la vez la arista, el nombre del destino y hasta la zona.

## Comandos

| Comando | Qué hace |
|---|---|
| `archiflow serve [dir]` | Web local con recarga en caliente sobre los `.arch.yaml` |
| `archiflow validate [dir]` | Valida contra el esquema, con línea y columna en cada error |
| `archiflow scan [repo]` | Recolecta evidencias de un microservicio Quarkus/Spring |
| `archiflow export <file> --to drawio\|mermaid` | Exporta |

## Exportar

La web animada es el entregable. Los exports existen para compartir con quien no tiene ArchiFlow:

- **draw.io** (`.drawio`): una página con la topología y **una página por flujo con los pasos numerados**. Es la traducción honesta de una animación a un formato estático: se pierde el movimiento, se conserva el orden. Usa las mismas posiciones que la web.
- **Mermaid** (`.md`): la topología como `flowchart` y cada flujo como `sequenceDiagram`. Para pegar en la descripción de un PR — GitHub lo renderiza — y porque es el formato que un LLM entiende sin contexto adicional.

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

**Fuera de alcance por ahora**, para evitar deriva: importar desde draw.io, colaboración multiusuario, exportación a vídeo y generación de código del microservicio.

**Siguiente paso previsto:** `archiflow diff` (comparar el diagrama commiteado contra el código, para CI) y la generación del esqueleto OpenAPI desde el diagrama, que cierra el ciclo contract-first.

## Licencia

MIT.
