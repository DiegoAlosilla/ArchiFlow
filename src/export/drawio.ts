import { endpointSignature, type Ir, type IrEdge, type IrFlow, type IrNode } from '../schema/compile.js';
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

/** Colores de capa de la librería `archimate3` de draw.io. */
const APPLICATION_LAYER = '#99ffff';
const TECHNOLOGY_LAYER = '#AFFFAF';

/**
 * Formas ArchiMate 3 de draw.io, siguiendo la correspondencia de tipos del
 * ADR-003. Los `appType` y `archiType` son los de la librería `archimate3`
 * (`Sidebar-ArchiMate3.js`): con un valor inventado la forma se dibuja como un
 * rectángulo genérico y el fichero deja de parecer ArchiMate.
 */
const ARCHIMATE_SHAPE: Record<IrNode['kind'], { appType: string; archiType: string; layer: string }> = {
  // ApplicationComponent
  service: { appType: 'comp', archiType: 'square', layer: APPLICATION_LAYER },
  frontend: { appType: 'comp', archiType: 'square', layer: APPLICATION_LAYER },
  client: { appType: 'comp', archiType: 'square', layer: APPLICATION_LAYER },
  external: { appType: 'comp', archiType: 'square', layer: APPLICATION_LAYER },
  job: { appType: 'comp', archiType: 'square', layer: APPLICATION_LAYER },
  component: { appType: 'comp', archiType: 'square', layer: APPLICATION_LAYER },
  // ApplicationService
  gateway: { appType: 'serv', archiType: 'rounded', layer: APPLICATION_LAYER },
  // DataObject
  database: { appType: 'passive', archiType: 'square', layer: APPLICATION_LAYER },
  storage: { appType: 'passive', archiType: 'square', layer: APPLICATION_LAYER },
  // SystemSoftware y TechnologyService
  cache: { appType: 'sysSw', archiType: 'square', layer: TECHNOLOGY_LAYER },
  broker: { appType: 'serv', archiType: 'rounded', layer: TECHNOLOGY_LAYER },
};

function nodeStyle(node: IrNode, dimmed: boolean, archimate = false): string {
  const accent = kindAccent[node.kind];
  if (archimate) {
    const { appType, archiType, layer } = ARCHIMATE_SHAPE[node.kind];
    return [
      `shape=mxgraph.archimate3.application;appType=${appType};archiType=${archiType};`,
      'html=1;whiteSpace=wrap;outlineConnect=0;',
      // El color de capa manda sobre el acento de ArchiFlow: quien pide formas
      // ArchiMate espera leer la capa por el color, que es la convención.
      `fillColor=${dimmed ? '#f1f5f9' : layer};`,
      `strokeColor=${dimmed ? '#cbd5e1' : '#0f172a'};`,
      `fontColor=${dimmed ? '#94a3b8' : '#0f172a'};`,
      'fontSize=12;verticalAlign=top;align=center;spacing=6;',
      node.external ? 'dashed=1;' : '',
    ].join('');
  }
  return [
    NODE_SHAPE[node.kind] ?? 'rounded=1;arcSize=12;',
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

function zoneStyle(color: string, archimate = false): string {
  // Una zona es un Grouping (ADR-003): con formas ArchiMate se dibuja como tal
  // en vez de como un rectángulo punteado cualquiera.
  const shape = archimate
    ? 'shape=mxgraph.archimate3.application;appType=grouping;archiType=square;outlineConnect=0;'
    : 'rounded=1;arcSize=6;';
  return [
    shape,
    'whiteSpace=wrap;html=1;',
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

  // Un nodo expandido lista todas sus operaciones, porque el layout ya le ha
  // reservado alto para ellas (ver `nodeHeight`); si no, solo la primera como
  // subtítulo.
  const endpoints = node.expanded ? node.provides : node.provides.slice(0, 1);
  for (const endpoint of endpoints) {
    const signature = endpointSignature(endpoint);
    if (!signature) continue;
    lines.push(`<font style="font-size:9px;color:#94a3b8">${escapeXml(signature)}</font>`);
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
  archimate?: boolean;
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
      `<mxCell id="${cellId('zone', zone.id)}" value="${escapeXml(title)}" style="${zoneStyle(zone.color, options.archimate)}" vertex="1" parent="1">` +
        `<mxGeometry x="${zoneBox.x}" y="${zoneBox.y}" width="${zoneBox.width}" height="${zoneBox.height}" as="geometry" /></mxCell>`,
    );
  }

  for (const node of ir.nodes) {
    const box = boxes.get(node.id);
    if (!box) continue;
    const dimmed = activeNodes !== null && !activeNodes.has(node.id);
    const parent = node.zone ? cellId('zone', node.zone) : '1';
    cells.push(
      `<mxCell id="${cellId('n', node.id)}" value="${escapeXml(nodeLabel(node))}" style="${nodeStyle(node, dimmed, options.archimate)}" vertex="1" parent="${parent}">` +
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

export async function toDrawio(ir: Ir, options: { archimate?: boolean } = {}): Promise<string> {
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

  pages.push(page('Topología', 'topologia', renderPage(ir, boxes, laid.zones, { archimate: options.archimate })));

  for (const flow of ir.flows) {
    pages.push(page(flow.label, `flow-${flow.id}`, renderPage(ir, boxes, laid.zones, { flow, archimate: options.archimate })));
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<mxfile host="ArchiFlow" agent="archiflow" version="1.0" type="device">\n${pages.join('\n')}\n</mxfile>\n`
  );
}
