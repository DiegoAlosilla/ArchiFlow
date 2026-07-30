---
title: "ADR-002: Edición bidireccional por mutaciones sobre el AST"
tags: [adr, arquitectura, archiflow, edicion]
status: accepted
date: 2026-07-29
deciders: [Tech Lead]
---

# ADR-002: Edición bidireccional por mutaciones sobre el AST

## Estado

`accepted` — amplía el alcance declarado en [[ADR-001_Modelo_y_arquitectura_de_ArchiFlow]]

## Contexto

El ADR-001 dejó la edición gráfica bidireccional explícitamente fuera de alcance: la web era un renderizador de solo lectura y el único editor era el fichero YAML.

Ese recorte resultó ser demasiado agresivo en cuanto se probó el flujo real de trabajo. El caso de uso central es **el agente genera el diagrama y el humano lo revisa**, y en esa revisión casi siempre hay tres o cuatro retoques: una caja mal colocada por el auto-layout, un `tech` desactualizado, un paso que va en el orden equivocado. Obligar a abrir el YAML para eso rompe el flujo justo en el momento de mayor valor.

El problema técnico que hay que resolver antes de permitir escribir desde la web es la **preservación del fichero**. La implementación evidente —tomar el objeto en memoria y serializarlo a YAML— destruye comentarios, orden de claves, líneas en blanco y estilos de bloque. En un diagrama de arquitectura los comentarios son la mitad del valor (`# Es el cuello de botella del flujo`), así que un editor que los borre es inservible: el usuario editaría una vez, perdería su documentación y no volvería a usarlo.

El segundo problema es la **concurrencia**. El fichero puede estar abierto simultáneamente en la web, en el editor de texto y en manos de un agente. Cualquiera de los tres puede escribir.

## Opciones evaluadas

### Opción 1: La web envía el documento completo

**Pros:**
- Trivial de implementar: `PUT /api/diagram` con el YAML entero.
- El cliente puede editar libremente sin un vocabulario de operaciones.

**Contras:**
- El cliente tendría que construir el YAML, y para eso necesita el documento original con sus comentarios. Acaba siendo un editor de texto disfrazado.
- Cualquier escritura pisa entera la versión en disco: la última en llegar gana, sin posibilidad de detectar el conflicto.
- Un cliente con un error de serialización puede corromper el fichero completo en vez de fallar en un campo.

### Opción 2: Round-trip por objeto JS (parse → mutar → stringify)

**Pros:**
- Muy poco código: `yaml.parse`, mutar el objeto, `yaml.stringify`.
- El servidor controla la escritura.

**Contras:**
- **Destruye todos los comentarios**, que es motivo suficiente para descartarla.
- Reordena y reformatea el fichero entero, así que cada edición produce un diff gigante e irrevisable en un PR.
- Pierde el estilo de bloque de las descripciones largas.

### Opción 3: Mutaciones semánticas aplicadas sobre el AST

La web envía intenciones (`{op:'node.update', id, patch}`), el servidor las aplica sobre el `Document` de la librería `yaml` y escribe.

**Pros:**
- Conserva comentarios, orden, indentación y estilos: solo cambia lo que se toca.
- El diff de una edición es del tamaño de la edición.
- El vocabulario de operaciones es un punto de control natural: se puede validar, rechazar y registrar cada intención.
- Las cascadas se resuelven en un sitio: renombrar un nodo actualiza los pasos que lo referencian.
- Permite lotes atómicos.

**Contras:**
- Hay que definir y mantener un vocabulario de operaciones; añadir un campo nuevo puede exigir una operación nueva.
- Más código que las otras dos opciones.
- El cliente no puede hacer nada que no esté en el vocabulario.

## Decisión

**Elegimos: Opción 3 — mutaciones semánticas sobre el AST**, con control de concurrencia por revisión.

La preservación de comentarios no es negociable, y solo la opción 3 la garantiza. El coste extra de mantener un vocabulario de operaciones se paga solo con la primera cascada de renombrado que no hay que depurar a mano.

