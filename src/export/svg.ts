import { endpointSignature, type Ir, type IrFlow, type IrNode } from '../schema/compile.js';
import {
  anchorPoint,
  computeLayout,
  computeSlots,
  pointAlong,
  placeEdgeLabel,
  pointBelongsToBox,
  routeEdge,
  slotEdgeRefs,
  ENDPOINT_ROW,
  ENDPOINT_GAP,
  NODE_HEADER,
  type Box,
  type LaidOutGraph,
  type Point,
} from '../layout/index.js';
import { buildDots, dotFade, dotProgress } from '../animation.js';
import { kindAccent, protocolColor } from '../theme.js';
import { vendorIconPath } from '../icons.js';

/**
 * Exportación a SVG.
 *
 * Usa el mismo layout y el mismo trazador de aristas que la web, así que el
 * fichero exportado es el diagrama que se estaba viendo, no una reconstrucción
 * parecida. Es autocontenido —sin fuentes ni recursos externos— para que se
 * pueda abrir en cualquier sitio, incrustar en un correo o importar en draw.io.
 *
 * De aquí salen también el PNG y el JPG: el navegador rasteriza este SVG.
 */

export interface SvgOptions {
  /** Resalta un flujo y atenúa lo demás. Sin él se dibuja la topología completa. */
  flowId?: string;
  /** Numera los pasos sobre las aristas. Es lo que sustituye a la animación. */
  numberSteps?: boolean;
  /** Fondo transparente en vez del color del tema. */
  transparent?: boolean;
  /** Tema claro para imprimir o pegar en un documento. */
  light?: boolean;
  /** Margen alrededor del contenido. */
  padding?: number;
  /**
   * Instante de la animación que se dibuja, en ms. Sin él el SVG es estático,
   * que es lo que se quiere para pegar en un documento; con él se congela un
   * fotograma, que es de lo que se hace el GIF. Necesita `flowId`.
   */
  timeMs?: number;
  /** Origen de los activos locales cuando el SVG se convierte a PNG/JPG en la web. */
  assetBaseUrl?: string;
}

interface Palette {
  background: string;
  nodeFill: string;
  nodeStroke: string;
  text: string;
  textMuted: string;
  edgeLabelBg: string;
  dim: string;
}

const DARK: Palette = {
  background: '#060910',
  nodeFill: '#111a2e',
  nodeStroke: '#1e293b',
  text: '#e2e8f0',
  textMuted: '#7c8aa5',
  edgeLabelBg: '#0b1120',
  dim: '#334155',
};

