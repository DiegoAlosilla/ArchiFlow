---
name: archiflow-scan
description: Genera un diagrama de arquitectura animado (.arch.yaml de ArchiFlow) a partir del código de un microservicio Quarkus o Spring Boot, y detecta si un diagrama existente se ha quedado desactualizado. Úsala cuando el usuario pida "diagrama este microservicio", "genera el diagrama desde el código", "qué consume este servicio", "actualiza el diagrama con lo que hay en el código", o quiera comprobar si la arquitectura documentada coincide con la real.
---

# ArchiFlow: diagrama desde código

Convierte un repositorio Quarkus o Spring Boot en un `.arch.yaml`, o compara el código con un diagrama existente.

## El principio que rige esta skill

**El recolector demuestra, tú interpretas.**

`archiflow scan` extrae solo lo que puede probar leyendo ficheros: anotaciones encontradas, propiedades de configuración, dependencias declaradas, con la línea exacta de cada hallazgo. Lo que **no** hace es decidir cómo se llama de verdad el servicio destino, en qué zona vive, ni qué pasos forman un flujo con sentido. Ese es tu trabajo.

Y hay un límite que **debes comunicar siempre al usuario**: el análisis estático no ve llamadas construidas dinámicamente, URLs que llegan por variable de entorno resuelta en despliegue, ni ruteo condicional. El resultado es **un borrador de alta calidad que un humano tiene que revisar**, nunca una verdad automática. Presentarlo como verdad destruye la confianza en la herramienta a la primera equivocación.

## Procedimiento

### 1. Recolectar evidencias

```bash
npx archiflow scan <ruta-del-repo> -o evidence.json
```

Salida:

```jsonc
{
  "service":    { "name", "framework", "frameworkVersion", "rootPath", ... },
  "endpoints":  [ { "method", "path", "handler", "source" } ],   // lo que expone
  "outbound":   [ { "kind", "configKey", "url", "targetHint", "operations", "source" } ],
  "messaging":  [ { "direction", "channel", "topic", "broker", "source" } ],
  "datastores": [ { "kind", "vendor", "url", "entities" } ],
  "config":     { ... },      // las propiedades relevantes, ya resueltas
  "warnings":   [ ... ]       // lo que vio pero no supo interpretar
}
```

### 2. Leer los avisos antes que nada

`warnings` es la parte más informativa del fichero. Un aviso como *"'saldos-api' está configurado como cliente REST pero no se encontró su interfaz Java"* significa que hay una arista real que el escáner no pudo atribuir. **Ábrela y búscala en el código** antes de dar el diagrama por bueno.

### 3. Contrastar `targetHint` con la realidad

`targetHint` es una **conjetura** deducida del host de la URL (`http://ms-customer.negocio.svc...` → `ms-customer`) o del nombre de la interfaz. Suele acertar, pero:

- Un host tras un balanceador o un APIM puede no llamarse como el servicio de destino.
- `localhost` y las IP no producen `targetHint`: ahí tendrás que deducir el destino del nombre de la interfaz o preguntar.
- Un `${VAR}` sin valor por defecto no se puede resolver leyendo el repositorio. No te lo inventes: crea el nodo con el nombre de la interfaz y **avisa al usuario de que ese destino está sin confirmar**.

### 4. Traducir evidencias a nodos y zonas semánticas

| Evidencia | Nodo |
|---|---|
| El propio servicio | `kind: service`, con `tech` de `framework` + `frameworkVersion`, y `repo` con la ruta |
| Cada `outbound` | Un nodo `service` (o `external` si es de otro dominio o legado) con el nombre de `targetHint` |
| `datastores` con `kind: sql` | `kind: database`, `tech` de `vendor` |
| `datastores` con `kind: redis` | `kind: cache` |
| `messaging` con broker | Un nodo `kind: broker` (uno solo para todo Kafka, no uno por topic) |
| `endpoints` | No son nodos independientes: van en `provides` del propio servicio, pero cada uno debe tener `id` estable y ser direccionable como `servicio/operacion` |

Si un servicio participa en un flujo por una operación concreta, añádele `expanded: true` aunque solo se esté mostrando un endpoint. Sus operaciones se dibujan como tarjetas horizontales dentro de la caja y las flechas se anclan a esas tarjetas. No basta con que el texto del endpoint aparezca como subtítulo. En una vista de flujo incluye solo las operaciones que participan en los escenarios mostrados; el inventario completo puede vivir en otra vista para no convertir el servicio en una banda inmanejable.

