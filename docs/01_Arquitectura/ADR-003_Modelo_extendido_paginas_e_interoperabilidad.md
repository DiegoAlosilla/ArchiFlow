---
title: "ADR-003: Modelo extendido, páginas e interoperabilidad con Archi y draw.io"
tags: [adr, arquitectura, archiflow, interoperabilidad]
status: accepted
date: 2026-07-29
deciders: [Tech Lead]
---

# ADR-003: Modelo extendido, páginas e interoperabilidad con Archi y draw.io

## Estado

`accepted` — implementado, salvo el importador de D4. Ver [[HANDOFF]].

Este ADR existía para que quien continuara el trabajo **no tuviera que inventarse el diseño**. Cómo quedó cada decisión:

| Decisión | Estado |
|---|---|
| D1 · Endpoints dentro del servicio | Hecha, con una desviación anotada abajo |
| D2 · Una página es un fichero | La parte que ya existía sigue igual; falta crear y renombrar desde la web |
| D3 · Deshacer por instantáneas | Hecha |
| D4 · ArchiMate como formato de intercambio | Exportación hecha (con vista); **el importador no está** |
| D5 · Request y response en el paso | Hecha |

**Desviación en D1.** Los endpoints no entran en ELK como hijos del nodo: el nodo crece y sus operaciones se dibujan como filas dentro de la caja. El resultado en pantalla es el que describe la decisión y la regla de resolución se mantiene intacta —`bff-cuentas/listar-cuentas` sigue resolviendo al nodo—, pero **el anidamiento se queda en dos niveles** (zona → servicio) en vez de tres. Con ello el trade-off de "tres niveles complican el layout y el enrutado" que se asume más abajo no se ha llegado a pagar.

## Contexto

Tras la primera ronda de uso real aparecieron requisitos que el modelo actual no cubre, todos con el mismo origen: ArchiFlow se va a usar en el día a día de un equipo de banca que ya tiene herramientas y convenciones.

1. **Un microservicio no es una caja atómica.** Expone endpoints, y el diagrama que el equipo dibuja hoy los muestra: la caja es el servicio y dentro van sus operaciones. El modelo actual mete los endpoints en `provides`, pero solo pinta el primero como subtítulo.
2. **Hacen falta páginas.** Un dominio no cabe en un diagrama.
3. **El banco usa Archi y draw.io con ArchiMate.** Si ArchiFlow no habla con esas herramientas, no entra: nadie va a mantener dos fuentes.
4. **Falta deshacer.** Sin `Ctrl+Z` un editor gráfico da miedo, y con razón: cada edición escribe en disco.
5. **Los contratos importan.** El flujo es contract-first; poder colgar un request y un response de ejemplo en un paso acerca el diagrama al contrato.

## Decisiones

### D1. Los endpoints son nodos hijos del servicio, no un campo aparte

Un nodo puede declararse **expandido**, y entonces sus `provides` se dibujan como nodos hijos dentro de la caja del servicio, igual que hoy los nodos viven dentro de una zona.

```yaml
nodes:
  - id: bff-cuentas
    kind: service
    expanded: true          # dibuja los endpoints dentro de la caja
    provides:
      - id: listar-cuentas
        method: GET
        path: /v1/cuentas
```

Y un paso puede apuntar al endpoint concreto:

```yaml
steps:
  - from: apigw
    to: bff-cuentas/listar-cuentas    # nodo/operación
```

**Por qué así y no con un tipo de nodo nuevo:** `provides` ya existe, ya lo rellena el analizador de código a partir de `@Path` y `@GetMapping`, y ya es la materia prima para generar el contrato OpenAPI. Convertirlo en nodos dibujables es un cambio de presentación sobre datos que ya tenemos, no un modelo nuevo que mantener en paralelo.

**Regla de resolución:** `bff-cuentas/listar-cuentas` **siempre resuelve al nodo** `bff-cuentas` para la topología. La parte de operación solo afecta al anclaje de la arista y a la etiqueta. Así, un diagrama con endpoints y otro sin ellos se comportan igual y nada de lo ya construido se rompe.

**Consecuencia asumida:** las zonas pasan a anidar en tres niveles (zona → servicio → endpoint). ELK lo soporta con `hierarchyHandling: INCLUDE_CHILDREN`, que ya usamos.

### D2. Una página es un fichero

`archiflow serve` ya vigila una carpeta y lista todos los `.arch.yaml` en la barra lateral: eso **ya son páginas**. Lo que falta es el botón para crear una y renombrarla.

**Descartado: páginas dentro de un mismo fichero.** Sería lo que hace draw.io, pero rompe la propiedad que da valor al formato: un diagrama por fichero es un diff pequeño y revisable, vive junto al microservicio que describe y se puede exigir en un PR. Un fichero con ocho páginas vuelve a ser un artefacto monolítico que nadie revisa.

