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

### 4. Traducir evidencias a nodos

| Evidencia | Nodo |
|---|---|
| El propio servicio | `kind: service`, con `tech` de `framework` + `frameworkVersion`, y `repo` con la ruta |
| Cada `outbound` | Un nodo `service` (o `external` si es de otro dominio o legado) con el nombre de `targetHint` |
| `datastores` con `kind: sql` | `kind: database`, `tech` de `vendor` |
| `datastores` con `kind: redis` | `kind: cache` |
| `messaging` con broker | Un nodo `kind: broker` (uno solo para todo Kafka, no uno por topic) |
| `endpoints` | No son nodos: van en `provides` del propio servicio |

Si un servicio expone **dos o más endpoints**, añádele `expanded: true`: sus operaciones se dibujan como filas dentro de la caja en vez de quedarse en un subtítulo, que es donde más se nota la diferencia entre el diagrama y el código. Con un solo endpoint no hace falta: ya sale como subtítulo.

Y cuando un paso vaya contra una operación concreta, apunta a ella con `nodo/operacion` (`to: bff-cuentas/listar-cuentas`); requiere que esa operación tenga `id` en `provides`.

Para las zonas, deduce del host: `ms-customer.negocio.svc.cluster.local` dice que vive en `negocio`. Si no hay pistas, usa el layering habitual (`canales` / `experiencia` / `negocio` / `datos`) y dilo explícitamente para que el usuario lo corrija.

### 5. Construir los flujos

Aquí está el valor añadido, y es donde el escáner no puede ayudarte: **las evidencias son un grafo sin orden, y un flujo es una secuencia**.

Para cada endpoint expuesto que valga la pena, lee el código del handler y sigue la cadena de llamadas para determinar **en qué orden** se invocan las dependencias. Un buen flujo empieza en quien llama (o en el propio endpoint si no se sabe) y recorre las dependencias en el orden real de ejecución.

Reglas prácticas:

- Un `@Incoming` / `@KafkaListener` es el **inicio** de su propio flujo, no un paso intermedio.
- Un `@Outgoing` / `@Channel` / `kafkaTemplate.send` es un paso `async: true` al final del flujo que lo dispara.
- Una consulta a caché va **antes** que la llamada que evita, con `condition: cache miss` en la llamada siguiente.
- No inventes latencias. Omite `latencyMs` salvo que el repositorio las documente.

### 6. Validar y mostrar

```bash
npx archiflow validate <directorio>
npx archiflow serve <directorio>
```

### 7. Entregar con honestidad

Al presentar el resultado, di **explícitamente**:

- Qué partes salen de evidencia directa (con el fichero y la línea).
- Qué partes son deducción tuya (zonas, orden de los pasos, nombres de destino sin URL).
- Qué avisos quedaron sin resolver.

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