Todo endpoint incluido debe tener un `id` breve y estable, derivado del handler o de método+ruta. Cuando un paso entre o salga de una operación concreta, **ambos extremos que correspondan deben apuntar a ella** con `nodo/operacion`:

```yaml
- from: consumidor
  to: auth-service/autenticar
- from: auth-service/autenticar
  to: redis-sesiones
- from: auth-service/autenticar
  to: api-usuarios/consultar-usuario
```

Esto es obligatorio: escribir solo `from: auth-service` hace que la flecha nazca en el contenedor del microservicio, no en la caja del endpoint.

#### Clasificar zonas por responsabilidad, no por cercanía

`kind` y `zone` responden preguntas distintas: `kind` dice qué es el nodo; `zone` dice qué responsabilidad arquitectónica cumple. No agrupes todos los destinos de un endpoint como "Negocio" ni deduzcas la zona por el orden del flujo.

| Zona | Qué pertenece aquí | Qué no pertenece aquí |
|---|---|---|
| `canales` | apps, web, clientes, consumidores, gateway de canal | BFF, caché, API de dominio |
| `experiencia` | BFF, backend-for-frontend, API UX, orquestación específica de una experiencia | API de dominio, Redis, base de datos |
| `negocio` | API o microservicio que implementa capacidades/reglas de dominio | caché, broker, gateway, cliente, base de datos |
| `datos` | Redis/caché, bases de datos, almacenamiento y motores de búsqueda | APIs de negocio |
| `integracion` | brokers, colas, adaptadores y sistemas externos cuando convenga separarlos | servicios de dominio por defecto |

Reglas duras:

- Un nodo `kind: cache`, `database` o `storage` **nunca** va en `negocio` solo porque un servicio de negocio lo use. Por defecto va en `datos`.
- Un nodo `kind: client`, `frontend` o un gateway de entrada va en `canales`.
- Un BFF/API UX va en `experiencia`; no lo promociones a `negocio` por consumir una API business.
- Solo usa `negocio` cuando el nombre, paquete, contrato, host o comportamiento demuestre una capacidad de dominio.
- El host puede aportar evidencia (`*.negocio.svc...`), pero no gana sobre una contradicción semántica evidente como Redis o Kafka.
- Si el repositorio o la plataforma usan otra taxonomía, conserva su nomenclatura y explica la correspondencia. Si no hay evidencia suficiente, marca la zona como deducción pendiente de confirmación.

### 5. Construir los flujos

Aquí está el valor añadido, y es donde el escáner no puede ayudarte: **las evidencias son un grafo sin orden, y un flujo es una secuencia**.

Para cada endpoint solicitado o relevante, lee el código del handler y sigue la cadena de llamadas para determinar **en qué orden** se invocan las dependencias. Crea un flujo separado por endpoint y por rama significativa (por ejemplo, cache hit y cache miss).

El flujo debe empezar con lo que recibe el endpoint:

- Si el consumidor está probado por el repositorio, créalo y úsalo como origen.
- Si no se conoce, crea un nodo `kind: client`, `zone: canales`, con una etiqueta como `Consumidor no identificado`, y decláralo como deducción pendiente. No ocultes la entrada empezando directamente en el microservicio.
- El primer destino debe ser `servicio/operacion`, no solo `servicio`.
- Las llamadas directas realizadas por el handler deben salir de `servicio/operacion`, para que la flecha y la animación nazcan en la fila del endpoint.

Reglas prácticas:

- Un `@Incoming` / `@KafkaListener` es el **inicio** de su propio flujo, no un paso intermedio.
- Un `@Outgoing` / `@Channel` / `kafkaTemplate.send` es un paso `async: true` al final del flujo que lo dispara.
- Una consulta a caché va **antes** que la llamada que evita, con `condition: cache miss` en la llamada siguiente.
- No inventes latencias. Omite `latencyMs` salvo que el repositorio las documente.

#### Documentar lo que viaja en cada salto

Cada intercambio síncrono debe explicar el contrato y representar el viaje completo. Para una vista operativa, modela la ida y el retorno como pasos distintos:

