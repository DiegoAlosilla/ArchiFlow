# Contrato de entregables

Genera una carpeta por análisis con estos artefactos:

```text
analysis/
  00-resumen-ejecutivo.md
  01-inventario-tecnico.md
  02-trazabilidad-canal.md
  03-cobertura-swagger.md
  04-inventario-por-flujo.xlsx
  inventario-flujos.json
  flows/
    <flow-id>.arch.yaml
    <flow-id>.svg
```

El Excel es obligatorio cuando el usuario pida inventario tabular, conteo de endpoints o análisis XML. El flujo es la entidad raíz y el catálogo de endpoints es una vista secundaria. Seguir `xml-excel-contract.md` para su estructura y validación.

## Estructura mínima del inventario Markdown

1. **Ficha:** fuente, canal origen, canal objetivo, fecha, versión y advertencias.
2. **Resumen ejecutivo:** observado, propuesto, alcance del equipo y pendientes.
3. **Flujos:** ID, objetivo, disparador, resultado, participantes, confianza.
4. **Microservicios a construir/adaptar:** nombre, propósito, APIs, endpoints, dependencias, datos/eventos, decisión, confianza, evidencia.
5. **Dependencias core/cross:** propietario, capacidad, operación consumida, sincronía y estado.
6. **Infraestructura y datos:** cache, base de datos, Firebase, broker, storage; justificar necesidad.
7. **Ranking de complejidad:** posición, servicio, motivo, riesgos y preguntas.
8. **Brechas:** información faltante, inconsistencias de flechas y decisiones requeridas.

## Tabla de endpoints

| Servicio propietario | Método | Path | Descripción funcional | Flujo(s) | Consumidor | Estado | Confianza | Evidencia |
|---|---|---|---|---|---|---|---|---|

No inventes descripciones. Si solo se conoce el nombre técnico, parafrasea con `inferido` y conserva el texto original como evidencia.

## Reglas de conteo

- Reporta servicios únicos y apariciones visuales por separado.
- Deduplica endpoints por `propietario + método + path normalizado`.
- Un contenedor no es automáticamente un microservicio.
- Una API puede exponer varios endpoints y un microservicio puede participar en varios flujos sin contarse varias veces.
- Publica totales `confirmados`, `inferidos` y `por-validar`; no mezcles los estados.
