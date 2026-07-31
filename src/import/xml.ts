/**
 * Lector de XML mínimo, suficiente para mxGraph y para el formato de
 * intercambio de ArchiMate.
 *
 * Existe en vez de una dependencia porque los dos formatos que hay que leer son
 * planos —elementos con atributos y, como mucho, un nivel de anidamiento con
 * texto— y el proyecto no tiene ninguna dependencia de parseo. Un lector de 90
 * líneas que se entiende de una lectura pesa menos que un árbol de paquetes.
 *
 * **No es un parser conforme**: ignora espacios de nombres, DTD y entidades que
 * no sean las cinco predefinidas. Para lo que hace falta aquí basta; para
 * cualquier otra cosa, no lo uses.
 */

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Texto directo del elemento, ya sin escapar y recortado. */
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function unescapeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? match;
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[match[1]!] = unescapeXml(match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/** Devuelve los elementos de primer nivel del documento. */
export function parseXml(source: string): XmlNode[] {
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const push = (node: XmlNode) => (stack[stack.length - 1]?.children ?? roots).push(node);

  // Un solo recorrido: cada `<...>` es una etiqueta y lo de en medio es texto.
  const tags = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!\w[\s\S]*?>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

  let cursor = 0;
  for (const match of source.matchAll(tags)) {
    const parent = stack[stack.length - 1];
    if (parent) {
      const between = source.slice(cursor, match.index);
      if (between.trim()) parent.text += unescapeXml(between);
    }
    cursor = match.index + match[0].length;

    const [, cdata, closing, opening, attributes, selfClosing] = match;

    if (cdata !== undefined) {
      if (parent) parent.text += cdata;
      continue;
    }

    if (closing !== undefined) {
      // Cierre desemparejado: se ignora en vez de tirar el documento entero.
      const index = stack.map((node) => node.tag).lastIndexOf(closing);
      if (index !== -1) stack.length = index;
      continue;
    }

    if (opening === undefined) continue;

    const node: XmlNode = { tag: opening, attrs: parseAttributes(attributes ?? ''), children: [], text: '' };
    push(node);
    if (!selfClosing) stack.push(node);
  }

  for (const node of walk(roots)) node.text = node.text.trim();
  return roots;
}

/** Recorrido en profundidad, incluidos los propios nodos dados. */
export function* walk(nodes: XmlNode[]): Generator<XmlNode> {
  for (const node of nodes) {
    yield node;
    yield* walk(node.children);
  }
}

/** Todos los descendientes con esa etiqueta, en orden de aparición. */
export function findAll(nodes: XmlNode[], tag: string): XmlNode[] {
  return [...walk(nodes)].filter((node) => node.tag === tag);
}

export function findFirst(nodes: XmlNode[], tag: string): XmlNode | undefined {
  for (const node of walk(nodes)) if (node.tag === tag) return node;
  return undefined;
}
