---
title: "Esquema del fichero .arch.yaml"
tags: [referencia, archiflow, esquema]
---

# Esquema del fichero `.arch.yaml`

Referencia completa del formato fuente de ArchiFlow. La decisión de usar YAML y el porqué del modelo están en [[ADR-001_Modelo_y_arquitectura_de_ArchiFlow]].

La fuente de verdad del esquema es `src/schema/schema.ts` (Zod). El validador rechaza claves desconocidas: una errata en un nombre de campo es un error, no un campo ignorado en silencio.

## Estructura

```yaml
archiflow: 1          # versión del formato
name: string          # obligatorio
description: string
version: string
owner: string
updated: string       # ISO, fecha de la última revisión humana

zones: []
nodes: []             # al menos uno
edges: []             # casi siempre vacío: se infieren de los flujos
flows: []
```

## `zones`

Agrupadores visuales: capa arquitectónica, clúster, red o dominio. Son lo que ordena el layout en carriles y lo que evita el espagueti de flechas.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | Obligatorio. Referenciado desde `nodes[].zone` |
| `label` | string | Por defecto, el `id` |
| `platform` | string | `AKS-PROD-01`, `On-premise` |
| `description` | string | |
| `color` | string | Hex (`#6366f1`). Si se omite, se asigna por posición |

## `nodes`

| Campo | Tipo | Por defecto | Notas |
|---|---|---|---|
| `id` | string | — | Obligatorio y único |
| `label` | string | el `id` | Nombre visible |
| `kind` | enum | `service` | Ver tabla abajo |
| `zone` | string | — | Debe existir en `zones` |
| `tech` | string | — | `Quarkus 3`, `Oracle 19c` |
| `platform` | string | la de la zona | Sobrescribe la de la zona |
| `description` | string | — | Aparece como tooltip |
| `repo` | string | — | Habilita el contraste contra el código |
| `tags` | string[] | `[]` | |
| `provides` | operación[] | `[]` | Endpoints expuestos |
| `expanded` | boolean | `false` | Dibuja las operaciones como filas anclables dentro del servicio |
| `topics` | string[] | `[]` | Solo tiene sentido en `kind: broker` |
| `external` | boolean | `false` | Lo dibuja con trazo discontinuo |
| `layout` | `{x, y}` | — | Posición fijada a mano, relativa a la zona |
| `appearance` | objeto | — | Colores, silueta e imagen elegida en el editor |

### `layout`

Lo escribe el editor gráfico al arrastrar un nodo, y gana sobre el auto-layout:

```yaml
  - id: bff-cuentas
    kind: service
    layout: { x: 120, y: 40 }
```

Es el único campo de presentación del formato. Borrarlo devuelve el nodo al layout automático (el inspector tiene un botón para hacerlo). En las zonas admite además `width` y `height`, y sus coordenadas son absolutas.

### `appearance`

```yaml
appearance:
  fill: '#ffffff'
  stroke: '#334155'
  icon: azure:function-app
  # image: https://ejemplo.com/iphone.svg
```

`icon` referencia una figura del catálogo local (`azure:*` o `uml:*`). `image` permite una URL `http(s)` o una imagen PNG, JPG, WebP o SVG cargada desde el editor y embebida como `data:image/...`. La imagen propia prevalece sobre `icon`. La semántica sigue viviendo en `kind`: cambiar la figura no convierte, por ejemplo, un canal en un servicio.

### Valores de `kind`

`service` · `frontend` · `client` · `gateway` · `database` · `cache` · `broker` · `external` · `job` · `storage` · `component`

`component` está reservado para flujos a nivel método (clases, capas).

### Operaciones (`provides`)

```yaml
provides:
  - id: listar-cuentas       # opcional
    method: GET              # GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS
    path: /v1/cuentas
    label: Listar cuentas
    description: ...
```

Este bloque es lo que permitirá generar el esqueleto OpenAPI desde el diagrama y cerrar el ciclo contract-first. Rellénalo siempre que se conozca.

## `flows`

Un flujo es un escenario de ejecución con nombre. **Es lo que se anima.**

| Campo | Tipo | Por defecto | Notas |
|---|---|---|---|
| `id` | string | — | Obligatorio y único |
| `label` | string | el `id` | |
| `description` | string | — | |
| `level` | `component` \| `method` | `component` | Granularidad |
| `entry` | string | el `from` del primer paso | Quién dispara |
| `trigger` | string | — | `El usuario abre "Mis cuentas"`, `Cron 02:00` |
| `steps` | paso[] | `[]` | Puede estar vacío; se avisa, no es error |

### Pasos (`steps`)

