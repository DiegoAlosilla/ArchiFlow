---
name: archiflow-import
description: Convierte y audita un diagrama existente de draw.io (.drawio / .xml de mxGraph) o ArchiMate en ArchiFlow, preservando geometría, figuras y conectores; propone correcciones para flechas sueltas y puede producir un inventario Excel de servicios y endpoints. Úsala al importar, comparar original contra importado, corregir diferencias o revisar conexiones.
---

# ArchiFlow: importar un diagrama existente

Convierte un `.drawio` o un ArchiMate Open Exchange en un `.arch.yaml` animado.

## El principio que rige esta skill

**El importador demuestra, tú interpretas.**

`archiflow import` extrae lo que el fichero contiene de verdad: cajas, geometría, estilos portables, etiquetas, anclas, puntos intermedios y flechas. El resultado usa `layoutMode: faithful` para conservar la composición. Lo que **no** contiene, y por tanto nadie puede extraer mecánicamente, es lo que más importa en ArchiFlow:

1. **Qué es cada caja.** Un rectángulo azul con "ms-saldos" dentro es un microservicio para ti y una figura geométrica para el fichero. El importador propone un tipo por forma y por texto, y **dice de dónde lo saca**; tú lo confirmas o lo corriges.
2. **En qué orden ocurren los pasos.** Un diagrama dibujado es un grafo; un flujo de ArchiFlow es una secuencia. Si quien lo dibujó numeró las flechas (`1.1`, `2.`, …), el orden está ahí. Si no, hay que deducirlo leyendo el diagrama, y es la parte donde más se equivoca un algoritmo y menos un lector.

Y hay un límite que **debes comunicar siempre**: reconstruir semántica a partir de geometría se acierta mucho y se falla algo. El resultado es **un borrador**, igual que el del escaneo de código. Presentarlo como una traducción exacta destruye la confianza a la primera caja mal tipada.

## Procedimiento

### 1. Sacar las evidencias

```bash
npx archiflow import <fichero> --evidence -o evidencias.json
```

No leas el `.drawio` a pelo: draw.io guarda el modelo **comprimido** (base64 de un deflate crudo, además URL-encoded), así que lo que verías es una línea ilegible. El comando lo descomprime por ti. Salida:

```jsonc
{
  "format": "drawio",
  "pages":  [ { "id", "name", "shapes": [...] } ],
  "shapes": [ { "id", "label", "style", "drawioIcon", "x", "y", "width", "height",
                "parent", "container", "kind", "confidence", "reason", "external" } ],
  "links":  [ { "id", "label", "source", "target", "style", "protocol", "async", "order" } ],
  "warnings": [ ... ]
}
```

- `style` es el estilo crudo de mxGraph. Es **la prueba**: si `kind` no te cuadra, mira ahí antes de cambiarlo.
- `drawioIcon`, cuando existe, conserva el nombre de la librería (Azure, Kubernetes, etc.). ArchiFlow lo traduce a un tipo y tecnología local; no necesita cargar SVGs propietarios para entenderlo.
- `confidence` es `alta` (la forma lo dice), `media` (lo dice el texto) o `baja` (no lo dice nadie y se asumió `service`).
- `container: true` es un carril, un grupo o una caja que envuelve a otras: candidato a zona.
- `order` es la numeración que traía la flecha en su etiqueta, si traía.
- `sourceInferred` o `targetInferred` indica que Draw.io dejó ese extremo suelto y ArquiFlow propuso la caja más cercana. No presentarlo como conexión confirmada.

### 2. Leer los avisos antes que nada

Como en el escaneo, `warnings` es la parte más informativa. Ahí verás lo que se descartó —capturas de pantalla, maquetas, rótulos sueltos— y las flechas que se cayeron con ellos. Si el usuario esperaba ver esas pantallas en el diagrama, **díselo**: ArchiFlow modela topología y recorridos, no maquetas de interfaz.

### 3. Auditar fidelidad visual antes de interpretar

Abrir el borrador con `archiflow serve` y comparar contra Draw.io:

- mismo número total de figuras visibles y conectores;
- mismas coordenadas, tamaños, rellenos, líneas y texto;
- ninguna arista con origen o destino inexistente;
- cajas conectadas conservadas como nodos aunque por tamaño parezcan contenedores;
- grupos grandes no conectados conservados como zonas.
- separar elementos semánticos de decoración propia de la figura: las pestañas de `shape=module` se reproducen como silueta, no como nodos; `edgeLabel` pertenece al conector.

Comparar también los límites geométricos y el multiconjunto de cajas `(x, y, width, height)`. Una captura a distinto zoom puede parecer movida aunque las coordenadas coincidan.

La fidelidad visual no confirma la semántica. Es sólo la primera pasada.

### 4. Decidir los tipos y endpoints

Repasa toda forma con `confidence` distinta de `alta`. Pistas que el importador no usa y tú sí:

