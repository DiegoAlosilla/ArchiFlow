---
name: archiflow-design
description: Genera un diagrama de arquitectura animado (.arch.yaml de ArchiFlow) a partir de una descripción en lenguaje natural. Úsala cuando el usuario describa cómo se comunican unos servicios y quiera verlo como diagrama, diga "haz el diagrama de", "diagrama esta arquitectura", "el microservicio A llama a B y C", o pida un diagrama de componentes o de flujo entre servicios.
---

# ArchiFlow: diagrama desde contexto

Convierte una descripción en prosa en un fichero `.arch.yaml` que ArchiFlow renderiza como diagrama animado.

## Lo que hay que entender antes de escribir nada

Un diagrama de ArchiFlow **no es una lista de cajas y flechas**. Son dos cosas separadas:

1. **La topología** (`nodes` agrupados en `zones`): qué existe y dónde vive.
2. **Los flujos** (`flows`): recorridos concretos, en orden, que se reproducen como animación.

**Las aristas se infieren de los pasos de los flujos.** No hay una sección `edges` que rellenar en el caso normal. Si un paso va de `a` a `b`, la flecha existe. Declarar la flecha aparte es un error.

Esto cambia cómo hay que leer la descripción del usuario. Cuando alguien dice *"el microservicio A consume el B, el C y el D"*, lo que hay que averiguar es **en qué orden y bajo qué escenario**, porque eso es lo que se anima. Una lista de dependencias sin orden produce un diagrama estático y aburrido: exactamente el problema que ArchiFlow existe para resolver.

## Procedimiento

### 1. Extraer los nodos

Cada elemento mencionado es un nodo con un `kind`:

| kind | Cuándo |
|---|---|
| `client` | App móvil, canal, consumidor humano |
| `frontend` | Web, SPA |
| `gateway` | API Gateway, ingress, balanceador, APIM |
| `service` | Microservicio propio |
| `external` | API de terceros, core legado, otro dominio |
| `database` | Relacional o documental |
| `cache` | Redis, Hazelcast |
| `broker` | Kafka, MQ, RabbitMQ |
| `job` | Batch, cron |
| `storage` | Buckets, ficheros |
| `component` | Solo para flujos a nivel método |

Usa el `id` como identificador corto y estable (`bff-cuentas`, `ms-customer`), y `label` para el nombre visible. Rellena `tech` siempre que el usuario lo mencione: aporta muchísimo contexto por muy poco texto.

### 2. Agrupar en zonas

Las `zones` son lo que evita el espagueti de flechas, así que casi nunca se deben omitir. Agrupa por capa arquitectónica, clúster o red. En banca lo habitual es:

`canales` → `experiencia` (BFF) → `negocio` → `datos`

Si el usuario menciona clústeres (`AKS-PROD-01`), ponlos en `platform` de la zona.

### 3. Identificar los flujos — la parte que importa

Pregúntate: **¿qué le pasa a una petición desde que entra hasta que se responde?**

Cada flujo es un escenario con nombre. Si la descripción sugiere caminos alternativos (acierto y fallo de caché, cliente premium y estándar, camino feliz y de error), **haz un flujo por cada uno**: dos flujos cortos comunican mucho mejor que uno con condicionales.

Para cada paso:

- `op` es la operación tal cual se escribe en el código: `GET /v1/cuentas`, `publish cuentas.consultadas`, `SELECT * FROM cuentas WHERE cliente_id = ?`.
- `protocol` cambia el color de la línea y del paquete animado. Usa el real: `https`, `http`, `redis`, `jdbc`, `kafka`, `soap`, `grpc`.
- `async: true` para fire-and-forget (publicar en Kafka, eventos). El flujo no espera y la línea sale discontinua.
- `latencyMs` cuando se conozca o se pueda estimar: es lo que hace evidente dónde está el cuello de botella.
- `condition` para el porqué del paso: `cache miss`, `cliente premium`.
- `note` para lo que no cabe en la operación.
- `request` y `response` para un ejemplo del contrato. Es texto libre: si el usuario da un JSON a medias, va tal cual; no lo completes inventando campos.

Si el usuario detalla los endpoints de un servicio, dale `expanded: true` y lista sus operaciones con `id` en `provides`: se dibujan como filas dentro de la caja. Entonces un paso puede apuntar a la operación concreta con `nodo/operacion`:

