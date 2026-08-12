# Adaptación de un canal de referencia

## Principio

El diagrama origen es evidencia, no una plantilla que se renombra. Conserva la intención de negocio y revisa cada responsabilidad de experiencia antes de trasladarla al canal objetivo.

## Matriz de decisión

| Elemento origen | Acción habitual | Validación requerida |
|---|---|---|
| Pantalla o MiniApp móvil | Adaptar a pantalla web NHBK | Navegación, sesión, accesibilidad y comportamiento web |
| API UX/BFF del canal | Construir o adaptar | Contrato público, agregación, seguridad y propiedad |
| MS UX del canal | Adaptar o reutilizar | Si contiene lógica exclusiva del móvil |
| Business core | Reutilizar | Contrato, capacidad, SLA y ownership |
| Cross | Reutilizar | Autorización, auditoría, documentos, notificaciones |
| Cache | Reutilizar o crear por dominio | Claves, TTL, datos sensibles, invalidación |
| Firebase | Por-validar para web | Caso de uso real; no heredarlo por inercia del móvil |
| Base de datos | Por-validar | Ownership del dato y necesidad de persistencia propia |
| Evento/broker | Reutilizar o adaptar | Topic, productor, consumidor, idempotencia |

## Reglas de trazabilidad

1. Asigna a cada componente un `source_id` estable del original.
2. Asigna al objetivo un `target_id`; no sustituyas el origen.
3. Registra `decision`, `confidence`, `evidence` y `open_question`.
4. Las correcciones de flechas viven en la propuesta semántica; la vista fiel mantiene el conector original.
5. Un cambio de MBBK/BMU a NHBK no cambia por sí solo business core, cross o datos.
6. Si dos cajas repiten nombre y contrato, trátalas como apariciones del mismo servicio hasta demostrar lo contrario.

## Control de equivalencia

Para aspirar a una equivalencia del 90 %, mide por separado:

- fidelidad visual: posición, tamaño, figura, texto, estilo y ruta de conectores;
- cobertura semántica: capacidades, servicios, endpoints y dependencias;
- correcciones conscientes: errores del original que no deben copiarse a la propuesta.

Nunca uses un único porcentaje que esconda estas tres dimensiones.
