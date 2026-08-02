import type { NodeKind, Protocol } from '../schema/schema.js';

/**
 * Evidencias de importación: lo que se ha leído del fichero, separado de lo que
 * se ha deducido.
 *
 * Es el mismo reparto que en el escaneo de código (ver ADR-001): el CLI
 * recolecta hechos y una skill decide qué significan. Un `.drawio` tiene
 * geometría y estilos, no semántica; qué es un servicio y qué una base de datos
 * hay que deducirlo, y hay que **decir que se ha deducido** en vez de fingir
 * precisión. Por eso cada forma viaja con su estilo crudo, la deducción, la
 * confianza y el motivo: quien lo revise puede corregir sin abrir el original.
 */

export type Confidence = 'alta' | 'media' | 'baja';
/** Qué aporta una celda al plano visible, separado de su papel geométrico. */
export type CellRenderKind = 'invisible-group' | 'visible-container' | 'component' | 'label' | 'image' | 'annotation';

export interface ImportedShape {
  id: string;
  label: string;
  /** El estilo tal cual venía. Es la prueba de la que sale la deducción. */
  style: string;
  /** Icono de librería de draw.io, normalizado (p.ej. `azure-cosmos-db`). */
  drawioIcon?: string;
  /** El glifo y el rótulo viven en mxCells hermanos; no se duplica el texto. */
  hideLabel?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Id del contenedor, si estaba dentro de otro. */
  parent?: string;
  /** Carril, grupo o contenedor: candidato a zona. */
  container: boolean;
  /** Un grupo lógico conserva coordenadas aunque no genere ningún píxel. */
  renderKind: CellRenderKind;
  kind: NodeKind;
  confidence: Confidence;
  /** Por qué se dedujo ese tipo. Se muestra en la salida. */
  reason: string;
  external: boolean;
}

export interface ImportedLink {
  id: string;
  label: string;
  source?: string;
  target?: string;
  /** Padre mxGraph, útil para diagnosticar enlaces anidados. */
  parent?: string;
  style: string;
  protocol: Protocol;
  async: boolean;
  /** Orden declarado en la etiqueta (`1.2 Obtener saldo`), si lo había. */
  order?: number;
  /** Ruta declarada por mxGeometry, en coordenadas de lienzo. */
  geometry?: {
    sourcePoint?: { x: number; y: number };
    targetPoint?: { x: number; y: number };
    points: { x: number; y: number }[];
  };
  anchors?: {
    source?: { x: number; y: number };
    target?: { x: number; y: number };
  };
  startArrow?: string;
  endArrow?: string;
}

export interface ImportEvidence {
  format: 'drawio' | 'archimate';
  /** Nombre de la página o vista de la que salió cada cosa. */
  pages: { id: string; name: string; shapes: string[] }[];
  shapes: ImportedShape[];
  links: ImportedLink[];
  /** Todo lo deducido o descartado. No solo los fallos. */
  warnings: string[];
}

/** Tokens `clave=valor` de un estilo de mxGraph, en minúsculas. */
export function styleTokens(style: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const part of style.split(';')) {
    if (!part) continue;
    const at = part.indexOf('=');
    if (at === -1) tokens.set(part.trim().toLowerCase(), '');
    else tokens.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  return tokens;
}

/** Reglas por forma. La primera que casa manda, y son de confianza alta. */
const SHAPE_RULES: { match: RegExp; kind: NodeKind; why: string }[] = [
  { match: /cylinder|datastore|mxgraph\.flowchart\.database|shape=database/i, kind: 'database', why: 'forma de cilindro' },
  { match: /appType=passive/i, kind: 'database', why: 'DataObject de ArchiMate' },
  { match: /appType=sysSw/i, kind: 'cache', why: 'SystemSoftware de ArchiMate' },
  { match: /appType=serv/i, kind: 'gateway', why: 'Service de ArchiMate' },
  { match: /appType=node|appType=device/i, kind: 'external', why: 'Node tecnológico de ArchiMate' },
  { match: /hexagon/i, kind: 'gateway', why: 'forma de hexágono' },
  { match: /ellipse|shape=circle/i, kind: 'job', why: 'forma de elipse' },
  { match: /rhombus/i, kind: 'component', why: 'forma de rombo' },
  { match: /actor|shape=umlActor/i, kind: 'client', why: 'figura de actor' },
  { match: /mxgraph\.mockup|shape=mxgraph\.android|shape=mxgraph\.ios/i, kind: 'client', why: 'maqueta de pantalla' },
];

/**
 * Los iconos de las librerías de draw.io expresan semántica, no solo estilo.
 * No cargamos su SVG propietario en el lienzo local, pero sí conservamos su
 * nombre y lo traducimos a la familia visual equivalente de ArchiFlow.
 */