```yaml
nodes:
  - id: bff-cuentas
    kind: service
    expanded: true
    provides:
      - id: listar-cuentas
        method: GET
        path: /v1/cuentas

flows:
  - id: listar
    steps:
      - from: apigw
        to: bff-cuentas/listar-cuentas
        request: |
          { "clienteId": "0012345" }
```

La flecha sigue yendo de servicio a servicio: la operación solo afina la etiqueta y el punto de llegada.

### 4. Escribir y validar

Escribe el fichero como `<nombre>.arch.yaml` y **valídalo siempre**:

```bash
npx archiflow validate <directorio>
```

Corrige lo que salga antes de dárselo al usuario. Un diagrama que no compila no se puede ver.

Después, para que el usuario lo vea animado:

```bash
npx archiflow serve <directorio>
```

## Ejemplo completo

Descripción del usuario:

> La app móvil consulta las cuentas. Pasa por el API Gateway y llega al bff-cuentas, que está en Quarkus. Primero mira en Redis; si no está, llama a ms-customer que es Spring Boot y lee de Oracle. Además publica un evento en Kafka que consume ms-auditoria.

Resultado:

```yaml
archiflow: 1
name: Consulta de Cuentas

zones:
  - id: canales
    label: Canales
  - id: experiencia
    label: Experiencia (BFF)
  - id: negocio
    label: Negocio
  - id: datos
    label: Datos

nodes:
  - id: app-movil
    label: App Móvil
    kind: client
    zone: canales

  - id: apigw
    label: API Gateway
    kind: gateway
    zone: canales

  - id: bff-cuentas
    kind: service
    zone: experiencia
    tech: Quarkus 3
    provides:
      - method: GET
        path: /v1/cuentas

  - id: redis-cuentas
    label: Redis Cuentas
    kind: cache
    zone: experiencia

  - id: ms-customer
    kind: service
    zone: negocio
    tech: Spring Boot 3

  - id: db-clientes
    label: Oracle Clientes
    kind: database
    zone: datos

  - id: kafka
    kind: broker
    zone: datos

  - id: ms-auditoria
    kind: service
    zone: negocio

flows:
  - id: listar-cuentas
    label: Listar cuentas (cache miss)
    trigger: El usuario abre la pantalla "Mis cuentas"
    steps:
      - from: app-movil
        to: apigw
        op: GET /v1/cuentas
        protocol: https
      - from: apigw
        to: bff-cuentas
        op: GET /v1/cuentas
      - from: bff-cuentas
        to: redis-cuentas
        op: GET cuentas:{clienteId}
        protocol: redis
        note: Cache-aside
      - from: bff-cuentas
        to: ms-customer
        op: GET /internal/clientes/{id}/cuentas
        condition: cache miss
      - from: ms-customer
        to: db-clientes
        op: SELECT * FROM cuentas
        protocol: jdbc
      - from: bff-cuentas
        to: kafka
        op: publish cuentas.consultadas
        protocol: kafka
        async: true
      - from: kafka
        to: ms-auditoria
        op: consume cuentas.consultadas
        protocol: kafka
        async: true
```

## Errores que hay que evitar

- **Declarar `edges` a mano.** Se infieren de los flujos. Solo se usa `edges` para relaciones que no aparecen en ningún flujo (una réplica de base de datos, por ejemplo).
- **Un único flujo gigante con todos los caminos posibles.** Sepáralos por escenario.
- **Inventar latencias, tecnologías o nombres de topic.** Si el usuario no lo dijo y no se puede deducir, omite el campo. Un diagrama con datos inventados es peor que uno incompleto, porque nadie sabe qué parte creerse.
- **Mezclar niveles.** Un flujo a nivel componente no debe incluir métodos ni clases. Para eso está `level: method` en un flujo aparte.
- **Nodos sueltos.** Si un nodo no participa en ningún flujo, o sobra o falta el flujo que lo usa. El validador avisa.

## Flujos a nivel método

Cuando el usuario quiera el detalle interno de un servicio (capa REST → BO → DAO), usa `level: method` en el flujo y `kind: component` en los nodos. Es el mismo esquema, solo cambia la granularidad. Mantenlo en un fichero aparte del diagrama de componentes.

## Referencia del esquema

Está en `docs/02_Referencia/Esquema_arch_yaml.md`. Léelo si necesitas un campo que no aparezca aquí.
