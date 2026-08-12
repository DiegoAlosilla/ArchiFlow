# Cobertura de arquitectura contra Swagger/OpenAPI

## Normalización

- Convierte el método a mayúsculas.
- Elimina host, query de ejemplo y barra final del path.
- Trata `{id}` y nombres equivalentes de parámetro como candidatos, no como match definitivo.
- Identifica el propietario con `info.title`, tags, servidor, nombre de archivo y contexto del proyecto.

## Comparación

Por cada endpoint esperado valida:

1. propietario del contrato;
2. método y path;
3. propósito/summary;
4. parámetros obligatorios;
5. request body y content type;
6. respuestas principales y errores relevantes;
7. esquema de seguridad;
8. idempotencia o asincronía cuando aplique.

## Estados

- `cubierto`: coincide y los elementos críticos son compatibles.
- `faltante`: está en la arquitectura y no en los contratos.
- `extra`: está en el contrato y no en la arquitectura aprobada.
- `incompatible`: existe, pero difiere en contrato, propietario o seguridad.
- `por-validar`: la evidencia no permite una conclusión.

## Salida

| Servicio | Método/path esperado | Contrato encontrado | Estado | Diferencia | Acción |
|---|---|---|---|---|---|

Incluye un resumen por servicio y global. No ocultes endpoints extra: pueden revelar alcance no aprobado o un contrato reutilizado sin limpiar.