Al exportar a draw.io, cada página de ArchiFlow es una página del `.drawio`, con lo que la equivalencia se mantiene de cara al banco.

### D3. Deshacer por instantáneas en el servidor, no por mutaciones inversas

El servidor guarda un historial en memoria del contenido de cada fichero (anillo de 50 entradas). `Ctrl+Z` restaura la anterior; `Ctrl+Y` rehace.

**Por qué no mutaciones inversas:** calcular la inversa de cada operación es código nuevo por cada operación, y `node.remove` —que arrastra los pasos que usaban el nodo— tendría una inversa complicada y fácil de equivocar. Una instantánea de un fichero de kilobytes es barata y siempre correcta.

**Limitación asumida y que hay que comunicar:** el historial es de la sesión del servidor y solo cubre las escrituras hechas desde la web. Si editas el YAML a mano, esa versión entra en el historial como estado nuevo, no como paso deshacible. El respaldo real sigue siendo git.

### D4. ArchiMate es formato de intercambio, no el modelo interno

- **Exportar** a *ArchiMate Model Exchange File Format* (`.xml` de The Open Group), que Archi importa nativamente. Y una variante del export a draw.io que use la librería de formas `archimate3` en vez de rectángulos.
- **Importar** desde draw.io (mxGraph) y desde ArchiMate Open Exchange, produciendo un `.arch.yaml` **borrador**.

**Correspondencia de tipos** (fijada aquí para que sea la misma en importación y exportación):

| ArchiFlow | ArchiMate |
|---|---|
| `service` | ApplicationComponent |
| `frontend`, `client` | ApplicationComponent con estereotipo, o Actor si es persona |
| `gateway` | ApplicationService |
| `database`, `storage` | DataObject sobre un Node tecnológico |
| `cache` | SystemSoftware |
| `broker` | TechnologyService |
| `external` | ApplicationComponent marcado fuera del perímetro |
| Paso de flujo | Serving o Triggering, según sea síncrono o asíncrono |
| Zona | Grouping |

De `database` y `storage` se emite el DataObject; el Node tecnológico que lo aloja es una decisión de la vista y la exportación no lo modela. La pertenencia a una zona viaja además como Composition del Grouping a sus miembros, para que en Archi el grupo no quede como una caja decorativa sin relación con nada.

**El importador produce borradores, igual que el analizador de código.** Un `.drawio` tiene geometría y estilos, no semántica: qué es un servicio y qué una base de datos hay que deducirlo de la forma, del color y del texto. Se acertará mucho y se fallará algo, y hay que decirlo en la salida en vez de fingir precisión. Es la misma postura que ya sostiene el ADR-001 para el escaneo de código.

### D5. Request y response de ejemplo van en el paso

```yaml
steps:
  - from: apigw
    to: bff-cuentas/listar-cuentas
    op: GET /v1/cuentas
    request: |
      { "clienteId": "0012345" }
    response: |
      { "cuentas": [ { "numero": "194-...", "saldo": 1520.40 } ] }
```

Texto libre, no JSON validado: en la fase de diseño el ejemplo suele estar a medias, y un validador estricto obligaría a inventar datos para que el fichero compile. Se muestran en el inspector y en un panel del lienzo al seleccionar el paso, con resaltado y plegado.

## Consecuencias

### Positivas

- El diagrama se parece a lo que el equipo ya dibuja a mano, lo que baja la barrera de adopción.
- Con endpoints como nodos, un flujo puede señalar la operación exacta, que es justo lo que hoy se pierde entre las flechas.
- Hablar ArchiMate abre la puerta a que ArchiFlow sea la herramienta de autoría y Archi la de gobierno, en vez de competir con ella.
- Request y response en el paso acercan el diagrama al contrato OpenAPI, que es el siguiente eslabón del ciclo.

### Negativas / Trade-offs

- **Tres niveles de anidamiento complican el layout y el enrutado.** Una arista que va de un endpoint a otro cruza dos fronteras de contenedor; el enrutado con esquiva de obstáculos (ver [[HANDOFF]]) se vuelve más necesario, no menos.
- **El importador va a equivocarse.** Es inherente a reconstruir semántica desde geometría, y hay que presentarlo como borrador o quemará la confianza.
- **El historial de deshacer es volátil**: se pierde al reiniciar el servidor.
- **Más superficie que mantener**: dos formatos de importación y cuatro de exportación es mucho para un proyecto de una persona. Si hay que recortar, el importador de ArchiMate es lo primero que cae: exportar es lo que desbloquea la adopción, importar solo ahorra una migración inicial.

## Notas Relacionadas

- [[ADR-001_Modelo_y_arquitectura_de_ArchiFlow]]
- [[ADR-002_Edicion_bidireccional_por_mutaciones]]
- [[HANDOFF]]
