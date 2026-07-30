# Handoff — trabajo pendiente en ArchiFlow

Documento para quien continúe el desarrollo (Codex u otro agente). Las **decisiones de diseño ya están tomadas** en [`ADR-003`](docs/01_Arquitectura/ADR-003_Modelo_extendido_paginas_e_interoperabilidad.md): léelo antes de empezar y no reinventes el modelo.

Última actualización: 2026-07-29 · rama `main` · commit `38cc67f`

---

## Antes de tocar nada

```bash
npm install
npm run build
npx archiflow serve ./examples     # http://localhost:4123
```

Comprobaciones que **deben pasar antes de cada commit**:

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

59 tests en verde a día de hoy. Si tu cambio no rompe ninguno, probablemente no lo has cubierto: añade los tuyos.

### Cómo está organizado

| Ruta | Qué hay |
|---|---|
| `src/schema/` | Esquema Zod de `.arch.yaml`, parser con línea/columna, y el compilador al IR |
| `src/layout/` | ELK, reparto de anclajes (`anchors.ts`) y trazador ortogonal (`path.ts`) |
| `src/edit/` | Mutaciones sobre el AST del YAML — **preservan comentarios** |
| `src/export/` | draw.io, SVG, Mermaid, JSON |
| `src/analyzer/` | Recolector de evidencias Quarkus/Spring |
| `src/cli/` | Comandos y servidor local con WebSocket |
| `web/src/` | Renderer React + React Flow |
| `skills/` | Las dos skills; `npm run skills:install` las copia a `~/.claude/skills/` |

### Cinco invariantes que no se negocian

1. **Nunca serialices el YAML desde un objeto JS.** Destruye comentarios y formato. Toda escritura pasa por `src/edit/mutations.ts`, que opera sobre el `Document` de la librería `yaml`. Hay tests que lo vigilan.
2. **Nunca escribas un diagrama inválido en disco.** El servidor valida el resultado *antes* de escribir y responde `422` sin tocar el fichero.
3. **Las aristas se infieren de los pasos de los flujos.** No hay una lista de aristas que mantener. En la UI, "conectar dos nodos" añade un paso.
4. **La geometría es compartida.** `src/layout/` la usan la web y los exportadores, para que un PNG sea el diagrama que se estaba viendo y no una reconstrucción parecida. Si cambias el enrutado, cambia en los dos sitios a la vez.
5. **Lo generado automáticamente es un borrador.** El analizador de código y (en el futuro) el importador aciertan mucho y fallan algo. Dilo en la salida; no lo presentes como verdad.

---

## Tareas pendientes, por prioridad

### P1 — Las flechas siguen pasando por encima de los nodos

**El problema.** `src/layout/path.ts` traza un recorrido ortogonal entre dos anclajes, pero **no conoce los demás nodos**: si hay una caja en medio, la atraviesa. El reparto de anclajes (`anchors.ts`) redujo mucho el apelotonamiento en los extremos, pero no resuelve esto.

**Qué hacer.** Enrutado con esquiva de obstáculos. La vía recomendada:

1. Construir un grafo de visibilidad ortogonal: por cada nodo, generar líneas guía horizontales y verticales a `margen` de sus bordes; los cruces son los vértices.
2. A\* sobre ese grafo, con coste = longitud + penalización por giro (unas 30 unidades) para que salgan recorridos limpios.
3. Los obstáculos son las cajas de nodos, **no** las de zonas: una arista debe poder cruzar una zona, no un servicio.
4. Reserva: si A\* no encuentra camino en un presupuesto de nodos, cae al trazador actual. Mejor una flecha fea que una excepción.

**Dónde.** `src/layout/router.ts` nuevo; `routeEdge()` pasa a aceptar la lista de obstáculos. Cuidado: lo llaman `web/src/edges.tsx` (con posiciones vivas durante el arrastre) y `src/export/svg.ts`. Cachea por firma de posiciones o el arrastre irá a tirones.

**Hecho cuando.** Un test con un nodo justo entre origen y destino produce un recorrido cuyos segmentos no intersectan la caja del obstáculo.

