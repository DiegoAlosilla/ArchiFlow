import type { Ir, IrEdge, IrFlow, IrNode } from '../schema/compile.js';
import { computeLayout, type Box } from '../layout/index.js';
import { kindAccent, protocolColor } from '../theme.js';

/**
 * Exportación a draw.io (mxGraph XML).
 *
 * Draw.io no anima nada, así que la traducción honesta de un flujo animado es
 * una página por flujo con los pasos numerados y lo que no participa atenuado.
 * Se pierde el movimiento, pero se conserva lo que el movimiento comunicaba:
 * el orden del recorrido. La primera página es la topología completa.
 *
 * Las posiciones salen del mismo layout ELK que usa la web, para que el
 * fichero exportado se reconozca como el diagrama que se estaba viendo.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Los ids de mxGraph no admiten cualquier carácter sin comillas. */
function cellId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

const NODE_SHAPE: Partial<Record<IrNode['kind'], string>> = {
  database: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=13;',
  storage: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=13;',
  broker: 'shape=hexagon;perimeter=hexagonPerimeter2;',
  gateway: 'shape=hexagon;perimeter=hexagonPerimeter2;',
  job: 'ellipse;',
};

function nodeStyle(node: IrNode, dimmed: boolean): string {
  const accent = kindAccent[node.kind];
  const shape = NODE_SHAPE[node.kind] ?? 'rounded=1;arcSize=12;';
  return [
    shape,
    'whiteSpace=wrap;html=1;',
    `fillColor=${dimmed ? '#f8fafc' : '#ffffff'};`,
    `strokeColor=${dimmed ? '#cbd5e1' : accent};`,
    `fontColor=${dimmed ? '#94a3b8' : '#0f172a'};`,
    'strokeWidth=2;fontSize=12;verticalAlign=middle;spacing=6;',
    node.external ? 'dashed=1;' : '',
  ].join('');
}

function edgeStyle(edge: IrEdge, dimmed: boolean): string {
  return [
    'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;jettySize=auto;orthogonalLoop=1;',
    `strokeColor=${dimmed ? '#e2e8f0' : protocolColor[edge.protocol]};`,
    `strokeWidth=${dimmed ? 1 : 2};`,
    edge.async ? 'dashed=1;' : '',
    'fontSize=10;fontColor=#475569;labelBackgroundColor=#ffffff;',
    'endArrow=blockThin;endFill=1;',
  ].join('');
}

function zoneStyle(color: string): string {
  return [
    'rounded=1;arcSize=6;whiteSpace=wrap;html=1;',
    `fillColor=none;strokeColor=${color};dashed=1;strokeWidth=1.5;`,
    'verticalAlign=top;align=left;spacingLeft=12;spacingTop=6;',
    `fontSize=11;fontStyle=1;fontColor=${color};`,
  ].join('');
}

/**
 * Etiqueta multilínea de un nodo: nombre en negrita y tecnología debajo.
 *
 * Devuelve HTML **sin escapar**; escaparlo es responsabilidad de quien lo
 * inserta en el atributo `value`. mxGraph almacena el marcado escapado dentro
 * del XML y lo interpreta al pintar porque el estilo lleva `html=1`; meterlo
 * en crudo produce un fichero que draw.io rechaza con
 * "Unescaped '<' not allowed in attributes values".
 */
function nodeLabel(node: IrNode): string {
  const lines = [`<b>${escapeXml(node.label)}</b>`];
  if (node.tech) lines.push(`<font style="font-size:10px;color:#64748b">${escapeXml(node.tech)}</font>`);
  const endpoint = node.provides[0];
  if (endpoint?.path) {
    const method = endpoint.method ? `${endpoint.method} ` : '';
    lines.push(
      `<font style="font-size:9px;color:#94a3b8">${escapeXml(method + endpoint.path)}</font>`,
    );
  }
  return lines.join('<br/>');
}

/** Une varias líneas de texto plano en una etiqueta HTML de mxGraph. */
function multilineLabel(lines: string[]): string {
  return lines.map(escapeXml).join('<br/>');
}

