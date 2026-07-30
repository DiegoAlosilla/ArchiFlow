import type { Ir, IrEdge, IrNode, IrZone } from '../schema/compile.js';
import { computeLayout, type Box } from '../layout/index.js';
import { kindAccent } from '../theme.js';

/**
 * Exportación a *ArchiMate Model Exchange File Format* de The Open Group, que
 * Archi importa nativamente (Fichero → Importar → Model Exchange File).
 *
 * Es formato de intercambio, no el modelo interno (ADR-003, decisión D4): se
 * traduce hacia fuera y no se pretende que el viaje de vuelta sea fiel.
 *
 * El fichero lleva además una vista con geometría. Sin ella Archi importa el
 * modelo en el árbol pero no dibuja nada, y quien lo recibe tiene que recomponer
 * el diagrama a mano — justo el trabajo que este exportador existe para ahorrar.
 *
 * Dos detalles del formato que se pagan caros si se ignoran:
 *
 * - Los tipos de relación **no llevan el sufijo `Relationship`**. Eso es el
 *   formato nativo de Archi (`archimate:ServingRelationship`); en el de
 *   intercambio el XSD solo admite `Serving`, `Triggering`, `Composition`…
 * - `identifier` es un `xsd:ID`: no puede empezar por dígito ni contener `/`.
 *   Los ids de ArchiFlow sí pueden, así que hay que sanearlos todos.
 */

const NAMESPACE = 'http://www.opengroup.org/xsd/archimate/3.0/';
const SCHEMA_LOCATION =
  'http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * `xsd:ID` válido y estable: prefijo fijo más el id saneado. El prefijo evita el
 * dígito inicial y de paso mantiene separados los espacios de nombres de nodos,
 * zonas, relaciones y elementos de la vista.
 */
