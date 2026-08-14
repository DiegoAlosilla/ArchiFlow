# Plantilla estricta de flujo por endpoint

Usar esta plantilla en todo scan de código. No resumirla como una sola flecha.

Abrir también [complete-endpoint-example.arch.yaml](complete-endpoint-example.arch.yaml) y usarlo como patrón canónico completo. La plantilla explica; el YAML demuestra la forma exacta esperada.

## Algoritmo obligatorio

1. Elegir un endpoint.
2. Abrir controller/resource, método handler y DTO de entrada.
3. Enumerar path params, query params, body y headers obligatorios.
4. Seguir cada llamada desde el handler hasta su implementación concreta.
5. Para cada dependencia síncrona, identificar request y response antes de continuar.
6. Si la dependencia es otro servicio, resolver también su operación destino desde la interfaz cliente y declarar `destino/operacion`.
7. Si la dependencia es infraestructura, resolver su identidad: conexión/pool y mapa, clave, tabla, colección, topic o bucket.
8. Abrir DTO final, mapper y status devuelto por el endpoint.
9. Escribir primero todas las flechas de ida.
10. Escribir después cada retorno en orden inverso hasta llegar al canal.
11. Separar cache hit, cache miss y errores que cambian el recorrido.
12. Ejecutar la lista de aprobación de `SKILL.md`. No servir un flujo reprobado.

## Fallos que invalidan el resultado

- Solo hay flechas hacia las dependencias y ninguna vuelve.
- La animación termina en caché, base de datos, broker síncrono o API saliente.
- `request` o `response` están vacíos aunque existan DTOs, firmas, tests u OpenAPI.
- El response viaja en `request`, o el request viaja en `response`.
- Se omiten headers obligatorios encontrados en anotaciones, filtros o clientes.
- La flecha toca el contenedor del servicio cuando existe una operación concreta.
- La flecha termina en el contenedor de otro microservicio aunque el cliente declare método y ruta destino.
- Redis o una base aparecen con un nombre genérico pese a existir mapa, pool, tabla, colección o variable de configuración.
- Se mezclan cache hit y cache miss en una secuencia imposible.
- Se inventan campos para ocultar que un contrato no pudo demostrarse.

## Esqueleto mínimo: cache miss + API síncrona

Sustituir cada marcador por evidencia real. No conservar `<...>` en la entrega; si algo no se puede determinar, describirlo en `note`.

```yaml
nodes:
  - id: servicio
    kind: service
    expanded: true
    provides:
      - id: <operation-id>
        method: <METHOD>
        path: <path-entrada>
  - id: api-business
    kind: service
    expanded: true
    provides:
      - id: <operation-id-destino>
        method: <METHOD>
        path: <path-saliente>
  - id: cache
    label: <nombre lógico del mapa/cache>
    kind: cache
    tech: 'Redis · <instancia> · map <nombre-mapa>'

flows:
  - id: <endpoint>-cache-miss
    label: <METHOD path> · cache miss
    entry: canal
    steps:
      - from: canal
        to: servicio/<operation-id>
        op: <METHOD path>
        protocol: https
        pathParams:
          - { name: <path-param>, value: <ejemplo>, required: true }
        queryParams:
          - { name: <query-param>, value: <ejemplo>, required: false }
        request: |
          <solo request body; "Sin body" cuando corresponda>
        headers:
          - name: <header-obligatorio>
            required: true
            description: <por qué se exige>

      - from: servicio/<operation-id>
        to: cache
        op: GET <mapa/keyspace> · <patrón-de-clave>
        protocol: redis
        request: '<clave exacta o patrón probado>'
        purpose: <por qué el endpoint necesita consultar esta caché>

      - from: cache
        to: servicio/<operation-id>
        op: Cache miss
        protocol: redis
        response: 'miss'

      - from: servicio/<operation-id>
        to: api-business/<operation-id-destino>
        op: <METHOD path saliente>
        protocol: https
        request: |
          <params/body enviados>
        headers:
          - name: <header-saliente-obligatorio>
            required: true

      - from: api-business/<operation-id>
        to: servicio/<operation-id>
        op: <status y DTO>
        protocol: https
        response: |
          <response body consumido>
        dataUsed:
          - <campo realmente leído por el llamador>

      - from: servicio/<operation-id>
        to: cache
        op: SET <mapa/keyspace> · <patrón-de-clave>
        protocol: redis
        request: |
          <valor almacenado y TTL probado>

      - from: cache
        to: servicio/<operation-id>
        op: Cache actualizado
        protocol: redis
        response: OK

      - from: servicio/<operation-id>
        to: canal
        op: <status DTO final>
        protocol: https
        response: |
          <response body final>
```

## Esqueleto mínimo: cache hit

```yaml
steps:
  - from: canal
    to: servicio/<operation-id>
    op: <METHOD path>
    request: <request completo>
    pathParams: <path params estructurados>
    queryParams: <query params estructurados>
    headers: <headers obligatorios>
  - from: servicio/<operation-id>
    to: cache
    op: GET <clave>
    protocol: redis
    request: <clave>
    purpose: <por qué se consulta la caché>
  - from: cache
    to: servicio/<operation-id>
    op: Cache hit
    protocol: redis
    response: <valor recuperado>
    dataUsed: [<campos realmente utilizados>]
  - from: servicio/<operation-id>
    to: canal
    op: <status DTO final>
    response: <response final>
```

No añadir la API business al flujo de cache hit si el código no la invoca.

## Valores externos

Cuando el código use una variable sin valor local, no borrar su identidad ni inventar el valor:

```yaml
nodes:
  - id: redis-sesiones
    label: Sesiones
    kind: cache
    tech: 'Redis · map ${SESSION_MAP} · valor externo pendiente'
    description: '[PENDIENTE: resolver SESSION_MAP en configuración de despliegue]'

steps:
  - from: auth-service/login
    to: redis-sesiones
    op: 'GET ${SESSION_MAP}:session:{userId}'
    protocol: redis
    request: '${SESSION_MAP}:session:{userId}'
    note: 'SESSION_MAP se referencia en application.properties pero no tiene valor en el repositorio.'
```