```yaml
- from: auth-service/login
  to: postgres-auth
  op: Buscar usuario
  request: 'SELECT users WHERE email=:email'
- from: postgres-auth
  to: auth-service/login
  op: Retorna usuario
  request: 'Usuario { id, email, passwordHash, role }'
- from: auth-service/login
  to: consumidor
  op: 200 AuthResponse
  request: '{ accessToken, refreshToken, expiresIn, user }'
```

No termines el flujo en una caché, base de datos o API dependiente: vuelve al endpoint y cierra con la respuesta del endpoint al canal. El campo `response` puede resumir una respuesta en vistas compactas, pero no sustituye el paso de retorno cuando se está explicando el orden de ejecución.

- **Entrada al endpoint escaneado:** método, ruta, path/query params, headers relevantes y cuerpo/DTO que recibe; en `response`, status y DTO final que devuelve el endpoint.
- **Caché:** en `request`, operación y clave exacta o patrón de clave; en `response`, tipo/estructura del valor y cómo se interpreta hit, miss o error. Si escribe, indica qué valor guarda y TTL cuando esté probado.
- **API saliente:** método, path, headers/params/body que envía; en `response`, status y DTO/campos que consume.
- **Broker:** topic, key, headers y payload; si es fire-and-forget usa `async: true` y omite una respuesta inexistente.
- **Base de datos:** consulta u operación y parámetros; en `response`, filas/entidad/campos leídos o confirmación de escritura.

Declara los headers en `headers:` como datos estructurados; no los escondas dentro del texto de `request`. Incluye todos los obligatorios demostrados por OpenAPI, anotaciones, filtros o el cliente HTTP, marca `required: true` y sustituye secretos por `[omitido]`. `Content-Type` cuenta cuando el contrato exige un cuerpo JSON. El inspector de tráfico usa esta estructura para destacarlos al estilo Swagger.

Usa evidencia del DTO, firma, serializador, mapper, cliente y manejo de respuesta. Puedes resumir estructuras grandes, pero conserva nombres de campos. No inventes valores ni secretos. Si una parte no puede determinarse estáticamente, escribe lo comprobable y añade en `note` qué quedó sin resolver; no fabriques un contrato para llenar el campo.

El cuerpo puede conservar una notación compacta y fiel como `Usuario { id, email, role }` o JSON válido. El inspector lo presenta automáticamente con sangría, saltos de línea y colores tipo Postman; evita convertir una lista de campos en una frase ambigua que ya no pueda formatearse.

En los pasos de ida usa `request`; en los pasos explícitos de retorno usa `response`. No reutilices `request` para una respuesta aunque el payload viaje en la dirección de la flecha: la UI distingue ambos conceptos al seleccionar el paso y en la tarjeta animada.

#### Orden visual del recorrido

- La entrada del canal define la parte superior del diagrama.
- El endpoint o servicio receptor ocupa el siguiente nivel.
- Las dependencias de datos e integración se distribuyen debajo y, cuando comparten nivel, de izquierda a derecha en el orden en que aparecen en las solicitudes.
- Los pasos de respuesta no deben invertir ni recalcular los niveles: recorren en sentido contrario la geometría ya establecida por los requests.
- Prefiere conexiones rectas; usa un solo codo cuando baste y añade más puntos únicamente para evitar una caja. La ida (`request`) y la vuelta (`response`) deben ocupar carriles paralelos estables, nunca la misma línea. Evita fijar `layout.points` o `labelPosition` en el YAML generado salvo que el auto-layout no pueda resolver un cruce real.
- La posición automática del texto va sobre el tramo horizontal más largo de la flecha. No lo pongas debajo del trazo; si la conexión es vertical, ubícalo arriba y a un costado de su punto medio. Una posición ajustada manualmente por el usuario es libre y no debe volver a proyectarse ni limitarse a la ruta.
- La etiqueta se dibuja en una capa superior y con fondo completamente opaco: ningún trazo, ni siquiera una flecha seleccionada, puede verse a través del texto. Al arrastrarla conserva el punto exacto de agarre; tomar una esquina no debe saltar el centro de la etiqueta debajo del mouse.
- La tarjeta que viaja con la animación también debe quedar por encima del tramo y no puede cubrir un servicio. Si el centro está ocupado, desplázala primero hacia el lado del origen y después hacia el lado libre; no deformes la ruta solo para acomodar el texto.
- Los extremos de una flecha son editables. Al moverlos, guarda `sourceAnchor` o `targetAnchor` como posición relativa sobre el borde de la caja o tarjeta de endpoint; no congeles una coordenada absoluta que se desprenda cuando el nodo cambie de lugar.
- En edición, un codo se elimina con doble clic o `Supr`. La acción **Simplificar ruta** borra todos los puntos manuales y deja que el auto-layout reconstruya el recorrido mínimo; úsala antes de añadir nuevos codos cuando una flecha haya acumulado desvíos.
- Una edición pausa la línea de tiempo y nunca la reactiva al guardar. Solo cambiar deliberadamente de flujo puede reiniciar y reproducir automáticamente el recorrido; mover etiquetas, nodos, extremos o codos debe conservar el estado pausado.
- Antes de entregar, reproduce cada flujo y comprueba que las etiquetas no se superponen. Si hay varias dependencias, sepáralas horizontalmente antes de introducir curvas adicionales.

