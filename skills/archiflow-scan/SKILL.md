---
name: archiflow-scan
description: Genera y audita un diagrama de arquitectura animado (.arch.yaml de ArchiFlow) a partir del código de un microservicio Quarkus o Spring Boot. Reconstruye el viaje completo por endpoint —request y response en flechas separadas, request/response body, parámetros, headers obligatorios, cachés, datos y APIs salientes— y detecta diagramas desactualizados. Úsala cuando el usuario pida "diagrama este microservicio", "escanea este endpoint", "genera el diagrama desde el código", "qué consume este servicio", "actualiza el diagrama con lo que hay en el código", o quiera comprobar si la arquitectura documentada coincide con la real.
---

# ArchiFlow: diagrama desde código

Convierte un repositorio Quarkus o Spring Boot en un `.arch.yaml`, o compara el código con un diagrama existente.

## El principio que rige esta skill

**El recolector demuestra, tú interpretas.**

`archiflow scan` extrae solo lo que puede probar leyendo ficheros: anotaciones encontradas, propiedades de configuración, dependencias declaradas, con la línea exacta de cada hallazgo. Lo que **no** hace es decidir cómo se llama de verdad el servicio destino, en qué zona vive, ni qué pasos forman un flujo con sentido. Ese es tu trabajo.

Y hay un límite que **debes comunicar siempre al usuario**: el análisis estático no ve llamadas construidas dinámicamente, URLs que llegan por variable de entorno resuelta en despliegue, ni ruteo condicional. El resultado es **un borrador de alta calidad que un humano tiene que revisar**, nunca una verdad automática. Presentarlo como verdad destruye la confianza en la herramienta a la primera equivocación.

## Procedimiento

Antes de comenzar, lee completos estos dos recursos:

1. [references/endpoint-flow-template.md](references/endpoint-flow-template.md), como procedimiento de baja libertad.
2. [references/complete-endpoint-example.arch.yaml](references/complete-endpoint-example.arch.yaml), como patrón canónico sin placeholders.

Imita la **estructura**, no los nombres del ejemplo. Para cada endpoint conserva entrada, ida, retorno, cierre al canal, anclas `servicio/operacion`, params separados, headers, body, `purpose` y `dataUsed`. Elimina una sección solo cuando la evidencia demuestre que no aplica. No confíes en recordar la lista desde prosa: compara el YAML terminado lado a lado con el ejemplo y ejecuta el auditor estricto.

### 0. Sincronizar el repositorio antes de leerlo

Nunca escanees una copia local sin comprobar primero el remoto. Si la ruta pertenece a Git:

```bash
git -C <ruta-del-repo> remote get-url origin
git -C <ruta-del-repo> fetch --prune origin
git -C <ruta-del-repo> status --short --branch
git -C <ruta-del-repo> rev-list --left-right --count HEAD...@{upstream}
```

- Si el árbol está limpio y la rama remota tiene cambios, ejecuta `git -C <ruta-del-repo> pull --ff-only` antes del scan.
- Si está limpio y actualizado, registra igualmente el commit (`git rev-parse HEAD`) en las evidencias de la entrega.
- Si hay cambios locales y el remoto avanzó, **no hagas stash, reset, merge ni sobrescribas nada**. Detén el scan y pide al usuario resolver o autorizar cómo integrar los cambios. Un diagrama generado sobre código desactualizado no es aceptable.
- Si no existe remoto o upstream, dilo explícitamente; no simules que se validó contra el remoto.

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

La salida del recolector es solo el índice de búsqueda. **No genera el contrato del flujo.** Después del scan, abre obligatoriamente el código y los contratos relacionados con cada endpoint que aparecerá en el diagrama.

Busca, en este orden:

1. OpenAPI/Swagger del repositorio y anotaciones del controller/resource.
2. Firma completa del handler: path/query/header/cookie params y body.
3. DTOs de request y response, tipos anidados, enums y validaciones (`@NotNull`, `@NotBlank`, `@Valid`, etc.).
4. Filtros/interceptores de entrada para autenticación, correlación, tenant, canal y otros headers obligatorios.
5. Cadena de llamadas desde el handler hasta caché, repositorio, broker o cliente HTTP.
6. Interfaz del cliente saliente, DTOs, mappers, interceptores y manejo de status/error.
7. Tests del endpoint y del cliente; suelen contener los ejemplos de payload más fieles.
8. Configuración por ambiente: `application*.properties/yaml`, `.env.example`, Helm `values*`, ConfigMaps, manifests, Docker Compose, Terraform y documentación de despliegue.
9. Recursos de datos: `@Table`/`@Entity`/`@Document`, SQL/JPQL, repositories, persistence units y pools; para Redis, `cacheName`, prefijos de clave, `RMap`, mapas, keyspaces y TTL.

Antes de escribir YAML, crea una matriz de contrato por endpoint. Puede vivir en tus notas, pero no omitas ninguna columna:

| Salto | Operación | Parámetros/body enviado | Headers obligatorios | Status/body recibido | Evidencia |
|---|---|---|---|---|---|
| Canal → endpoint | método+ruta | path/query/body | headers de entrada | — | fichero:línea |
| Endpoint → dependencia concreta | método+ruta / clave+mapa / pool+tabla / topic | request | headers salientes | — | fichero:línea |
| Dependencia → endpoint | retorno de la operación | — | headers de respuesta relevantes | status/response | fichero:línea |
| Endpoint → canal | status final | — | headers de respuesta relevantes | response final | fichero:línea |

No avances al diagrama mientras una llamada encontrada en la cadena del handler no tenga su fila de ida y, si es síncrona, su fila de retorno.

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

Cuando la evidencia identifica una tecnología del catálogo (por ejemplo Azure Functions, AKS, API Management, Cosmos DB, Service Bus o Azure SQL), usa `appearance.icon` con la figura Azure correspondiente. Para actores, componentes, interfaces o casos de uso puede usar `uml:*`. El `kind` conserva el significado arquitectónico; la figura solo cambia la presentación.

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

La misma regla aplica al destino. Si un cliente REST/Feign demuestra la operación del otro microservicio, declara esa operación en `provides`, marca el destino `expanded: true` y termina en `destino/operacion`. Resuelve la ruta completa combinando el path base de la interfaz/clase con el path del método. **`servicio/endpoint → otro-servicio` es incompleto cuando el código conoce el endpoint destino.**

No inventes endpoints para infraestructura. Una caché, base, almacenamiento o broker recibe la flecha en su caja, pero la caja y el paso deben identificar el recurso concreto:

- Redis/caché: instancia o conexión, nombre de caché/mapa/keyspace, patrón de clave y TTL si está probado.
- SQL: datasource/pool o persistence unit, base/catalog, esquema, tabla/vista/procedimiento y operación.
- Mongo/documental: conexión/base y colección.
- Broker: cluster/conexión, topic/queue, key y consumer group cuando corresponda.
- Storage: cuenta/bucket/container y ruta/prefijo.

Haz visible lo encontrado en `label` y `tech` sin convertir cada tabla en un falso microservicio. Ejemplos: `label: auth_db.users`, `tech: PostgreSQL · pool auth`; `label: Sesiones`, `tech: Redis · map auth-sessions`. Repite el detalle operativo en `op`, `request` y `response` del paso.

Busca el valor siguiendo la referencia completa: constante → propiedad → placeholder → perfil/manifest/Helm. Si el repositorio solo contiene `${SESSION_MAP}`, conserva `SESSION_MAP` y muestra `map ${SESSION_MAP} · valor externo pendiente`; añade `note` con el fichero que lo referencia. No reemplaces la ausencia con “Redis”, “base de datos” o “API externa” genéricos. Usa un marcador explícito como `[PENDIENTE: valor de SESSION_MAP fuera del repositorio]`.

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

Un inventario de nodos con una sola flecha de ida **no es un scan terminado**. El recorrido síncrono debe comportarse como una pila: cada llamada baja hacia una dependencia y su resultado vuelve al llamador; al final, el endpoint responde al canal. Para `A → B → C`, la secuencia mínima es `A → B`, `B → C`, `C → B`, `B → A`.

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