const ICON_RULES: { match: RegExp; kind: NodeKind; why: string }[] = [
  { match: /cosmos|sql[-_ ]?database|postgres|mysql|mariadb|oracle|firestore|mongodb/i, kind: 'database', why: 'icono de base de datos de draw.io' },
  { match: /redis|cache|memcache/i, kind: 'cache', why: 'icono de caché de draw.io' },
  { match: /event[-_ ]?hub|service[-_ ]?bus|kafka|rabbit|queue|topic/i, kind: 'broker', why: 'icono de mensajería de draw.io' },
  { match: /api[-_ ]?management|api[-_ ]?gateway|application[-_ ]?gateway|front[-_ ]?door|load[-_ ]?balanc|firewall|waf|ingress/i, kind: 'gateway', why: 'icono de gateway de draw.io' },
  { match: /blob|storage|bucket|file[-_ ]?share/i, kind: 'storage', why: 'icono de almacenamiento de draw.io' },
  { match: /android|ios|mobile|phone/i, kind: 'client', why: 'icono de cliente de draw.io' },
  { match: /web[-_ ]?app|static[-_ ]?web|browser/i, kind: 'frontend', why: 'icono de frontend de draw.io' },
  { match: /kubernetes[-_ ]?services|app[-_ ]?service|function|container[-_ ]?app/i, kind: 'service', why: 'icono de servicio de draw.io' },
];

/** Reglas por texto. Refinan la forma, y son de confianza media. */
const TEXT_RULES: { match: RegExp; kind: NodeKind; why: string }[] = [
  { match: /\bkafka\b|\bmq\b|rabbit|event ?hub|broker|t[oó]pic/i, kind: 'broker', why: 'el texto nombra un broker' },
  { match: /redis|hazelcast|memcach|\bcach[eé]\b/i, kind: 'cache', why: 'el texto nombra una caché' },
  { match: /oracle|postgres|mysql|db2|mongo|cosmos|firestore|\bsql\b|\bbd\b|\bbbdd\b|\bbase de datos\b/i, kind: 'database', why: 'el texto nombra una base de datos' },
  { match: /gateway|apim|\bapigw\b|ingress|balanceador|\bwaf\b/i, kind: 'gateway', why: 'el texto nombra un gateway' },
  { match: /bucket|\bs3\b|blob|almacen|storage|ficher/i, kind: 'storage', why: 'el texto nombra almacenamiento' },
  { match: /\bbatch\b|\bcron\b|scheduler|\bjob\b|proceso nocturno/i, kind: 'job', why: 'el texto nombra un proceso batch' },
  { match: /\bcore\b|legac|as\/?400|host\b|mainframe/i, kind: 'external', why: 'el texto sugiere un sistema legado' },
  { match: /\bapp\b|m[oó]vil|mobile|android|\bios\b|canal\b|usuari|cliente final/i, kind: 'client', why: 'el texto nombra un canal' },
  { match: /\bweb\b|\bspa\b|portal|frontend|angular|react\b/i, kind: 'frontend', why: 'el texto nombra un frontend' },
  { match: /\bbff\b|micro|servicio|\bms-|\bsvc\b|api\b/i, kind: 'service', why: 'el texto nombra un servicio' },
];

export interface KindGuess {
  kind: NodeKind;
  confidence: Confidence;
  reason: string;
}