### 6. Validar y levantar la web oficial

```bash
npx archiflow validate <directorio>
npx archiflow serve <directorio> --open
```

Generar el YAML no completa la tarea. Después de validar, **debes levantar `archiflow serve` sobre el directorio que contiene el `.arch.yaml`**, comprobar que la URL local responde y entregar esa URL al usuario. El proceso debe quedar activo para que pueda revisar el diagrama y darte feedback.

No construyas un visor alternativo con HTML/CSS/JS y no uses Mermaid como sustituto. El resultado se muestra en la web oficial de ArchiFlow, que es la que lee el YAML, anima los paquetes y permite editarlo.

### 7. Entregar con honestidad

Al presentar el resultado, di **explícitamente**:

- Qué partes salen de evidencia directa (con el fichero y la línea).
- Qué partes son deducción tuya (zonas, orden de los pasos, nombres de destino sin URL).
- Qué avisos quedaron sin resolver.
- Qué URL local tiene abierta la web oficial de ArchiFlow.

## Detectar diagramas desactualizados

Este es el caso que más duele en un equipo con más de cien microservicios: el diagrama dice que se llama a la API B cuando el código ya llama a la C.

Procedimiento:

1. Lee el `.arch.yaml` existente (normalmente `architecture.arch.yaml` en la raíz del repo).
2. Ejecuta `archiflow scan` sobre el mismo repositorio.
3. Compara y reporta en tres listas:
   - **Aristas en el código que no están en el diagrama** → el diagrama se quedó corto.
   - **Aristas en el diagrama que no aparecen en el código** → posible dependencia muerta, o llamada dinámica que el escáner no ve. Hay que mirarla, no borrarla sin más.
   - **Diferencias de metadatos**: `tech` desactualizado tras una migración de framework, rutas cambiadas, topics renombrados.
4. Propón el diff del YAML. **No lo apliques sin que el usuario lo apruebe**: el diagrama puede tener contexto deliberado que el código no expresa.

## Dónde vive el fichero

En la **raíz del repositorio del microservicio**, como `architecture.arch.yaml`. Esa es la decisión que ataca el problema de fondo: si el diagrama vive junto al código, un PR puede exigir que cambie, y `archiflow scan` puede comprobar en CI que sigue siendo cierto. Un diagrama en una carpeta compartida aparte se desactualiza siempre.

## Lo que el recolector reconoce

**Quarkus:** `@Path` + `@GET`/`@POST`… (JAX-RS), `@RegisterRestClient(configKey)` correlacionado con `quarkus.rest-client.<key>.url`, `@Incoming`/`@Outgoing`/`@Channel` con `mp.messaging.*`, `quarkus.datasource.*.jdbc.url`, `quarkus.redis.hosts`, `quarkus.mongodb.connection-string`, Panache.

**Spring Boot:** `@RestController` + `@GetMapping`/`@PostMapping`/`@RequestMapping`, `@FeignClient(name, url)`, `RestTemplate`/`WebClient` con URL literal, `@KafkaListener(topics)`, `kafkaTemplate.send`, `spring.datasource.url`, `spring.data.redis.*`, `JpaRepository`, `@Entity`.

**Lo que no reconoce** (y por tanto hay que buscar a mano): URLs compuestas en tiempo de ejecución, clientes generados por plugins de OpenAPI en fase de build, ruteo por descubrimiento de servicios sin URL en configuración, y llamadas a través de abstracciones propias del equipo.
