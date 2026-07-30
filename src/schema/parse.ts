import { LineCounter, parseDocument, isNode, type Document } from 'yaml';
import { DiagramSchema, type Diagram } from './schema.js';

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  /** Ruta dentro del documento, p.ej. `['flows', 0, 'steps', 2, 'to']`. */
  path?: (string | number)[];
  line?: number;
  column?: number;
}

export interface ParseResult {
  ok: boolean;
  diagram?: Diagram;
  issues: Issue[];
}

/** Formatea `['flows', 0, 'steps', 2, 'to']` como `flows[0].steps[2].to`. */
export function formatPath(path: (string | number)[]): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    return acc ? `${acc}.${part}` : part;
  }, '');
}

/**
 * Localiza una ruta lógica en el documento YAML para poder señalar línea y
 * columna. Si el nodo exacto no existe (p.ej. una clave que falta), sube por
 * la ruta hasta encontrar el ancestro más cercano.
 */
function locate(
  doc: Document.Parsed,
  counter: LineCounter,
  path: (string | number)[],
): { line?: number; column?: number } {
  for (let i = path.length; i >= 0; i--) {
    const candidate = path.slice(0, i);
    const node = candidate.length === 0 ? doc.contents : doc.getIn(candidate, true);
    if (isNode(node) && node.range) {
      const pos = counter.linePos(node.range[0]);
      return { line: pos.line, column: pos.col };
    }
  }
  return {};
}

/**
 * Reglas que el esquema estructural no puede expresar: unicidad de ids e
 * integridad de las referencias cruzadas. Son la mayoría de los errores reales
 * al escribir un diagrama a mano o generarlo con un agente.
 */
function validateSemantics(diagram: Diagram): Issue[] {
  const issues: Issue[] = [];

  const nodeIds = new Set<string>();
  diagram.nodes.forEach((node, i) => {
    if (nodeIds.has(node.id)) {
      issues.push({
        level: 'error',
        message: `el nodo '${node.id}' está declarado más de una vez`,
        path: ['nodes', i, 'id'],
      });
    }
    nodeIds.add(node.id);
  });

  const zoneIds = new Set<string>();
  diagram.zones.forEach((zone, i) => {
    if (zoneIds.has(zone.id)) {
      issues.push({
        level: 'error',
        message: `la zona '${zone.id}' está declarada más de una vez`,
        path: ['zones', i, 'id'],
      });
    }
    zoneIds.add(zone.id);
  });

  diagram.nodes.forEach((node, i) => {
    if (node.zone && !zoneIds.has(node.zone)) {
      issues.push({
        level: 'error',
        message: `el nodo '${node.id}' referencia la zona '${node.zone}', que no está declarada en 'zones'`,
        path: ['nodes', i, 'zone'],
      });
    }
  });

  /** Nodos tocados por algún flujo o arista, para detectar los huérfanos. */
  const referenced = new Set<string>();

  const checkRef = (id: string, path: (string | number)[], context: string) => {
    referenced.add(id);
    if (!nodeIds.has(id)) {
      issues.push({
        level: 'error',
        message: `${context} referencia el nodo '${id}', que no existe en 'nodes'`,
        path,
      });
      return false;
    }
    return true;
  };

  const flowIds = new Set<string>();
  diagram.flows.forEach((flow, fi) => {
    if (flowIds.has(flow.id)) {
      issues.push({
        level: 'error',
        message: `el flujo '${flow.id}' está declarado más de una vez`,
        path: ['flows', fi, 'id'],
      });
    }
    flowIds.add(flow.id);

    if (flow.entry) {
      checkRef(flow.entry, ['flows', fi, 'entry'], `el flujo '${flow.id}'`);
    }

    if (flow.steps.length === 0) {
      issues.push({
        level: 'warning',
        message: `el flujo '${flow.id}' no tiene pasos; no habrá nada que animar`,
        path: ['flows', fi, 'id'],
      });
    }

    flow.steps.forEach((step, si) => {
      const where = `el paso ${si + 1} del flujo '${flow.id}'`;
      checkRef(step.from, ['flows', fi, 'steps', si, 'from'], where);
      checkRef(step.to, ['flows', fi, 'steps', si, 'to'], where);
      if (step.from === step.to) {
        issues.push({
          level: 'warning',
          message: `${where} va de '${step.from}' a sí mismo; se dibujará como un bucle`,
          path: ['flows', fi, 'steps', si],
        });
      }
    });
  });

  diagram.edges.forEach((edge, i) => {
    checkRef(edge.from, ['edges', i, 'from'], `la arista ${i + 1}`);
    checkRef(edge.to, ['edges', i, 'to'], `la arista ${i + 1}`);
  });

  diagram.nodes.forEach((node, i) => {
    if (!referenced.has(node.id)) {
      issues.push({
        level: 'warning',
        message: `el nodo '${node.id}' no participa en ningún flujo ni arista; aparecerá suelto en el diagrama`,
        path: ['nodes', i, 'id'],
      });
    }
  });

  if (diagram.flows.length === 0) {
    issues.push({
      level: 'warning',
      message: 'el diagrama no tiene flujos: se verá la topología pero no habrá nada que animar',
    });
  }

  return issues;
}

/** Parsea y valida un `.arch.yaml`, con línea y columna en cada problema. */
export function parseDiagram(source: string): ParseResult {
  const counter = new LineCounter();
  const doc = parseDocument(source, { lineCounter: counter });

  if (doc.errors.length > 0) {
    return {
      ok: false,
      issues: doc.errors.map((err) => {
        const pos = counter.linePos(err.pos[0]);
        return {
          level: 'error' as const,
          message: `YAML mal formado: ${err.message.split('\n')[0]}`,
          line: pos.line,
          column: pos.col,
        };
      }),
    };
  }

  const raw = doc.toJS();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [{ level: 'error', message: 'el fichero debe contener un objeto YAML en la raíz' }],
    };
  }

  const parsed = DiagramSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        level: 'error' as const,
        message: issue.path.length > 0 ? `${formatPath(issue.path)}: ${issue.message}` : issue.message,
        path: issue.path as (string | number)[],
        ...locate(doc, counter, issue.path as (string | number)[]),
      })),
    };
  }

  const semantic = validateSemantics(parsed.data).map((issue) => ({
    ...issue,
    ...(issue.path ? locate(doc, counter, issue.path) : {}),
  }));

  return {
    ok: !semantic.some((issue) => issue.level === 'error'),
    diagram: parsed.data,
    issues: semantic,
  };
}