/** Extrae y normaliza la ruta de un icono de una librería draw.io. */
export function drawioIconName(style: string): string | undefined {
  const image = styleTokens(style).get('image');
  if (!image || image.startsWith('data:')) return undefined;
  const file = image.replace(/\\/g, '/').split('/').at(-1)?.replace(/\.svg$/i, '');
  return file
    ?.replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Tecnología breve para que el icono importado siga siendo visible en el nodo. */
export function techForDrawioIcon(icon?: string): string | undefined {
  if (!icon) return undefined;
  const names: Record<string, string> = {
    'azure-cosmos-db': 'Azure Cosmos DB',
    firestore: 'Firestore',
    'event-hubs': 'Azure Event Hubs',
    'api-management': 'Azure API Management',
    'application-gateway': 'Application Gateway',
    'front-doors': 'Azure Front Door',
    'kubernetes-services': 'Kubernetes Service',
    firewall: 'Firewall / WAF',
    mobile: 'Mobile client',
  };
  return names[icon];
}

/**
 * Deduce el tipo de una caja a partir de su forma y su texto.
 *
 * El texto manda sobre la forma cuando ambos opinan: un rectángulo que pone
 * "Kafka" es un broker aunque nadie le pusiera el hexágono, mientras que un
 * cilindro sin texto útil solo puede ser una base de datos. Se devuelve el
 * motivo para poder enseñarlo: quien revise el borrador necesita saber de dónde
 * salió cada decisión.
 */
export function guessKind(label: string, style: string): KindGuess {
  // En los diagramas del banco «API UX» y «API BS» son aplicaciones; que una
  // de ellas contenga la palabra "channel" no la convierte en un canal humano.
  if (/«?api\s+(ux|bs)»?/i.test(label)) {
    return { kind: 'service', confidence: 'alta', reason: 'convención «API UX/BS» de aplicación' };
  }
  const byText = TEXT_RULES.find((rule) => rule.match.test(label));
  const icon = drawioIconName(style);
  const byIcon = icon && ICON_RULES.find((rule) => rule.match.test(icon));
  const byShape = SHAPE_RULES.find((rule) => rule.match.test(style));

  if (byText && byIcon) {
    // "API Management" activa la regla genérica de servicio por "API", pero
    // el icono de la librería es una prueba mucho más específica de gateway.
    if (byText.kind === 'service' && byIcon.kind !== 'service') {
      return { kind: byIcon.kind, confidence: 'alta', reason: `${byIcon.why} (más específico que el texto genérico)` };
    }
    return byText.kind === byIcon.kind
      ? { kind: byText.kind, confidence: 'alta', reason: `${byIcon.why} y ${byText.why}` }
      : { kind: byText.kind, confidence: 'media', reason: `${byText.why} (el ${byIcon.why} sugería '${byIcon.kind}')` };
  }
  if (byText && byShape) {
    return byText.kind === byShape.kind
      ? { kind: byText.kind, confidence: 'alta', reason: `${byShape.why} y ${byText.why}` }
      : { kind: byText.kind, confidence: 'media', reason: `${byText.why} (la ${byShape.why} sugería '${byShape.kind}')` };
  }
  if (byIcon) return { kind: byIcon.kind, confidence: 'alta', reason: byIcon.why };
  if (byShape) return { kind: byShape.kind, confidence: 'alta', reason: byShape.why };
  if (byText) return { kind: byText.kind, confidence: 'media', reason: byText.why };
  return { kind: 'service', confidence: 'baja', reason: 'sin pistas de forma ni de texto; se asume servicio' };
}

const PROTOCOL_RULES: { match: RegExp; protocol: Protocol }[] = [
  { match: /\bhttps\b|\btls\b|\bssl\b/i, protocol: 'https' },
  { match: /\bgrpc\b/i, protocol: 'grpc' },
  { match: /graphql/i, protocol: 'graphql' },
  { match: /\bsoap\b|\bwsdl\b|\bxml\b/i, protocol: 'soap' },
  { match: /kafka|\bevent\b|publish|consume|t[oó]pic/i, protocol: 'kafka' },
  { match: /\bamqp\b|rabbit/i, protocol: 'amqp' },
  { match: /\bjms\b/i, protocol: 'jms' },
  { match: /\bmq\b/i, protocol: 'mq' },
  { match: /\bjdbc\b/i, protocol: 'jdbc' },
  { match: /select|insert|update |delete |\bsql\b/i, protocol: 'sql' },
  { match: /redis|\bget \w+:|\bcach[eé]\b/i, protocol: 'redis' },
  { match: /\bhttp\b|\brest\b|\bget\b|\bpost\b|\bput\b|\bpatch\b|\bdelete\b|^\//i, protocol: 'http' },
];

export function guessProtocol(label: string, style: string): Protocol {
  const haystack = `${label} ${style}`;
  return PROTOCOL_RULES.find((rule) => rule.match.test(haystack))?.protocol ?? 'http';
}

/**
 * Orden declarado en la etiqueta: `1.2 Obtener saldo` → 1.2.
 *
 * Un diagrama estático es un grafo sin secuencia, y un flujo de ArchiFlow es
 * una secuencia. Cuando quien dibujó numeró los pasos —que es lo habitual en
 * los diagramas de banca— esa numeración es la única fuente fiable del orden.
 */
export function parseOrder(label: string): number | undefined {
  const match = ORDER_PREFIX.exec(label);
  if (!match) return undefined;
  return Number(match[1]) * 1000 + Number(match[2] ?? 0);
}

const ORDER_PREFIX = /^\s*(\d+)(?:[.-](\d+))?\s*[.)\-:]?\s/;

/**
 * Quita el número del principio de la etiqueta: ArchiFlow numera los pasos él
 * solo a partir del orden del flujo, y dejarlo daría "3. 3. GET /cuentas".
 */
export function stripOrder(label: string): string {
  return label.replace(ORDER_PREFIX, '').trim();
}