function identifier(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

/**
 * Correspondencia de tipos fijada en el ADR-003. Si cambia aquí, cambia allí.
 *
 * `database` y `storage` van a DataObject: el nodo tecnológico que los aloja es
 * una decisión de la vista y esta exportación no lo modela.
 */
const ELEMENT_TYPE: Record<IrNode['kind'], string> = {
  service: 'ApplicationComponent',
  frontend: 'ApplicationComponent',
  client: 'ApplicationComponent',
  gateway: 'ApplicationService',
  database: 'DataObject',
  storage: 'DataObject',
  cache: 'SystemSoftware',
  broker: 'TechnologyService',
  external: 'ApplicationComponent',
  job: 'ApplicationComponent',
  component: 'ApplicationComponent',
};

/**
 * Documentación del elemento: lo que el tipo de ArchiMate no puede expresar —el
 * `kind` original, la tecnología, los endpoints, si está fuera del perímetro—
 * para que no se pierda al cruzar de herramienta.
 */
function documentation(node: IrNode): string {
  const lines = [node.description, `ArchiFlow: ${node.kind}`];
  if (node.tech) lines.push(`Tecnología: ${node.tech}`);
  if (node.repo) lines.push(`Repositorio: ${node.repo}`);
  if (node.external) lines.push('Fuera del perímetro del equipo.');
  for (const operation of node.provides) {
    const signature = [operation.method, operation.path ?? operation.label ?? operation.id]
      .filter(Boolean)
      .join(' ');
    if (signature) lines.push(`· ${signature}`);
  }
  return lines.filter(Boolean).join('\n');
}

function element(id: string, type: string, name: string, docs: string): string {
  const body = [`<name xml:lang="es">${escapeXml(name)}</name>`];
  if (docs) body.push(`<documentation xml:lang="es">${escapeXml(docs)}</documentation>`);
  return `<element identifier="${id}" xsi:type="${type}">${body.join('')}</element>`;
}

/**
 * Un paso síncrono es un Serving —el destino presta servicio al origen— y uno
 * asíncrono un Triggering: el origen dispara y sigue. Es lo que fija el ADR-003.
 */
function relationshipType(edge: IrEdge): 'Serving' | 'Triggering' {
  return edge.async ? 'Triggering' : 'Serving';
}

/**
 * El color del tema, en los componentes que pide el formato. Acepta `#abc`
 * además de `#aabbcc` porque el esquema de zonas admite las dos formas.
 */
function rgb(hex: string): string {
  const digits = hex.replace('#', '');
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const channel = (at: number) => parseInt(full.slice(at, at + 2), 16) || 0;
  return `r="${channel(0)}" g="${channel(2)}" b="${channel(4)}"`;
}

/**
 * Las coordenadas del formato son `nonNegativeInteger`, y el lienzo de
 * ArchiFlow no tiene origen: arrastrar una zona hacia arriba deja posiciones
 * negativas perfectamente válidas aquí que allí invalidan el fichero entero.
 */
function coordinate(value: number): number {
  return Math.max(0, Math.round(value));
}

function viewNode(id: string, elementRef: string, box: Box, accent: string, children = ''): string {
  return (
    `<node identifier="${id}" elementRef="${elementRef}" xsi:type="Element" ` +
    `x="${coordinate(box.x)}" y="${coordinate(box.y)}" ` +
    `w="${coordinate(box.width)}" h="${coordinate(box.height)}">` +
    `<style><fillColor r="255" g="255" b="255" /><lineColor ${rgb(accent)} /></style>` +
    `${children}</node>`
  );
}

/**
 * Vista con la topología completa.
 *
 * Los hijos de una zona se anidan dentro de su nodo de vista con coordenadas
 * relativas, que es justo lo que devuelve el layout y lo que espera el formato.
 * Así el Grouping se comporta en Archi como el contenedor que es.
 */
function view(ir: Ir, zones: { zone: IrZone; box: Box; children: Box[] }[], loose: Box[]): string {
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  const drawn = new Set<string>();
  const nodes: string[] = [];

  // Traslada el nivel superior para que nada quede en negativo, en vez de
  // recortar cada caja por su cuenta: recortando se perdería la posición
  // relativa entre zonas, que es la lectura por capas del diagrama.
  const top = [...zones.map(({ box }) => box), ...loose];
  const shift = {
    x: -Math.min(0, ...top.map((box) => box.x)),
    y: -Math.min(0, ...top.map((box) => box.y)),
  };
  const translate = (box: Box): Box => ({ ...box, x: box.x + shift.x, y: box.y + shift.y });

  const nodeOf = (box: Box): string | null => {
    const node = nodeById.get(box.id);
    if (!node) return null;
    drawn.add(box.id);
    return viewNode(identifier('view', box.id), identifier('n', box.id), box, kindAccent[node.kind]);
  };

  for (const { zone, box, children } of zones) {
    // Los hijos van en coordenadas relativas a su zona, así que no se trasladan.
    const inner = children.map(nodeOf).filter((child): child is string => child !== null);
    nodes.push(
      viewNode(
        identifier('viewzone', zone.id),
        identifier('zone', zone.id),
        translate(box),
        zone.color,
        inner.join(''),
      ),
    );
  }

  for (const box of loose) {
    const drawnNode = nodeOf(translate(box));
    if (drawnNode) nodes.push(drawnNode);
  }

  const connections = ir.edges
    .filter((edge) => drawn.has(edge.source) && drawn.has(edge.target))
    .map(
      (edge) =>
        `<connection identifier="${identifier('conn', edge.id)}" xsi:type="Relationship" ` +
        `relationshipRef="${identifier('r', edge.id)}" ` +
        `source="${identifier('view', edge.source)}" target="${identifier('view', edge.target)}" />`,
    );

  return (
    '<views><diagrams><view identifier="view-topologia" xsi:type="Diagram">' +
    `<name xml:lang="es">${escapeXml(ir.meta.name)}</name>` +
    nodes.join('') +
    connections.join('') +
    '</view></diagrams></views>'
  );
}

export async function toArchimate(ir: Ir): Promise<string> {
  const laid = await computeLayout(ir);
  const zoneById = new Map(ir.zones.map((zone) => [zone.id, zone]));
  const zones = laid.zones.flatMap((zoneBox) => {
    const zone = zoneById.get(zoneBox.id.slice('zone:'.length));
    return zone ? [{ zone, box: zoneBox, children: zoneBox.children }] : [];
  });

  const elements = [
    ...ir.zones.map((zone) =>
      element(identifier('zone', zone.id), 'Grouping', zone.label, zone.description ?? ''),
    ),
    ...ir.nodes.map((node) =>
      element(identifier('n', node.id), ELEMENT_TYPE[node.kind], node.label, documentation(node)),
    ),
  ];

  const relationships = ir.edges.map(
    (edge) =>
      `<relationship identifier="${identifier('r', edge.id)}" xsi:type="${relationshipType(edge)}" ` +
      `source="${identifier('n', edge.source)}" target="${identifier('n', edge.target)}">` +
      (edge.labels.length > 0 ? `<name xml:lang="es">${escapeXml(edge.labels.join(' · '))}</name>` : '') +
      '</relationship>',
  );

  // Una zona compone los nodos que contiene: es lo que hace que en Archi el
  // Grouping arrastre con él a sus miembros en vez de quedar como una caja
  // decorativa sin relación con nada.
  const membership = ir.nodes
    .filter((node) => node.zone !== undefined && zoneById.has(node.zone))
    .map(
      (node) =>
        `<relationship identifier="${identifier('m', `${node.zone}__${node.id}`)}" xsi:type="Composition" ` +
        `source="${identifier('zone', node.zone!)}" target="${identifier('n', node.id)}" />`,
    );

  // El orden de los hijos de <model> lo fija el XSD: name, documentation,
  // elements, relationships y views al final. Cambiarlo invalida el fichero.
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<model xmlns="${NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="${SCHEMA_LOCATION}" identifier="archiflow-model">\n` +
    `  <name xml:lang="es">${escapeXml(ir.meta.name)}</name>\n` +
    (ir.meta.description
      ? `  <documentation xml:lang="es">${escapeXml(ir.meta.description)}</documentation>\n`
      : '') +
    `  <elements>${elements.join('')}</elements>\n` +
    `  <relationships>${[...relationships, ...membership].join('')}</relationships>\n` +
    `  ${view(ir, zones, laid.loose)}\n` +
    '</model>\n'
  );
}