Cada intercambio síncrono debe explicar el contrato y representar el viaje completo. **Modela siempre la ida y el retorno como pasos distintos** en un diagrama generado por esta skill. No uses `returns` ni un `response` colocado en la flecha de ida como sustituto del retorno visible.

```yaml
- from: canal
  to: auth-service/login
  op: POST /auth/login
  request: |
    {
      "email": "string",
      "password": "[omitido]"
    }
  headers:
    - name: X-Correlation-Id
      required: true
- from: auth-service/login
  to: postgres-auth
  op: Buscar usuario por email
  protocol: sql
  request: 'SELECT users WHERE email=:email'
- from: postgres-auth
  to: auth-service/login
  op: Retorna usuario
  protocol: sql
  response: 'Usuario { id, email, passwordHash, role }'
- from: auth-service/login
  to: canal
  op: 200 AuthResponse
  response: |
    {
      "accessToken": "string",
      "refreshToken": "string",
      "expiresIn": 0,
      "user": { "id": "string", "email": "string", "role": "string" }
    }
```

No termines el flujo en una caché, base de datos o API dependiente: vuelve al endpoint y cierra con la respuesta del endpoint al canal.

- **Entrada al endpoint escaneado:** método y ruta en `op`, parámetros de ruta en `pathParams`, query string en `queryParams`, headers relevantes en `headers` y exclusivamente el body/DTO en `request`. La respuesta final pertenece a otra flecha, desde `servicio/operacion` hacia el canal, con status y DTO en `response`.
- **Caché:** la flecha de ida lleva en `request` la operación y clave exacta o patrón de clave; la flecha de vuelta lleva en `response` el tipo/estructura del valor y cómo se interpreta hit, miss o error. Si escribe, indica qué valor guarda y TTL cuando esté probado.
- **API saliente:** la flecha de ida lleva método, path, headers/params/body; la flecha de vuelta lleva en `response` el status y DTO/campos que consume el llamador.
- **Broker:** topic, key, headers y payload; si es fire-and-forget usa `async: true` y omite una respuesta inexistente.
- **Base de datos:** consulta u operación y parámetros; en `response`, filas/entidad/campos leídos o confirmación de escritura.

Declara los headers en `headers:` como datos estructurados; no los escondas dentro del texto de `request`. Incluye todos los obligatorios demostrados por OpenAPI, anotaciones, filtros o el cliente HTTP, marca `required: true` y sustituye secretos por `[omitido]`. `Content-Type` cuenta cuando el contrato exige un cuerpo JSON. Repite en cada salto solo los headers que realmente se propagan o crean allí; no supongas que todos atraviesan todas las capas. El inspector de tráfico usa esta estructura para destacarlos al estilo Swagger.

Declara los parámetros de URL como datos estructurados. No escribas `customerId=123` dentro de `request` ni lo presentes como request body:

```yaml
pathParams:
  - { name: customerId, value: '123', required: true }
queryParams:
  - { name: includeInactive, value: 'false', required: false }
request: Sin body
```

En cada salto hacia caché, datos o un servicio saliente, escribe `purpose` con la razón concreta de la llamada. En el retorno, escribe `dataUsed` con el subconjunto que el llamador realmente lee. No digas “obtiene el perfil” si el código solo consulta `sex`; haz visible ambas cosas: el DTO recibido en `response` y `dataUsed: [sex]`. Para escrituras, `purpose` debe explicar qué se guarda y para qué se reutilizará.

Usa evidencia del DTO, firma, serializador, mapper, cliente y manejo de respuesta. Puedes resumir estructuras grandes, pero conserva nombres de campos. No inventes valores ni secretos. Si una parte no puede determinarse estáticamente, escribe lo comprobable y añade en `note` qué quedó sin resolver; no fabriques un contrato para llenar el campo.

El cuerpo puede conservar una notación compacta y fiel como `Usuario { id, email, role }` o JSON válido. El inspector lo presenta automáticamente con sangría, saltos de línea y colores tipo Postman; evita convertir una lista de campos en una frase ambigua que ya no pueda formatearse.

