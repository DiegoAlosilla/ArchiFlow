import type { Ir, IrFlow, IrNode } from '../schema/compile.js';

/**
 * Exportación a Mermaid.
 *
 * No sustituye a la web animada: existe porque es el formato que GitHub
 * renderiza en una descripción de PR y el que Copilot entiende sin contexto
 * adicional. Un diagrama que no se puede pegar en un PR no se revisa.
 *
 * La topología sale como `flowchart` y cada flujo como `sequenceDiagram`, que
 * es la forma nativa de Mermaid de expresar un recorrido ordenado.
 */

/** Mermaid es quisquilloso con los ids: solo alfanuméricos y guion bajo. */
function safeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `n_${cleaned}`;
}

/**
 * Los corchetes, llaves y comillas rompen el parser de Mermaid. Los parámetros
 * de ruta se reescriben a la convención `:param` en vez de borrarlos:
 * `/clientes/{id}/cuentas` se lee mucho mejor como `/clientes/:id/cuentas` que
 * como `/clientes/ id /cuentas`.
 */
function safeLabel(text: string): string {
  return text
    .replace(/\{([^{}]*)\}/g, ':$1')
    .replace(/"/g, "'")
    .replace(/[[\]{}()|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cada tipo de nodo tiene su forma en Mermaid; es lo que hace legible el flowchart. */
function shapeFor(node: IrNode, label: string): string {
  const id = safeId(node.id);
  switch (node.kind) {
    case 'database':
    case 'storage':
      return `${id}[("${label}")]`;
    case 'cache':
      return `${id}[["${label}"]]`;
    case 'broker':
    case 'gateway':
      return `${id}{{"${label}"}}`;
    case 'client':
    case 'frontend':
      return `${id}(["${label}"])`;
    case 'external':
      return `${id}["${label}"]`;
    default:
      return `${id}["${label}"]`;
  }
}

function nodeLabel(node: IrNode): string {
  const name = safeLabel(node.label);
  return node.tech ? `${name}<br/><small>${safeLabel(node.tech)}</small>` : name;
}

function topology(ir: Ir): string {
  const lines = ['flowchart TD'];
  const rendered = new Set<string>();

  for (const zone of ir.zones) {
    const members = ir.nodes.filter((node) => node.zone === zone.id);
    if (members.length === 0) continue;
    lines.push(`  subgraph ${safeId(`zone_${zone.id}`)}["${safeLabel(zone.label)}"]`);
    for (const node of members) {
      lines.push(`    ${shapeFor(node, nodeLabel(node))}`);
      rendered.add(node.id);
    }
    lines.push('  end');
  }

  for (const node of ir.nodes) {
    if (!rendered.has(node.id)) lines.push(`  ${shapeFor(node, nodeLabel(node))}`);
  }

  for (const edge of ir.edges) {
    const label = safeLabel(edge.labels.join(' / '));
    const arrow = edge.async ? '-.->' : '-->';
    lines.push(
      label
        ? `  ${safeId(edge.source)} ${arrow}|"${label}"| ${safeId(edge.target)}`
        : `  ${safeId(edge.source)} ${arrow} ${safeId(edge.target)}`,
    );
  }

  return lines.join('\n');
}

function sequence(ir: Ir, flow: IrFlow): string {
  const labelById = new Map(ir.nodes.map((node) => [node.id, node.label]));
  const lines = ['sequenceDiagram', '  autonumber'];

  for (const id of flow.nodeIds) {
    lines.push(`  participant ${safeId(id)} as ${safeLabel(labelById.get(id) ?? id)}`);
  }

  for (const step of flow.steps) {
    // `--)` es la flecha asíncrona de Mermaid: la misma semántica que el trazo
    // discontinuo en la web.
    const arrow = step.async ? '--)' : '->>';
    const latency = step.latencyMs !== undefined ? ` (${step.latencyMs} ms)` : '';
    lines.push(`  ${safeId(step.from)}${arrow}${safeId(step.to)}: ${safeLabel(step.label)}${latency}`);
    if (step.condition) lines.push(`  Note over ${safeId(step.from)}: ${safeLabel(step.condition)}`);
    if (step.returns) {
      lines.push(`  ${safeId(step.to)}-->>${safeId(step.from)}: ${safeLabel(step.returns)}`);
    }
  }

  return lines.join('\n');
}

/** Documento Markdown listo para pegar en un PR o en Obsidian. */
export function toMermaid(ir: Ir): string {
  const sections = [`# ${ir.meta.name}`];
  if (ir.meta.description) sections.push(ir.meta.description);

  sections.push('## Topología', '```mermaid', topology(ir), '```');

  for (const flow of ir.flows) {
    sections.push(`## Flujo: ${flow.label}`);
    if (flow.trigger) sections.push(`_Disparador: ${flow.trigger}_`);
    if (flow.description) sections.push(flow.description);
    sections.push('```mermaid', sequence(ir, flow), '```');
  }

  sections.push('---', '<sub>Generado con ArchiFlow desde el `.arch.yaml`.</sub>');

  return `${sections.join('\n\n')}\n`;
}
