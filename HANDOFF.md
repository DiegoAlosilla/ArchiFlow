# Handoff — trabajo pendiente en ArchiFlow

Documento para quien continúe el desarrollo (Codex u otro agente). Las **decisiones de diseño ya están tomadas** en [`ADR-003`](docs/01_Arquitectura/ADR-003_Modelo_extendido_paginas_e_interoperabilidad.md): léelo antes de empezar y no reinventes el modelo.

Última actualización: 2026-07-30 · rama `main` · P1 a P4 hechas, P5 a P8 pendientes

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

72 tests en verde a día de hoy. Si tu cambio no rompe ninguno, probablemente no lo has cubierto: añade los tuyos.

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

## Lo que ya está hecho (P1 a P4)

No hace falta releer el código para saber por dónde va: esto es el resumen, y cada punto tiene tests.

### P1 — Enrutado con esquiva de obstáculos ✔

`src/layout/router.ts`: grafo de visibilidad ortogonal (guías a 16 unidades de cada caja, los cruces son los vértices) y A\* con penalización de 30 por giro. Cachea por firma de posiciones y **cae al trazador de siempre** si no encuentra camino en 4 000 nodos: mejor una flecha fea que una excepción.

Los obstáculos son cajas de nodos, nunca de zonas. `routeEdge()` recibe la lista y sin obstáculos conserva el trazado histórico intacto. Lo llaman `web/src/edges.tsx` —con las posiciones vivas del arrastre— y `src/export/svg.ts`; los dos pasan el mismo conjunto, y eso hay que mantenerlo (invariante 4).

### P2 — Deshacer, rehacer y Suprimir ✔

Instantáneas en el servidor (D3 del ADR-003), anillo de 50 por fichero, en `src/cli/server.ts`. `POST /api/undo` y `/api/redo`; el estado viaja en `DiagramsPayload.history` para poder deshabilitar los botones. `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` y `Supr`, sin dispararse dentro de un campo del inspector. Los `confirm()` de borrado se han quitado: con deshacer eran ruido.

### P3 — Endpoints dentro de la caja del servicio ✔

`expanded: true` en el nodo dibuja sus `provides` como filas dentro de la caja, y un paso puede apuntar a la operación con `nodo/operacion`. **La arista sigue siendo entre nodos**: la operación solo afina etiqueta y anclaje (`fromOp` / `toOp` en el paso), así que un diagrama sin `expanded` sale exactamente igual que antes.

Se resolvió sin meter los endpoints en ELK: el nodo crece (`NODE_HEADER` + una fila por operación) y las filas se dibujan dentro. Un nivel menos de anidamiento que lo que planteaba el ADR, mismo resultado en pantalla. Los tres sitios que las pintan —`web/src/nodes.tsx`, `src/export/svg.ts` y `src/export/drawio.ts`— comparten `NODE_HEADER` y `ENDPOINT_ROW` de `src/layout/index.ts`; el CSS los repite a mano y lo dice en un comentario.

### P4 — Exportación a Archi y a draw.io con formas ArchiMate ✔

`--to archimate` produce *Open Exchange File Format* con elementos, relaciones **y una vista con geometría**: sin la vista Archi importa el árbol del modelo pero no dibuja nada, y quien lo recibe tiene que recomponer el diagrama a mano.

`--archimate` en la exportación a draw.io usa la librería `archimate3`, con la forma que toca para cada tipo según la tabla del ADR-003.

**Cómo comprobar que el ArchiMate sigue siendo válido** si lo tocas — el XSD es implacable y Archi rechaza el fichero completo por un atributo:

```powershell
Invoke-WebRequest https://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd -OutFile archimate3_Diagram.xsd
Invoke-WebRequest https://www.opengroup.org/xsd/archimate/3.1/archimate3_View.xsd  -OutFile archimate3_View.xsd
Invoke-WebRequest https://www.opengroup.org/xsd/archimate/3.1/archimate3_Model.xsd -OutFile archimate3_Model.xsd
```