---

### P2 — Deshacer, rehacer y tecla Suprimir

Ver **D3** del ADR-003: instantáneas en el servidor, no mutaciones inversas.

- `src/cli/server.ts`: `Map<fileId, {stack: string[], index: number}>`, anillo de 50. Antes de cada escritura, apila el contenido previo.
- Endpoints `POST /api/undo` y `POST /api/redo` con `{id}`; devuelven la nueva revisión y difunden como cualquier mutación.
- `web/src/`: botones ↶ y ↷ en la barra superior, atajos `Ctrl+Z` / `Ctrl+Y` (y `Cmd` en Mac). Deshabilitados cuando no hay nada que deshacer — hace falta exponer el estado del historial en `DiagramsPayload`.
- `Supr` / `Delete` sobre la selección borra el nodo, la zona o el paso. Con deshacer disponible, **quita el `confirm()`** de `web/src/Inspector.tsx`: dejarlo sería redundante y molesto.

**Ojo.** El atajo no debe dispararse escribiendo en un campo del inspector. `web/src/Timeline.tsx` ya tiene el patrón de comprobar `event.target.tagName`.

---

### P3 — Un microservicio es una caja y sus endpoints son nodos

Ver **D1** del ADR-003. Es el cambio de modelo más grande; hazlo después de P1 y P2.

Orden sugerido:

1. `src/schema/schema.ts`: añadir `expanded: z.boolean().default(false)` al nodo.
2. `src/schema/parse.ts`: aceptar `nodo/operacion` en `from`/`to`, validando que la operación exista en `provides` de ese nodo.
3. `src/schema/compile.ts`: **la arista sigue siendo entre nodos.** Guarda la operación en el paso (`fromOp`, `toOp`) para la etiqueta y el anclaje.
4. `src/layout/index.ts`: si `expanded`, los `provides` entran en ELK como hijos del nodo, con el nodo actuando de contenedor.
5. `web/src/nodes.tsx`: tipo de nodo `endpoint`, compacto (método + ruta).
6. `src/export/svg.ts` y `drawio.ts`: dibujar los hijos.
7. `src/analyzer/`: poner `expanded: true` cuando el servicio tenga dos o más endpoints — es donde más se nota.

**Compatibilidad.** Un diagrama sin `expanded` debe salir exactamente igual que hoy. Hay ejemplos y tests que lo comprueban; que sigan verdes es la señal.

---

### P4 — Interoperabilidad con Archi y draw.io

Ver **D4** del ADR-003, que ya fija la tabla de correspondencia de tipos. **No la cambies sin actualizar el ADR.**

- **Exportar ArchiMate** (`--to archimate`): *Open Exchange File Format* de The Open Group. Archi lo importa nativamente. Empieza por aquí: es lo que desbloquea la adopción.
- **Exportar draw.io con formas ArchiMate**: opción `--archimate`, usando la librería `archimate3` de draw.io (`shape=mxgraph.archimate3.application;archiType=rounded;...`).
- **Importar** (`archiflow import <fichero>`): mxGraph y ArchiMate → `.arch.yaml` borrador. Deduce el tipo por forma, color y texto. **Emite avisos de todo lo que hayas deducido**, no solo de lo que falle.

Si hay que recortar alcance, el importador de ArchiMate es lo primero que cae.

---

### P5 — Páginas

Ver **D2**: una página es un fichero. Falta poco:

- Botón "+ Página" que cree `<nombre>.arch.yaml` en la carpeta vigilada, con un esqueleto mínimo.
- Renombrar y duplicar desde la barra lateral (mutaciones nuevas a nivel de fichero, no de documento: van en el servidor, no en `mutations.ts`).
- El export a draw.io ya genera varias páginas; que incluya todos los ficheros de la carpeta cuando se exporte "todo".

---

### P6 — Request y response de ejemplo

Ver **D5**. Campos `request` y `response` en el paso, texto libre.