En los pasos de ida usa `request`; en los pasos explícitos de retorno usa `response`. No reutilices `request` para una respuesta aunque el payload viaje en la dirección de la flecha: la UI distingue ambos conceptos al seleccionar el paso y en la tarjeta animada.

No dejes `request: ''` ni `response: ''`:

- Si hay body, muestra JSON válido o una estructura tipada con los nombres reales de los campos.
- Si la petición no tiene body, escribe `request: Sin body`; conserva path y query params exclusivamente en `pathParams` y `queryParams`.
- Si la respuesta es `204`, escribe `Sin body (204)` en `response`.
- Si el código no permite conocer la estructura, escribe lo conocido y usa `note: Contrato no resuelto estáticamente; revisar <evidencia>`. No inventes campos.
- Si existen varios status relevantes (`200`, `400`, `401`, `404`, `500`), crea flujos separados al menos para el camino feliz y los errores que cambian el recorrido o el contrato.

#### Patrón obligatorio para caché y API saliente

Para un cache miss seguido de una API business, el orden completo es:

1. canal → endpoint, con request y headers de entrada;
2. endpoint → caché, con operación y clave;
3. caché → endpoint, con `response: miss`;
4. endpoint → API/operación, con método, ruta, params/body y headers salientes;
5. API/operación → endpoint, con status y response consumido;
6. endpoint → caché, si escribe, con clave, valor y TTL probado;
7. caché → endpoint, con confirmación de escritura cuando exista;
8. endpoint → canal, con status, response body y headers finales.

El cache hit es otro flujo: debe volver desde caché al endpoint y desde el endpoint al canal sin fingir una llamada al API business.

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

Antes de ejecutar el validador, aplica esta definición de terminado a **cada flujo**. Si una respuesta es “no”, corrige el YAML o declara la incertidumbre; no entregues todavía.

Considera incompleto —aunque `archiflow validate` no reporte error estructural— cualquier flujo con una sola dirección, cuerpos vacíos por falta de investigación, headers obligatorios omitidos, una dependencia síncrona sin retorno o una respuesta final que no llegue al canal.

- [ ] Empieza en un canal/trigger y entra a `servicio/operacion`.
- [ ] La flecha inicial contiene método+ruta, parámetros/body y headers obligatorios demostrables.
- [ ] Path params y query params viven en `pathParams`/`queryParams`; `request` contiene solo el body o `Sin body`.
- [ ] Cada llamada síncrona tiene una flecha de ida con `request` y otra de vuelta con `response`.
- [ ] Cada caché indica operación+clave y devuelve hit/miss/valor; cada escritura indica valor y TTL si existe evidencia.
- [ ] Cada API saliente indica método+ruta, headers/params/body enviados y status/body recibido.
- [ ] Cada dependencia explica `purpose`; cada retorno no trivial declara los campos realmente consumidos en `dataUsed`.
- [ ] Toda llamada servicio→servicio sale de `origen/operacion` y termina en `destino/operacion` cuando el cliente revela la operación destino.
- [ ] Cada acceso a caché/datos identifica conexión o pool y el recurso concreto: mapa/clave, base/esquema/tabla, colección o procedimiento.
- [ ] Cada publicación asíncrona indica topic, key, headers y payload y usa `async: true`; no se inventa retorno.
- [ ] El último paso vuelve desde el endpoint al canal con status y response body.
- [ ] No existen `request`/`response` vacíos ni respuestas escritas en el campo equivocado.
- [ ] Caché, datos, integración, experiencia y negocio están clasificados por responsabilidad.
- [ ] Las operaciones concretas usan anclas `nodo/operacion`.
- [ ] Toda deducción o contrato no resuelto está señalado con `note` y evidencia para revisión.
- [ ] Todo valor externo no resuelto conserva el nombre de su variable y un marcador `[PENDIENTE: ...]` visible.

```bash
npx archiflow validate <directorio>
npx archiflow validate-scan <fichero.arch.yaml>
npx archiflow serve <directorio> --open
```

`validate-scan` es bloqueante: si falla, corrige el YAML y ejecútalo de nuevo. No sustituyas su resultado con una revisión visual o con la afirmación de que el contrato “se entiende”.

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
