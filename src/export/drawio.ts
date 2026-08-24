import { endpointSignature, type Ir, type IrEdge, type IrFlow, type IrNode } from '../schema/compile.js';
import { computeLayout, ENDPOINT_GAP, ENDPOINT_ROW, NODE_HEADER, type Box } from '../layout/index.js';
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

function boundaryAnchorStyle(sourceBox: Box | undefined, targetBox: Box | undefined, sourceExpanded: boolean, targetExpanded: boolean): string {
  const goesRight = sourceBox == null || targetBox == null || sourceBox.x <= targetBox.x;
  const ratio = (box: Box | undefined, expanded: boolean) => {
    if (!expanded || box == null || box.height === 0) return 0.5;
    return Math.max(0.08, Math.min(0.92, (NODE_HEADER + ENDPOINT_ROW / 2) / box.height));
  };
  return [
    `exitX=${goesRight ? 1 : 0};entryX=${goesRight ? 0 : 1};`,
    `exitY=${ratio(sourceBox, sourceExpanded)};entryY=${ratio(targetBox, targetExpanded)};`,
    'exitDx=0;exitDy=0;entryDx=0;entryDy=0;',
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

interface DrawioPluginStep {
  id: string;
  cellId: string;
  fromCellId: string;
  edgeId: string;
  direction?: 'request' | 'response';
  operation: string;
  protocol: string;
  purpose: string;
  queryParams: string;
  pathParams: string;
  requestHeaders: string;
  requestBody: string;
  responseStatus: string;
  responseHeaders: string;
  responseBody: string;
  cacheOperation: string;
  cacheKey: string;
  cacheData: string;
  cacheTtl: string;
  notes: string;
}

interface DrawioPluginFlow {
  id: string;
  name: string;
  timeline?: boolean;
  steps: DrawioPluginStep[];
}

function refParts(ir: Ir, reference: string): { nodeId: string; operationId?: string } {
  if (ir.nodes.some((node) => node.id === reference)) return { nodeId: reference };
  const slash = reference.lastIndexOf('/');
  if (slash > 0) {
    const nodeId = reference.slice(0, slash);
    if (ir.nodes.some((node) => node.id === nodeId)) {
      return { nodeId, operationId: reference.slice(slash + 1) };
    }
  }
  return { nodeId: reference };
}

function operationCellId(ir: Ir, reference: string): string {
  const { nodeId, operationId } = refParts(ir, reference);
  return operationId ? cellId('op', `${nodeId}-${operationId}`) : cellId('n', nodeId);
}

function stepCellId(ir: Ir, nodeId: string, operationId?: string): string {
  return operationId ? operationCellId(ir, `${nodeId}/${operationId}`) : operationCellId(ir, nodeId);
}

function parameterText(values: Array<{ name: string; value?: string; required?: boolean; description?: string }>): string {
  return values.map((item) => {
    const detail = item.value ?? item.description ?? (item.required ? 'requerido' : 'opcional');
    return `${item.name}: ${detail}`;
  }).join('\n');
}

function openApiFor(node: IrNode): string | undefined {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of node.provides) {
    if (!operation.path) continue;
    const method = (operation.method ?? 'GET').toLowerCase();
    paths[operation.path] ??= {};
    paths[operation.path]![method] = {
      operationId: operation.id,
      summary: operation.label ?? operation.description ?? operation.id ?? endpointSignature(operation),
      description: operation.description,
      responses: { '200': { description: 'Respuesta exitosa' } },
      tags: [node.label],
    };
  }
  if (Object.keys(paths).length === 0) return undefined;
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: node.label, version: '1.0.0', description: node.tech },
    paths,
  });
}

function pluginFlow(ir: Ir, flow: IrFlow): DrawioPluginFlow {
  return {
    id: flow.id,
    name: flow.label,
    steps: flow.steps.map((step, index) => ({
      id: `step-${flow.id}-${index + 1}`,
      cellId: stepCellId(ir, step.to, step.toOp),
      fromCellId: stepCellId(ir, step.from, step.fromOp),
      edgeId: cellId('fs', `${flow.id}-${index + 1}`),
      operation: step.label,
      protocol: step.protocol,
      purpose: step.purpose ?? '',
      queryParams: parameterText(step.queryParams),
      pathParams: parameterText(step.pathParams),
      requestHeaders: parameterText(step.headers),
      requestBody: step.request ?? '',
      responseStatus: step.response ? '200' : '',
      responseHeaders: '',
      responseBody: step.response ?? '',
      cacheOperation: /cache|redis/i.test(step.protocol) ? step.label : '',
      cacheKey: '',
      cacheData: step.dataUsed.join(', '),
      cacheTtl: '',
      notes: [step.condition, step.note, step.returns ? `Retorna: ${step.returns}` : ''].filter(Boolean).join('\n'),
    })),
  };
}