const LIGHT: Palette = {
  background: '#ffffff',
  nodeFill: '#ffffff',
  nodeStroke: '#cbd5e1',
  text: '#0f172a',
  textMuted: '#64748b',
  edgeLabelBg: '#ffffff',
  dim: '#cbd5e1',
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Recorta un texto al ancho disponible, en caracteres aproximados. */
function truncate(text: string, maxWidth: number, charWidth: number): string {
  const max = Math.floor(maxWidth / charWidth);
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** Divide nombres largos (incluidos los de APIs con guiones) en dos líneas. */
function wrapLabel(text: string, maxWidth: number, charWidth: number): string[] {
  const limit = Math.max(8, Math.floor(maxWidth / charWidth));
  const words = text.replace(/-/g, '- ').trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= limit || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function absoluteBoxes(laid: LaidOutGraph): Map<string, Box> {
  const boxes = new Map<string, Box>();
  for (const zone of laid.zones) {
    for (const child of zone.children) {
      boxes.set(child.id, { ...child, x: zone.x + child.x, y: zone.y + child.y });
    }
  }
  for (const box of laid.loose) boxes.set(box.id, box);
  return boxes;
}

function renderNode(node: IrNode, box: Box, palette: Palette, dimmed: boolean, assetBaseUrl?: string): string {
  const accent = dimmed ? palette.dim : kindAccent[node.kind];
  const textColor = dimmed ? palette.dim : palette.text;
  const mutedColor = dimmed ? palette.dim : palette.textMuted;
  const renderKind = node.tags.find((tag) => tag.startsWith('drawio:render:'))?.slice('drawio:render:'.length);
  const faithfulGlyph = renderKind === 'image' || renderKind === 'annotation' || renderKind === 'label';
  const hideLabel = node.tags.includes('drawio:hide-label');
  const icon = vendorIconPath(node.tags, node.label, node.tech, node.platform);

  if (faithfulGlyph) {
    const iconSize = Math.max(8, Math.min(42, box.width, box.height));
    const iconX = box.x + (renderKind === 'annotation' ? 0 : (box.width - iconSize) / 2);
    const iconY = box.y + (box.height - iconSize) / 2;
    const parts: string[] = [];
    if (icon && assetBaseUrl) {
      const href = `${assetBaseUrl.replace(/\/$/, '')}${icon}`;
      parts.push(`<image href="${escapeXml(href)}" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet" />`);
    } else if (renderKind !== 'label') {
      parts.push(`<text x="${iconX + iconSize / 2}" y="${iconY + iconSize / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="${Math.min(12, iconSize)}" font-weight="600" fill="${accent}">${escapeXml(node.kind.charAt(0).toUpperCase())}</text>`);
    }
    const fontSize = Math.max(10, Math.min(12, box.height * 0.38));
    if (hideLabel) return parts.join('\n    ');
    if (renderKind === 'image') {
      parts.push(`<text x="${box.x + box.width / 2}" y="${box.y + box.height + fontSize + 2}" text-anchor="middle" font-family="${FONT}" font-size="${fontSize}" font-weight="600" fill="${textColor}">${escapeXml(node.label)}</text>`);
    } else {
      const labelX = renderKind === 'annotation' ? iconX + iconSize + 4 : box.x;
      parts.push(`<text x="${labelX}" y="${box.y + box.height / 2 + fontSize * 0.34}" font-family="${FONT}" font-size="${fontSize}" font-weight="600" fill="${textColor}">${escapeXml(node.label)}</text>`);
    }
    return parts.join('\n    ');
  }

  // Un nodo expandido lista sus operaciones en filas bajo la cabecera, así que
  // el icono y el nombre se centran en la cabecera y no en la caja entera.
  const expanded = node.expanded && node.provides.length > 0;
  const header = expanded ? Math.min(box.height, NODE_HEADER) : box.height;

  const iconSize = 34;
  const iconX = box.x + 14;
  const iconY = box.y + (header - iconSize) / 2;
  const textX = iconX + iconSize + 11;
  const available = box.width - (textX - box.x) - 14;

  const subtitle = node.tech ?? '';
  // Sin expandir se muestra solo la primera operación, como subtítulo; expandido
  // van todas abajo y repetirla aquí sería ruido.
  const endpointText = expanded ? '' : endpointSignature(node.provides[0] ?? {});

  const labelLines = wrapLabel(node.label, available, 7.2);
  const hasThreeLines = labelLines.length > 1 || subtitle !== '' || endpointText !== '';
  const baseY = box.y + header / 2;
  const labelY = hasThreeLines ? baseY - (labelLines.length > 1 ? 13 : 9) : baseY + 4;

  const parts = [
    `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="11" ` +
      `fill="${palette.nodeFill}" stroke="${accent}" stroke-width="1.5"` +
      `${node.external ? ' stroke-dasharray="5 4"' : ''} />`,
    `<rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="9" ` +
      `fill="${accent}" fill-opacity="0.16" />`,
    labelLines
      .map(
        (line, index) =>
          `<text x="${textX}" y="${labelY + 5 + index * 14}" font-family="${FONT}" font-size="13" font-weight="600" ` +
          `fill="${textColor}">${escapeXml(line)}</text>`,
      )
      .join(''),
  ];

  if (icon && assetBaseUrl) {
    const href = `${assetBaseUrl.replace(/\/$/, '')}${icon}`;
    parts.splice(2, 0, `<image href="${escapeXml(href)}" x="${iconX + 5}" y="${iconY + 5}" width="${iconSize - 10}" height="${iconSize - 10}" preserveAspectRatio="xMidYMid meet" />`);
  } else {
    parts.splice(2, 0, `<text x="${iconX + iconSize / 2}" y="${iconY + iconSize / 2 + 5}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="600" fill="${accent}">${escapeXml(node.kind.charAt(0).toUpperCase())}</text>`);
  }

  if (subtitle) {
    parts.push(
        `<text x="${textX}" y="${labelY + 20 + (labelLines.length - 1) * 14}" font-family="${FONT}" font-size="10.5" ` +
        `fill="${mutedColor}">${escapeXml(truncate(subtitle, available, 5.8))}</text>`,
    );
  }

  if (endpointText) {
    const y = subtitle ? labelY + 33 + (labelLines.length - 1) * 14 : labelY + 20 + (labelLines.length - 1) * 14;
    parts.push(
      `<text x="${textX}" y="${y}" font-family="${MONO}" font-size="9.5" ` +
        `fill="${mutedColor}">${escapeXml(truncate(endpointText, available, 5.6))}</text>`,
    );
  }

  if (expanded) {
    const rowWidth = (box.width - 28 - Math.max(0, node.provides.length - 1) * ENDPOINT_GAP) / node.provides.length;
    node.provides.forEach((operation, index) => {
      const rowX = box.x + 14 + index * (rowWidth + ENDPOINT_GAP);
      const y = box.y + header;
      const method = operation.method ?? 'OP';
      const target = operation.path ?? operation.label ?? operation.id ?? 'operación';
      parts.push(
        `<rect x="${rowX}" y="${y}" width="${rowWidth}" height="${ENDPOINT_ROW - 4}" rx="4" ` +
          `fill="${accent}" fill-opacity="0.08" stroke="${accent}" stroke-opacity="0.4" />`,
        `<text x="${rowX + 7}" y="${y + 14.5}" font-family="${MONO}" font-size="9.5" ` +
          `font-weight="700" fill="${accent}">${escapeXml(method)}</text>`,
        `<text x="${rowX + 7 + method.length * 6.4 + 6}" y="${y + 14.5}" font-family="${MONO}" ` +
          `font-size="9.5" fill="${mutedColor}">` +
          `${escapeXml(truncate(target, rowWidth - 20 - method.length * 6.4, 5.6))}</text>`,
      );
    });
  }

  return parts.join('\n    ');
}

export async function toSvg(ir: Ir, options: SvgOptions = {}): Promise<string> {
  const { flowId, numberSteps = true, transparent = false, light = false, padding = 32, timeMs, assetBaseUrl } = options;

  const palette = light ? LIGHT : DARK;
  const laid = await computeLayout(ir);
  const boxes = absoluteBoxes(laid);
  const slots = computeSlots(boxes, slotEdgeRefs(ir));

  const flow: IrFlow | undefined = flowId
    ? ir.flows.find((candidate) => candidate.id === flowId)
    : undefined;
  const activeNodes = flow ? new Set(flow.nodeIds) : null;

  /** Número de paso por arista, para sustituir a la animación. */
  const stepLabels = new Map<string, string[]>();
  if (flow && numberSteps) {
    flow.steps.forEach((step, i) => {
      const list = stepLabels.get(step.edgeId) ?? [];
      list.push(`${i + 1}. ${step.label}${step.condition ? ` [${step.condition}]` : ''}`);
      stepLabels.set(step.edgeId, list);
    });
  }

  // Extensión real del contenido, incluidas las zonas. Draw.io suele dejar
  // cientos de píxeles de lienzo antes del primer elemento; conservarlos en
  // una exportación reduce la tipografía al pegar el PNG en una presentación.
  // Normalizamos el origen al contenido, sin tocar las coordenadas relativas.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  const extend = (box: Box) => {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  };
  for (const zone of laid.zones) extend(zone);
  for (const box of boxes.values()) extend(box);

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    minX = 0;
    minY = 0;
  }

  const width = maxX - minX + padding * 2;
  const titleHeight = 46;
  const height = maxY - minY + padding * 2 + titleHeight;

  const body: string[] = [];

  // ── Zonas ────────────────────────────────────────────────────
  for (const zoneBox of laid.zones) {
    const zone = ir.zones.find((candidate) => candidate.id === zoneBox.id.slice('zone:'.length));
    if (!zone) continue;
    const title = zone.platform ? `${zone.label} · ${zone.platform}` : zone.label;
    const boundary = !zone.label;
    body.push(
      `<rect x="${zoneBox.x}" y="${zoneBox.y}" width="${zoneBox.width}" height="${zoneBox.height}" ` +
        `rx="${boundary ? 4 : 14}" fill="${zone.color}" fill-opacity="${boundary ? '0.035' : '0.025'}" stroke="${zone.color}" ` +
        `stroke-opacity="${boundary ? '0.22' : '0.3'}" stroke-width="1"${boundary ? '' : ' stroke-dasharray="6 4"'} />`,
      ...(title ? [`<text x="${zoneBox.x + 16}" y="${zoneBox.y + 26}" font-family="${FONT}" font-size="11" ` +
        `font-weight="700" letter-spacing="1.1" fill="${zone.color}">` +
        `${escapeXml(title.toUpperCase())}</text>`] : []),
    );
  }

  // ── Aristas ──────────────────────────────────────────────────
  const labels: string[] = [];
  /** Recorrido de cada arista, para colocar encima los puntos congelados. */
  const routes = new Map<string, Point[]>();
  for (const edge of ir.edges) {
    const slot = slots.get(edge.id);
    const from = boxes.get(edge.source);
    const to = boxes.get(edge.target);
    if (!slot || !from || !to) continue;

    const inFlow = flow ? stepLabels.has(edge.id) || edge.flows.includes(flow.id) : true;
    const dimmed = flow !== undefined && !inFlow;

    const sourceAnchor = edge.layout?.sourceAnchor;
    const targetAnchor = edge.layout?.targetAnchor;
    const start = pointBelongsToBox(edge.layout?.sourcePoint, from) ? edge.layout!.sourcePoint! : (sourceAnchor
      ? { x: from.x + from.width * sourceAnchor.x, y: from.y + from.height * sourceAnchor.y }
      : anchorPoint(from, slot.sourceSide, slot.sourceIndex, slot.sourceCount));
    const end = pointBelongsToBox(edge.layout?.targetPoint, to) ? edge.layout!.targetPoint! : (targetAnchor
      ? { x: to.x + to.width * targetAnchor.x, y: to.y + to.height * targetAnchor.y }
      : anchorPoint(to, slot.targetSide, slot.targetIndex, slot.targetCount));
    const obstacles = [...boxes.values()].filter((box) => box.id !== edge.source && box.id !== edge.target);
    const importedPoints = edge.layout?.points ?? [];
    const route = importedPoints.length > 0
      ? {
          points: [start, ...importedPoints, end],
          d: `M ${[start, ...importedPoints, end].map((point) => `${point.x} ${point.y}`).join(' L ')}`,
          labelOffset: importedPoints[Math.floor(importedPoints.length / 2)] ?? {
            x: (start.x + end.x) / 2,
            y: (start.y + end.y) / 2,
          },
        }
      : routeEdge(start, slot.sourceSide, end, slot.targetSide, obstacles);
    routes.set(edge.id, route.points);

    const color = dimmed ? palette.dim : protocolColor[edge.protocol];
    const opacity = dimmed ? 0.25 : 1;

    const markerStart = edge.layout?.startArrow && edge.layout.startArrow !== 'none'
      ? ` marker-start="url(#arrow-${edge.protocol})"`
      : '';
    const markerEnd = edge.layout?.endArrow !== 'none'
      ? ` marker-end="url(#arrow-${edge.protocol})"`
      : '';
    body.push(
      `<path d="${route.d}" fill="none" stroke="${color}" stroke-width="${dimmed ? 1 : 1.8}" ` +
        `stroke-opacity="${opacity}"${markerStart}${markerEnd}` +
        `${edge.async ? ' stroke-dasharray="6 5"' : ''} />`,
    );

    if (dimmed) continue;

    const labelsForEdge = stepLabels.get(edge.id) ?? edge.labels.filter((label) => label.toLowerCase() !== edge.protocol);
    const text = labelsForEdge.join(' · ');
    if (!text) continue;

    const clipped = truncate(text, 230, 5.6);
    const labelWidth = clipped.length * 5.6 + 12;
    const zoneHeaders = laid.zones.map((zone) => ({ x: zone.x, y: zone.y, width: zone.width, height: 44 }));
    const at = placeEdgeLabel(route.points, [...boxes.values(), ...zoneHeaders], labelWidth, 18);
    labels.push(
      `<g>` +
        `<rect x="${(at.x - labelWidth / 2).toFixed(1)}" y="${(at.y - 9).toFixed(1)}" ` +
        `width="${labelWidth.toFixed(1)}" height="18" rx="5" fill="${palette.edgeLabelBg}" ` +
        `stroke="${color}" stroke-opacity="0.35" />` +
        `<text x="${at.x.toFixed(1)}" y="${(at.y + 3.5).toFixed(1)}" ` +
        `text-anchor="middle" font-family="${MONO}" font-size="10" fill="${color}">` +
        `${escapeXml(clipped)}</text>` +
        `</g>`,
    );
  }

  // ── Nodos ────────────────────────────────────────────────────
  for (const node of ir.nodes) {
    const box = boxes.get(node.id);
    if (!box) continue;
    body.push(renderNode(node, box, palette, activeNodes !== null && !activeNodes.has(node.id), assetBaseUrl));
  }

  // ── Paquetes congelados ──────────────────────────────────────
  // Encima de las aristas y debajo de las etiquetas, igual que en el lienzo.
  if (timeMs !== undefined && flow) {
    for (const dot of buildDots(flow, ir.animation)) {
      const progress = dotProgress(dot, flow, ir.animation, timeMs);
      const points = routes.get(dot.edgeId);
      if (progress === null || !points) continue;

      const { x, y } = pointAlong(points, progress);
      const { opacity, scale } = dotFade(dot, ir.animation);
      const color = protocolColor[dot.protocol];
      const radius = 5.5 * scale;

      // El halo del lienzo es un `box-shadow`; aquí es un círculo detrás, que
      // es lo que sobrevive a la rasterización y a los 256 colores del GIF.
      body.push(
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(radius * 2.1).toFixed(1)}" ` +
          `fill="${color}" fill-opacity="${(opacity * 0.18).toFixed(2)}" />`,
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" ` +
          `fill="${color}" fill-opacity="${opacity.toFixed(2)}" />`,
      );
    }
  }

  // Las etiquetas van al final para que ninguna arista las tape.
  body.push(...labels);

  const markers = [...new Set(ir.edges.map((edge) => edge.protocol))]
    .map(
      (protocol) =>
        `<marker id="arrow-${protocol}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" ` +
        `markerHeight="6" orient="auto-start-reverse">` +
        `<path d="M 0 0 L 10 5 L 0 10 z" fill="${protocolColor[protocol]}" /></marker>`,
    )
    .join('\n    ');

  const subtitle = flow ? flow.label : ir.meta.description ?? '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">
  <defs>
    ${markers}
  </defs>
  ${transparent ? '' : `<rect width="${width}" height="${height}" fill="${palette.background}" />`}
  <text x="${padding}" y="${padding}" font-size="16" font-weight="650" fill="${palette.text}">${escapeXml(ir.meta.name)}</text>
  ${subtitle ? `<text x="${padding}" y="${padding + 19}" font-size="11.5" fill="${palette.textMuted}">${escapeXml(truncate(subtitle, width - padding * 2, 6))}</text>` : ''}
  <g transform="translate(${padding - minX}, ${padding + titleHeight - minY})">
    ${body.join('\n    ')}
  </g>
</svg>
`;
}