interface PageOptions {
  /** Si se indica, solo este flujo se dibuja en vivo; el resto queda atenuado. */
  flow?: IrFlow;
}

function renderPage(ir: Ir, boxes: Map<string, Box>, zoneBoxes: Box[], options: PageOptions): string {
  const { flow } = options;
  const activeNodes = flow ? new Set(flow.nodeIds) : null;
  const cells: string[] = ['<mxCell id="0" />', '<mxCell id="1" parent="0" />'];

  for (const zoneBox of zoneBoxes) {
    const zoneId = zoneBox.id.slice('zone:'.length);
    const zone = ir.zones.find((candidate) => candidate.id === zoneId);
    if (!zone) continue;
    const title = zone.platform ? `${zone.label} — ${zone.platform}` : zone.label;
    cells.push(
      `<mxCell id="${cellId('zone', zone.id)}" value="${escapeXml(title)}" style="${zoneStyle(zone.color)}" vertex="1" parent="1">` +
        `<mxGeometry x="${zoneBox.x}" y="${zoneBox.y}" width="${zoneBox.width}" height="${zoneBox.height}" as="geometry" /></mxCell>`,
    );
  }

  for (const node of ir.nodes) {
    const box = boxes.get(node.id);
    if (!box) continue;
    const dimmed = activeNodes !== null && !activeNodes.has(node.id);
    const parent = node.zone ? cellId('zone', node.zone) : '1';
    cells.push(
      `<mxCell id="${cellId('n', node.id)}" value="${escapeXml(nodeLabel(node))}" style="${nodeStyle(node, dimmed)}" vertex="1" parent="${parent}">` +
        `<mxGeometry x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" as="geometry" /></mxCell>`,
    );
  }

  // En una página de flujo, la etiqueta de cada arista lleva el número de paso:
  // es lo único que sustituye a la animación en un formato estático.
  const stepLabels = new Map<string, string[]>();
  if (flow) {
    flow.steps.forEach((step, i) => {
      const existing = stepLabels.get(step.edgeId) ?? [];
      const condition = step.condition ? ` [${step.condition}]` : '';
      existing.push(`${i + 1}. ${step.label}${condition}`);
      stepLabels.set(step.edgeId, existing);
    });
  }

  for (const edge of ir.edges) {
    const inFlow = flow ? stepLabels.has(edge.id) : true;
    if (flow && !inFlow) continue; // en una página de flujo, fuera el ruido
    const lines = flow ? (stepLabels.get(edge.id) ?? []) : edge.labels;
    cells.push(
      `<mxCell id="${cellId('e', edge.id)}" value="${escapeXml(multilineLabel(lines))}" style="${edgeStyle(edge, false)}" edge="1" parent="1" source="${cellId('n', edge.source)}" target="${cellId('n', edge.target)}">` +
        '<mxGeometry relative="1" as="geometry" /></mxCell>',
    );
  }

  return cells.join('\n        ');
}

export async function toDrawio(ir: Ir): Promise<string> {
  const laid = await computeLayout(ir);

  // Los hijos llevan coordenadas relativas a su zona, que es justo lo que
  // espera mxGraph cuando una celda declara otra celda como `parent`.
  const boxes = new Map<string, Box>();
  for (const zone of laid.zones) for (const child of zone.children) boxes.set(child.id, child);
  for (const box of laid.loose) boxes.set(box.id, box);

  const pages: string[] = [];

  const page = (name: string, id: string, content: string) =>
    `  <diagram id="${escapeXml(id)}" name="${escapeXml(name)}">\n` +
    '    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" ' +
    'arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">\n' +
    `      <root>\n        ${content}\n      </root>\n` +
    '    </mxGraphModel>\n  </diagram>';

  pages.push(page('Topología', 'topologia', renderPage(ir, boxes, laid.zones, {})));

  for (const flow of ir.flows) {
    pages.push(page(flow.label, `flow-${flow.id}`, renderPage(ir, boxes, laid.zones, { flow })));
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<mxfile host="ArchiFlow" agent="archiflow" version="1.0" type="device">\n${pages.join('\n')}\n</mxfile>\n`
  );
}