function rootCell(flows: DrawioPluginFlow[]): string {
  const activeFlowId = flows[0]?.id ?? '';
  const store = JSON.stringify({ version: 1, activeFlowId, flows });
  return `<object label="" ${STORE_ATTRIBUTE}="${escapeXml(store)}"><mxCell id="0" /></object>`;
}

const STORE_ATTRIBUTE = 'archiflowFlows';

function nodeCell(node: IrNode, box: Box, parent: string, dimmed: boolean, archimate: boolean | undefined): string[] {
  const id = cellId('n', node.id);
  const expanded = node.expanded && node.provides.length > 0;
  const contract = openApiFor(node);
  const label = expanded
    ? `<b>${escapeXml(node.label)}</b>${node.tech ? `<br/><font style="font-size:10px;color:#64748b">${escapeXml(node.tech)}</font>` : ''}`
    : nodeLabel(node);
  const attributes = [
    `label="${escapeXml(label)}"`,
    'archiflowKind="component"',
    'archiflowSelectable="1"',
    contract ? `archiflowOpenApi="${escapeXml(contract)}"` : '',
  ].filter(Boolean).join(' ');
  const style = nodeStyle(node, dimmed, archimate) + (expanded ? 'container=1;recursiveResize=0;collapsible=0;' : '');
  const cells = [
    `<object ${attributes}><mxCell id="${id}" style="${style}" vertex="1" parent="${parent}">` +
      `<mxGeometry x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" as="geometry" /></mxCell></object>`,
  ];
  if (!expanded) return cells;

  const width = Math.max(128, (box.width - 28 - (node.provides.length - 1) * ENDPOINT_GAP) / node.provides.length);
  node.provides.forEach((operation, index) => {
    const operationId = operation.id ?? `operation-${index + 1}`;
    const method = operation.method ?? '';
    const path = operation.path ?? operation.label ?? operationId;
    const operationLabel = endpointSignature(operation) || operationId;
    cells.push(
      `<object label="${escapeXml(operationLabel)}" archiflowKind="endpoint" archiflowHttpMethod="${escapeXml(method)}" archiflowPath="${escapeXml(path)}">` +
        `<mxCell id="${cellId('op', `${node.id}-${operationId}`)}" style="rounded=1;whiteSpace=wrap;html=1;arcSize=12;strokeWidth=1.5;fontSize=10;fontStyle=1;fillColor=#eef2ff;strokeColor=${kindAccent[node.kind]};align=left;spacingLeft=8;" vertex="1" parent="${id}">` +
        `<mxGeometry x="${14 + index * (width + ENDPOINT_GAP)}" y="${NODE_HEADER}" width="${width}" height="${ENDPOINT_ROW}" as="geometry" /></mxCell></object>`,
    );
  });
  return cells;
}

function renderPage(ir: Ir, boxes: Map<string, Box>, zoneBoxes: Box[], options: PageOptions): string {
  const { flow } = options;
  const activeNodes = flow ? new Set(flow.nodeIds) : null;
  const pageFlows = flow ? [pluginFlow(ir, flow)] : ir.flows.map((candidate) => pluginFlow(ir, candidate));
  const cells: string[] = [rootCell(pageFlows), '<mxCell id="1" parent="0" />'];

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
    cells.push(...nodeCell(node, box, parent, dimmed, options.archimate));
  }

  const visibleFlows = flow ? [flow] : ir.flows;
  for (const visibleFlow of visibleFlows) {
    for (const [index, step] of visibleFlow.steps.entries()) {
      const edge = ir.edges.find((candidate) => candidate.id === step.edgeId);
      if (!edge) continue;
      const condition = step.condition ? ` [${step.condition}]` : '';
      const lines = flow ? [`${index + 1}. ${step.label}${condition}`] : [step.label];
      const sourceNode = ir.nodes.find((node) => node.id === step.from);
      const targetNode = ir.nodes.find((node) => node.id === step.to);
      const source = cellId('n', step.from);
      const target = cellId('n', step.to);
      const anchors = boundaryAnchorStyle(
        boxes.get(step.from),
        boxes.get(step.to),
        Boolean(step.fromOp && sourceNode?.expanded),
        Boolean(step.toOp && targetNode?.expanded),
      );
      cells.push(
        `<mxCell id="${cellId('fs', `${visibleFlow.id}-${index + 1}`)}" value="${escapeXml(multilineLabel(lines))}" style="${edgeStyle(edge, false)}${anchors}" edge="1" parent="1" source="${source}" target="${target}">` +
          '<mxGeometry relative="1" as="geometry" /></mxCell>',
      );
    }
  }

  for (const edge of ir.edges.filter((candidate) => candidate.declaredOnly)) {
    cells.push(
      `<mxCell id="${cellId('e', edge.id)}" value="${escapeXml(multilineLabel(edge.labels))}" style="${edgeStyle(edge, false)}" edge="1" parent="1" source="${cellId('n', edge.source)}" target="${cellId('n', edge.target)}">` +
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