| Campo | Tipo | Por defecto | Notas |
|---|---|---|---|
| `from` | string | — | Nodo origen |
| `to` | string | — | Nodo destino |
| `op` | string | — | La operación tal cual: `GET /v1/cuentas` |
| `label` | string | `op` | Alternativa más corta para el lienzo |
| `protocol` | enum | `http` | Determina el color de la línea y del paquete |
| `async` | boolean | `false` | Fire-and-forget: no bloquea y sale discontinuo |
| `condition` | string | — | `cache miss`, `cliente premium` |
| `latencyMs` | number | — | Se muestra y modula la duración de la animación |
| `returns` | string | — | Documenta la respuesta sin añadir un paso de vuelta |
| `request` | string | — | Body que viaja hacia el destino; usa `Sin body` cuando no existe |
| `response` | string | — | Contrato o ejemplo que vuelve; en un paso inverso identifica el paquete como respuesta |
| `pathParams` | lista de `{name, value?, required?, description?}` | `[]` | Parámetros embebidos en la ruta; no forman parte del body |
| `queryParams` | lista de `{name, value?, required?, description?}` | `[]` | Parámetros de query string; no forman parte del body |
| `headers` | lista de `{name, value?, required?, description?}` | `[]` | Headers que viajan en el paso; los obligatorios se resaltan en el inspector |
| `purpose` | string | — | Por qué el llamador necesita ejecutar este salto |
| `dataUsed` | lista de string | `[]` | Campos concretos de la respuesta o valor que el llamador realmente utiliza |
| `labelPosition` | `{x, y}` | — | Preferencia horizontal del rótulo; el renderer siempre la proyecta encima de la flecha |
| `layout` | ruta | — | Puntos de control del conector para este paso; permite editar aristas inferidas |
| `note` | string | — | |

Los extremos `from` y `to` aceptan `nodo/operación` cuando la operación tiene `id` en `provides`. En un nodo `expanded`, la flecha se ancla a esa fila concreta. Para que una llamada realizada por un endpoint nazca en su caja, usa también la operación en el origen: `from: auth-service/autenticar`.

En una vista que explica ejecución completa, representa también los retornos como pasos (`base → endpoint` y finalmente `endpoint → canal`). Usa `request` en los pasos de ida y `response` en esos pasos inversos: así el editor identifica correctamente cada paquete. El auto-layout toma los requests como dirección del orden espacial; las respuestas recorren ese orden de vuelta sin invertir las capas.

No escribas query/path params dentro de `request`: el inspector y el GIF tienen secciones separadas para URL, headers y body. En cachés, bases y APIs salientes usa `purpose` y `dataUsed` para distinguir “consulta el perfil” de “consulta el perfil porque solo necesita `sex`”.

El renderer asigna carriles paralelos y estables a ida y vuelta. Las etiquetas automáticas se colocan encima del tramo horizontal principal; `labelPosition` solo es necesario cuando una revisión humana quiere ajustar una excepción.
La tarjeta animada prueba posiciones superiores centrada, hacia el origen y hacia el destino, y elige la primera que no cubra una caja de servicio.
`sourceAnchor` y `targetAnchor` expresan la posición relativa del extremo sobre su caja (`0..1` en cada eje). El editor permite arrastrar inicio y punta por cualquiera de los cuatro bordes y conserva esos anclajes aunque el nodo se mueva.

### Valores de `protocol`

`http` · `https` · `grpc` · `graphql` · `soap` · `kafka` · `amqp` · `jms` · `mq` · `jdbc` · `sql` · `nosql` · `redis` · `file` · `internal`

## `edges`

**Normalmente esta sección se deja vacía.** Las aristas se infieren de los pasos de los flujos: si existe un paso de `a` a `b`, existe la flecha. Declararla también es duplicación, y la duplicación es lo que desincroniza un diagrama.

Solo se usa para relaciones que no aparecen en ningún flujo, como una réplica de base de datos o una dependencia de arranque:

```yaml
edges:
  - from: db-primaria
    to: db-replica
    label: replicación
    protocol: jdbc
    async: true
```

## Cómo se calcula la animación

- Un paso **síncrono** ocupa su duración completa; el siguiente empieza cuando termina.
- Un paso **asíncrono** no bloquea: el siguiente arranca casi de inmediato y ambos se ven en vuelo a la vez.
- La duración sale de `latencyMs` en **escala logarítmica**, acotada entre 450 ms y 2,6 s. Es deliberado: 5 ms y 50 ms deben distinguirse, pero un paso de 5 s no puede durar diez veces más que uno de 500 ms o el diagrama se vuelve inservible.
- Sin `latencyMs`, un paso dura 900 ms.

## Validación

```bash
npx archiflow validate <directorio>
```

Además del esquema, se comprueba: unicidad de ids, que toda referencia a nodo o zona exista, y se avisa de nodos que no participan en ningún flujo y de diagramas sin flujos (se verían estáticos).

## Edición desde la web

El modo **Editar** de `archiflow serve` escribe sobre este mismo fichero. Lo hace por mutaciones aplicadas al AST del YAML, así que **conserva comentarios, orden y formato**: un retoque produce un diff del tamaño del retoque. Antes de escribir valida el resultado completo, y si la edición dejaría el diagrama inválido no toca el disco.

Puedes tener el fichero abierto a la vez en la web y en tu editor: cada escritura comprueba una huella del contenido y, si cambió por otra vía, la web avisa en lugar de pisarlo.

## Notas Relacionadas

- [[ADR-001_Modelo_y_arquitectura_de_ArchiFlow]]
- [[ADR-002_Edicion_bidireccional_por_mutaciones]]