- **El nombre del sistema en el banco.** `ms-`, `bff-`, `api-` son convenciones del equipo, no del dibujo.
- **Con qué se conecta.** Lo que solo recibe flechas de servicios y no sale a ningún sitio suele ser un almacén. Lo que recibe de todos y llama a todos suele ser un gateway o un broker.
- **El color.** En un diagrama hecho por un equipo, el color casi siempre codifica algo (capa, criticidad, propiedad). Pregúntalo si no es evidente: acierta más que cualquier heurística.

Antes de construir flujos, crear un inventario de microservicios y endpoints. Para detalle, usar `$archiflow-endpoints`. No contar pantallas `MiniApp` como microservicios y agrupar apariciones repetidas del mismo servicio.

Cuando se solicite resumen Excel, usar `$archiflow-tech-lead` y su contrato `references/xml-excel-contract.md`. Entregar como mínimo `Resumen`, `Flujos`, `Componentes por flujo`, `Dependencias por flujo`, `Endpoints` y `Auditoría XML`; incluir flujo, capa, método, ruta conservada, propósito, consumidor/endpoint consumido, Redis con todos sus mapas, base de datos, evidencia, confianza y estado de revisión. Contrastar después con OpenAPI o código.

### 5. Decidir las zonas

Cada `container` es una zona candidata. Si el diagrama no tiene carriles, agrupa por capa mirando las posiciones: los diagramas de banca se leen de arriba abajo (`canales` → `experiencia` → `negocio` → `datos`) o de izquierda a derecha. **Di explícitamente que las zonas las has agrupado tú** para que el usuario las corrija.

### 6. Reconstruir el orden de los pasos — la parte que importa

Por prioridad:

1. **Numeración en las etiquetas.** Si la hay, es la respuesta y no hay que darle más vueltas.
2. **Un solo camino.** Si el grafo es una cadena, el orden es el recorrido desde la entrada.
3. **Lectura del dibujo.** De arriba abajo y de izquierda a derecha, empezando por quien no recibe ninguna flecha.
4. **Preguntar.** Si hay ramas —caché y fallo de caché, síncrono y evento— **haz un flujo por rama** en vez de forzar una secuencia única, que es justo lo que ArchiFlow hace mejor que draw.io.

Un diagrama grande casi nunca es un solo flujo. Si no hay numeración, dejar las relaciones en `edges` y crear flujos nombrados después de interpretarlos. No convertir todas las flechas en un único “Recorrido importado”. Usar `$archiflow-sequence` para separar escenarios.

### 7. Escribir y validar

Escribe el `.arch.yaml` con lo que hayas decidido —no te limites a mover el borrador— y valídalo:

```bash
npx archiflow validate <directorio>
npx archiflow serve <directorio>
```

Si quieres partir del borrador en vez de escribirlo entero:

```bash
npx archiflow import <fichero> -o mi-diagrama.arch.yaml
```

Sale con una cabecera de comentarios que enumera todo lo deducido. **Bórrala cuando hayas revisado el contenido**: dejarla puesta hace que el aviso pierda su sentido.

En una importación `layoutMode: faithful`, no convertir en alertas cada caja que no participa en un flujo: rótulos, actividades y contenedores visuales pueden estar sueltos legítimamente. Mostrar como validación accionable sólo problemas estructurales y extremos inferidos. Al pulsar una alerta, encuadrar ambos extremos y permitir:

1. aceptar la propuesta geométrica;
2. elegir manualmente `Desde` o `Hasta`;
3. conservar la alerta si la intención sigue incierta.

### 8. Entregar con honestidad

Al presentar el resultado di explícitamente:

- Qué salió del fichero tal cual (cajas, flechas, carriles).
- Qué has deducido tú (tipos, zonas, y sobre todo **el orden de los pasos**).
- Qué se descartó y por qué (imágenes, rótulos, flechas sueltas).
- Qué falta y solo el usuario sabe: latencias, condiciones de cada rama, y qué operación concreta viaja en cada flecha.

## Límites de fidelidad

Ni lo intentes, y dilo si el usuario lo espera:

- **Capturas y maquetas**: no hay equivalente en el modelo. Los iconos de infraestructura de draw.io sí se interpretan como evidencia, no se descartan.
- **Imágenes y fuentes propietarias**: se sustituyen por iconos locales o una fuente del sistema.
- **Estilos no portables de mxGraph**: se conserva el estilo crudo en la arista y se aproximan sombras, puntas propietarias y efectos especiales.
- **Modo automático**: sólo recoloca cuando el usuario cambia `layoutMode` a `auto`; una importación Draw.io entra en `faithful`.
- **Del ArchiMate, el orden de los pasos**: el formato no lo guarda. Todo lo demás (tipos, zonas por Grouping, síncrono contra asíncrono) sí llega bien, porque ahí el fichero sí trae semántica.