- Esquema, inspector con `<textarea>` monoespaciado, y un panel plegable en el lienzo al seleccionar el paso.
- Un botón "formatear JSON" que aplique `JSON.stringify(JSON.parse(x), null, 2)` **y no haga nada si no parsea**. En diseño el ejemplo suele estar a medias y no se le puede exigir que sea válido.

---

### P7 — Animación

La referencia que pidió el usuario es [Fluyo](https://fluyo-app.vercel.app): puntos recorriendo las conexiones, velocidad 1×–4×, dirección normal / inversa / alterna, color de los puntos y estilo de línea configurables.

Lo que hay: `web/src/playback.ts` (reloj fuera de React, a 60 fps, imperativo) y `web/src/packets.tsx` (los paquetes). La base es sólida; falta añadir:

- Varios paquetes en vuelo por arista, con separación configurable.
- Estela tipo cometa (varios puntos con opacidad decreciente).
- Modo "flujo continuo": los puntos recorren todas las aristas del flujo sin parar, en vez de un paso cada vez.
- Dirección inversa y alterna.
- Ajustes por diagrama, en el YAML bajo una clave `animation:`.

**No toques la arquitectura del reloj.** Está fuera de React a propósito: mover el tiempo por estado de React a 60 fps hace inservible cualquier diagrama de tamaño real. Está explicado en el comentario de cabecera de `playback.ts`.

---

### P8 — GIF animado y PDF

El GIF es lo que permite pegar el recorrido en un Confluence o un Teams, que es donde acaba viviendo la documentación del banco.

**Por qué no está hecho:** necesita cuantización de color propia. El tema oscuro con degradados se destroza en los 256 colores del GIF, y hacerlo mal se ve peor que no hacerlo.

**Plan.** Tenemos a favor que la animación es determinista: `IrFlow.steps` da la posición de cada paquete en cualquier instante `t`.

1. Generar N fotogramas llamando a `toSvg()` con el tiempo congelado (hace falta parametrizar la posición de los paquetes; hoy el SVG es estático).
2. Rasterizar cada uno con canvas, como ya hace `web/src/ExportMenu.tsx`.
3. **Paleta fija en vez de cuantización general.** Los colores los controlamos nosotros: fondo, texto, y los de `src/theme.ts`. Una paleta construida a mano de ~64 entradas más una rampa de grises evita el bandeo y ahorra escribir un algoritmo de corte mediano.
4. Codificador LZW y ensamblado del GIF89a con bloque de control gráfico y bucle de NETSCAPE2.0.
5. Controles: FPS (15–25) y escala, como Fluyo.

**PDF**: más simple. Rasterizar a JPEG y envolverlo en un PDF de una página con un `XObject` `DCTDecode`. Son unas 80 líneas y no necesita dependencias.

---

## Cosas que ya se intentaron y no funcionaron

Para que no se repitan:

- **`sirv` con `dev: false`** cachea el listado de ficheros al arrancar: reconstruir la web con el servidor levantado devuelve 404. Va con `dev: true`.
- **Banner de shebang en `tsup`** cuando el fuente ya lo tiene: salen dos y Node no arranca el binario.
- **Nodos de React Flow sin `width`/`height` explícitos**: nacen con `visibility: hidden` esperando al `ResizeObserver`, y hasta que no se miden **no se dibuja ninguna arista**. ELK ya nos da las dimensiones; pásalas.
- **Etiquetas HTML sin escapar en atributos de mxGraph**: draw.io rechaza el fichero entero con *"Unescaped '<' not allowed in attributes values"*. Va escapado; `html=1` hace que mxGraph lo interprete al pintar.
- **Difundir por WebSocket en cada escritura**: provoca un recálculo de layout y un salto visual justo mientras arrastras. El servidor deduplica comparando revisiones.

## Limitación del entorno de verificación

La animación y el arrastre **no se han podido verificar visualmente**: el panel de navegador del entorno de desarrollo no compone fotogramas, y ni `requestAnimationFrame` ni `ResizeObserver` se disparan ahí. Todo lo visual está verificado por datos, por tests y por inspección del DOM, pero **alguien tiene que mirarlo con ojos**. Si trabajas con un navegador real, empieza por ahí.
