import { findAll, findFirst, parseXml, type XmlNode } from './xml.js';
import { guessKind, type ImportEvidence, type ImportedShape } from './evidence.js';
import type { NodeKind } from '../schema/schema.js';

/**
 * Lectura del *ArchiMate Model Exchange File Format*.
 *
 * Aquí sí hay semántica —el fichero dice que algo es un ApplicationComponent—,
 * así que la deducción es mucho más firme que con un `.drawio`. Lo que se
 * pierde en el viaje es lo que ArchiFlow tiene y ArchiMate no: el orden de los
 * pasos de un flujo. Las relaciones se importan como un flujo sin orden fiable,
 * y se avisa.
 *
 * La tabla es la inversa de la del exportador (ADR-003, D4). No es biyectiva:
 * varios tipos nuestros van al mismo tipo de ArchiMate, así que al volver se
 * elige el más común y el resto se afina por el texto.
 */

const ELEMENT_KIND: Record<string, NodeKind> = {
  ApplicationComponent: 'service',
  ApplicationCollaboration: 'service',
  ApplicationService: 'gateway',
  ApplicationInterface: 'gateway',
  DataObject: 'database',
  Artifact: 'storage',
  SystemSoftware: 'cache',
  TechnologyService: 'broker',
  Node: 'external',
  Device: 'external',
  BusinessActor: 'client',
  BusinessRole: 'client',
  BusinessService: 'external',
};

const GROUPINGS = new Set(['Grouping', 'Location', 'Container']);

function nameOf(node: XmlNode): string {
  return findFirst([node], 'name')?.text ?? node.attrs.name ?? node.attrs.identifier ?? '';
}

/** `xsi:type` sin el prefijo del espacio de nombres ni el sufijo de Archi. */
function typeOf(node: XmlNode): string {
  const raw = node.attrs['xsi:type'] ?? node.attrs.type ?? '';
  return raw.replace(/^.*:/, '').replace(/Relationship$/, '');
}

export function fromArchimate(source: string): ImportEvidence {
  const evidence: ImportEvidence = { format: 'archimate', pages: [], shapes: [], links: [], warnings: [] };
  const document = parseXml(source);

  // La geometría, si el fichero trae vista, evita recolocarlo todo a ciegas.
  const geometry = new Map<string, { x: number; y: number; width: number; height: number; parent?: string }>();
  for (const view of findAll(document, 'view')) {
    const collect = (node: XmlNode, parent?: string) => {
      for (const child of node.children) {
        if (child.tag !== 'node') continue;
        const ref = child.attrs.elementRef;
        if (ref) {
          geometry.set(ref, {
            x: Number(child.attrs.x ?? 0),
            y: Number(child.attrs.y ?? 0),
            width: Number(child.attrs.w ?? 0),
            height: Number(child.attrs.h ?? 0),
            parent,
          });
        }
        collect(child, ref ?? parent);
      }
    };
    collect(view);
    evidence.pages.push({
      id: view.attrs.identifier ?? 'view',
      name: nameOf(view) || 'Vista',
      shapes: [...geometry.keys()],
    });
  }

  for (const element of findAll(document, 'element')) {
    const id = element.attrs.identifier;
    if (!id) continue;
    const type = typeOf(element);
    const label = nameOf(element);
    const box = geometry.get(id);
    const mapped = ELEMENT_KIND[type];

    // Con el tipo declarado se parte de él y solo se afina por el texto; sin
    // él —un tipo que no está en la tabla— se deduce como en draw.io.
    const guess = guessKind(label, '');
    const kind = mapped ?? guess.kind;
    const refined = mapped && guess.confidence !== 'baja' && refines(mapped, guess.kind) ? guess.kind : kind;

    const shape: ImportedShape = {
      id,
      label,
      style: `archimate:${type}`,
      x: box?.x ?? 0,
      y: box?.y ?? 0,
      width: box?.width ?? 0,
      height: box?.height ?? 0,
      parent: box?.parent,
      container: GROUPINGS.has(type),
      kind: refined,
      confidence: mapped ? 'alta' : 'baja',
      reason: mapped
        ? refined === mapped
          ? `el fichero lo declara ${type}`
          : `el fichero lo declara ${type} y el texto lo concreta`
        : `tipo '${type}' sin equivalente; se asume ${kind}`,
      external: type === 'Node' || type === 'Device',
    };

    if (!mapped) evidence.warnings.push(`'${label || id}' es un ${type}, que no está en la tabla del ADR-003: se importa como '${shape.kind}'.`);
    evidence.shapes.push(shape);
  }

  const grouped = new Set<string>();
  for (const relationship of findAll(document, 'relationships').flatMap((node) => node.children)) {
    const type = typeOf(relationship);
    const source_ = relationship.attrs.source;
    const target = relationship.attrs.target;
    if (!source_ || !target) continue;

    // Composición desde un Grouping es pertenencia a una zona, no un paso.
    if (type === 'Composition' || type === 'Aggregation') {
      const container = evidence.shapes.find((shape) => shape.id === source_);
      if (container?.container) {
        const child = evidence.shapes.find((shape) => shape.id === target);
        if (child && !grouped.has(child.id)) {
          child.parent = container.id;
          grouped.add(child.id);
        }
        continue;
      }
    }

    evidence.links.push({
      id: relationship.attrs.identifier ?? `${source_}__${target}`,
      label: nameOf(relationship),
      source: source_,
      target,
      style: `archimate:${type}`,
      protocol: type === 'Triggering' || type === 'Flow' ? 'kafka' : 'http',
      async: type === 'Triggering' || type === 'Flow',
    });
  }

  if (evidence.links.length > 0) {
    evidence.warnings.push(
      'ArchiMate no guarda el orden de un recorrido: los pasos salen en el orden del fichero y casi seguro hay que reordenarlos.',
    );
  }

  return evidence;
}

/** El texto solo puede concretar dentro de la misma familia, no contradecir. */
function refines(declared: NodeKind, guessed: NodeKind): boolean {
  const families: NodeKind[][] = [
    ['service', 'frontend', 'client', 'job', 'component', 'external'],
    ['database', 'storage'],
    ['cache', 'broker'],
    ['gateway', 'service'],
  ];
  return families.some((family) => family.includes(declared) && family.includes(guessed));
}
