import type { Ir, IrNode } from '../schema/compile.js';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const typeFor = (node: IrNode) => ({ gateway: 'ApplicationService', database: 'DataObject', storage: 'DataObject', cache: 'SystemSoftware', broker: 'TechnologyService' }[node.kind] ?? 'ApplicationComponent');

/** ArchiMate Open Exchange XML: formato de intercambio, no el modelo interno. */
export function toArchimate(ir: Ir): string {
  const nodes = ir.nodes.map((node) => `<element identifier="${escape(node.id)}" xsi:type="${typeFor(node)}"><name xml:lang="es">${escape(node.label)}</name></element>`).join('');
  const zones = ir.zones.map((zone) => `<element identifier="zone-${escape(zone.id)}" xsi:type="Grouping"><name xml:lang="es">${escape(zone.label)}</name></element>`).join('');
  const relations = ir.edges.map((edge) => `<relationship identifier="${escape(edge.id)}" xsi:type="${edge.async ? 'TriggeringRelationship' : 'ServingRelationship'}" source="${escape(edge.source)}" target="${escape(edge.target)}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="archiflow"><name xml:lang="es">${escape(ir.meta.name)}</name><elements>${zones}${nodes}</elements><relationships>${relations}</relationships></model>`;
}
