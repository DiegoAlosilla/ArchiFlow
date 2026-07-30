import type { Ir } from '../schema/compile.js';

/**
 * Exportación a JSON del modelo compilado.
 *
 * No es el `.arch.yaml` convertido a JSON: es el IR, con las aristas ya
 * inferidas de los flujos y la línea de tiempo de cada animación calculada.
 * Sirve para alimentar otra herramienta sin tener que reimplementar la
 * compilación, que es la parte con reglas.
 */

export function toJson(ir: Ir): string {
  return `${JSON.stringify(
    {
      $schema: 'https://github.com/DiegoAlosilla/ArchiFlow',
      generator: 'archiflow',
      ...ir,
    },
    null,
    2,
  )}\n`;
}