Y validar con `System.Xml.Schema.XmlSchemaSet` apuntando a `archimate3_Diagram.xsd` (namespace `.../3.0/`, que el 3.1 conserva). Los tests cubren lo que se puede sin descargar nada: tipos, orden de hijos, referencias resueltas y coordenadas no negativas.

### P6 — Request y response de ejemplo ✔

Campos `request` y `response` en el paso (D5), texto libre. Van en el inspector como `<textarea>` monoespaciado y en un panel plegable del lienzo al seleccionar el paso. El botón "Formatear JSON" reindenta si parsea y **no hace nada si no** — en diseño el ejemplo suele estar a medias y no se le puede exigir que compile.

### P4b — Importador de draw.io y ArchiMate ✔

`archiflow import <fichero>` en `src/import/`. Lo que hay que saber:

- **draw.io guarda el modelo comprimido** (base64 de un deflate crudo, además URL-encoded). Sin `inflateRaw` no hay nada que leer, y es la trampa en la que cae quien intenta pasarle el fichero a un modelo tal cual.
- El XML se lee con un lector propio de 90 líneas (`src/import/xml.ts`) en vez de una dependencia. **No es un parser conforme**: si algún día hace falta más, cámbialo por uno de verdad en vez de estirarlo.
- Salen **evidencias**, no un diagrama: cada caja viaja con su estilo crudo, el tipo deducido, la confianza y el motivo. `--evidence` las vuelca en JSON para la skill `/archiflow-import`, que es quien decide tipos, zonas y orden con criterio.
- El borrador se escribe con `yaml.Document` desde un objeto, que es lo que la invariante 1 prohíbe — y aquí se puede porque el fichero **no existe todavía**: no hay comentarios que destruir. En cuanto existe, manda `src/edit`.
- El orden de los pasos sale de la numeración de las flechas si la hay (`1.1`, `2.`); si no, de la posición, **y se avisa de que es una conjetura**.

---

## Tareas pendientes, por prioridad

### P5 — Páginas

Ver **D2**: una página es un fichero. Falta poco:

- Botón "+ Página" que cree `<nombre>.arch.yaml` en la carpeta vigilada, con un esqueleto mínimo.
- Renombrar y duplicar desde la barra lateral (mutaciones nuevas a nivel de fichero, no de documento: van en el servidor, no en `mutations.ts`).
- El export a draw.io ya genera varias páginas; que incluya todos los ficheros de la carpeta cuando se exporte "todo".

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
- **`xsi:type="ServingRelationship"` en el ArchiMate exportado**: ese es el formato **nativo** de Archi. El de intercambio quiere `Serving`, y con el sufijo el XSD tumba el fichero entero.
- **Volcar las coordenadas del lienzo tal cual en la vista de ArchiMate**: son `nonNegativeInteger`, y arrastrar una zona hacia arriba deja posiciones negativas legítimas aquí que allí invalidan el fichero. Se traslada el nivel superior; recortar caja a caja perdería la posición relativa entre zonas.
- **Ids de ArchiFlow como `identifier` de ArchiMate**: es un `xsd:ID`, así que no admite dígito inicial ni `/`, y los ids de arista son `origen__destino`. Van con prefijo y saneados.

## Limitación del entorno de verificación

La animación y el arrastre **no se han podido verificar visualmente**: el panel de navegador del entorno de desarrollo no compone fotogramas, y ni `requestAnimationFrame` ni `ResizeObserver` se disparan ahí. Todo lo visual está verificado por datos, por tests y por inspección del DOM, pero **alguien tiene que mirarlo con ojos**. Si trabajas con un navegador real, empieza por ahí.

Lo mismo aplica a la interoperabilidad: el ArchiMate exportado **valida contra el XSD oficial**, y el draw.io con formas ArchiMate usa los estilos de la librería real, pero **nadie los ha abierto todavía en Archi ni en draw.io**. Es lo primero que conviene probar antes de enseñárselo al banco.