Sobre esa base, tres reglas que el flujo de escritura no puede saltarse:

1. **Comprobar la revisión.** Cada mutación viaja con la huella del contenido sobre el que se calculó. Si el fichero cambió por otra vía, se responde `409` y se pide recargar en vez de pisar. La web encadena la revisión desde la respuesta del servidor, no desde la difusión por WebSocket, para que varias ediciones seguidas no provoquen falsos conflictos.
2. **Validar antes de escribir.** El resultado se parsea y valida completo; si quedaría inválido se responde `422` con la línea exacta y **no se toca el disco**. Nunca debe existir en disco un diagrama que el propio validador rechace.
3. **Atomicidad por lote.** Si una mutación del lote falla, no se aplica ninguna.

Dos decisiones de modelado acompañan a la elección:

**A. Las posiciones fijadas van en `layout: { x, y }`, no en `x`/`y` sueltos.** Es presentación dentro de un fichero por lo demás semántico, y separarla en su propia clave deja claro que se puede borrar sin perder arquitectura. Se escribe en estilo de flujo para que ocupe una línea: en bloque serían tres por nodo y, con medio diagrama fijado, los metadatos de presentación harían ilegible el fichero.

**B. En el lienzo no se dibujan aristas: se añaden pasos.** Como las aristas se infieren de los flujos (ADR-001, decisión B), ofrecer un gesto de "dibujar flecha" mentiría sobre el modelo. Arrastrar de un nodo a otro crea un paso en el flujo activo, y la arista aparece como consecuencia.

## Consecuencias

### Positivas

- Se puede revisar y corregir un diagrama generado por un agente sin salir de la web, que es el flujo de trabajo principal.
- El fichero sigue siendo la fuente de verdad y sigue siendo revisable en un PR: un retoque desde la web produce un diff de una línea.
- El control de revisión hace seguro tener el fichero abierto a la vez en la web, en el editor y en manos de un agente.
- El vocabulario de mutaciones es reutilizable: un agente puede emitir las mismas operaciones que la UI, sin duplicar lógica de escritura.

### Negativas / Trade-offs

- **No hay deshacer.** Cada edición se escribe en disco inmediatamente. El respaldo real es git, lo cual es coherente con tratar el diagrama como código, pero significa que un borrado accidental fuera de un repositorio se pierde. Por eso borrar nodo, zona o flujo pide confirmación.
- **Borrar un nodo arrastra los pasos que lo usan.** Es destructivo, pero la alternativa —dejar pasos apuntando a un nodo inexistente— produciría un fichero inválido.
- **El vocabulario acota lo que la UI puede hacer.** Campos como `provides`, `topics` y `tags` aún no tienen editor y hay que tocarlos en el YAML.
- **El esquema tuvo que relajarse:** `flows[].steps` ya admite lista vacía, porque un editor necesita poder crear un flujo y llenarlo después, y borrar un nodo puede vaciar un flujo existente. Un flujo sin pasos pasó de ser un error a ser un aviso.
- **Mover un nodo entre zonas descarta su posición fijada.** Las coordenadas son relativas a la zona, así que conservarlas al cambiar de padre lo colocaría en un sitio arbitrario.

### Notas de implementación

- El motor vive en `src/edit/mutations.ts` y es independiente del servidor: se puede usar desde un script o desde un agente.
- El layout se partió en dos fases (`computeBaseLayout` + `applyLayoutOverrides`) para que arrastrar un nodo no relance ELK. Sin esa separación, cada movimiento dispararía un recálculo asíncrono y el nodo parpadearía.
- El servidor deduplica las difusiones comparando revisiones: escribir provoca un evento del vigilante que, sin este filtro, reenviaría el mismo contenido y forzaría un recálculo de layout justo mientras se arrastra.
- La animación se pausa al entrar en modo edición: con el diagrama moviéndose bajo el ratón, estorba.

## Notas Relacionadas

- [[ADR-001_Modelo_y_arquitectura_de_ArchiFlow]]
- [[Esquema_arch_yaml]]
