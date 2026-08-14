import type { Ir, IrEdge, IrFlow, IrNode, IrZone } from './compile.js';

export interface IrSource {
  id: string;
  name: string;
  ir: Ir;
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

/**
 * Construye la vista virtual "Todos los flujos" sin reescribir los YAML.
 * Los componentes con el mismo id se consideran el mismo elemento; los ids de
 * flujo sí se prefijan con el fichero para que dos repositorios puedan declarar
 * `consulta-cliente` sin pisarse. La geometría se recalcula porque las
 * coordenadas de documentos independientes no comparten un lienzo.
 */
export function mergeIrs(sources: IrSource[]): Ir {
  if (sources.length === 0) throw new Error('se necesita al menos un diagrama para consolidar');

  const first = sources[0]!.ir;
  const zones = new Map<string, IrZone>();
  const nodes = new Map<string, IrNode>();
  const edges = new Map<string, IrEdge>();
  const flows: IrFlow[] = [];

  for (const source of sources) {
    const flowIds = new Map(source.ir.flows.map((flow) => [flow.id, `${source.id}--${flow.id}`]));

    for (const zone of source.ir.zones) {
      const current = zones.get(zone.id);
      zones.set(zone.id, current
        ? { ...current, nodeIds: uniqueBy([...current.nodeIds, ...zone.nodeIds], (id) => id), layout: undefined }
        : { ...zone, nodeIds: [...zone.nodeIds], layout: undefined });
    }

    for (const node of source.ir.nodes) {
      const current = nodes.get(node.id);
      nodes.set(node.id, current
        ? {
            ...current,
            label: current.label === current.id && node.label !== node.id ? node.label : current.label,
            tech: current.tech ?? node.tech,
            description: current.description ?? node.description,
            repo: current.repo ?? node.repo,
            tags: uniqueBy([...current.tags, ...node.tags], (tag) => tag),
            topics: uniqueBy([...current.topics, ...node.topics], (topic) => topic),
            provides: uniqueBy(
              [...current.provides, ...node.provides],
              (operation) => operation.id ?? `${operation.method ?? ''}:${operation.path ?? operation.label ?? ''}`,
            ),
            expanded: current.expanded || node.expanded,
            layout: undefined,
          }
        : { ...node, tags: [...node.tags], topics: [...node.topics], provides: [...node.provides], layout: undefined, degree: 0 });
    }

    for (const edge of source.ir.edges) {
      const mappedFlows = edge.flows.map((id) => flowIds.get(id) ?? `${source.id}--${id}`);
      const current = edges.get(edge.id);
      edges.set(edge.id, current
        ? {
            ...current,
            labels: uniqueBy([...current.labels, ...edge.labels], (label) => label),
            flows: uniqueBy([...current.flows, ...mappedFlows], (id) => id),
            declaredOnly: current.declaredOnly && edge.declaredOnly,
            async: current.async && edge.async,
            layout: undefined,
          }
        : { ...edge, labels: [...edge.labels], flows: mappedFlows, layout: undefined });
    }

    for (const flow of source.ir.flows) {
      flows.push({
        ...flow,
        id: flowIds.get(flow.id)!,
        label: `${flow.label} · ${source.name}`,
        description: [flow.description, `Origen: ${source.name}`].filter(Boolean).join(' · '),
        steps: flow.steps.map((step) => ({ ...step, labelPosition: undefined, layout: undefined })),
        nodeIds: [...flow.nodeIds],
      });
    }
  }

  for (const edge of edges.values()) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source) source.degree += 1;
    if (target) target.degree += 1;
  }
  for (const zone of zones.values()) {
    zone.nodeIds = [...nodes.values()].filter((node) => node.zone === zone.id).map((node) => node.id);
  }

  return {
    meta: {
      name: 'Todos los flujos',
      description: `${flows.length} flujos consolidados desde ${sources.length} archivos YAML`,
      view: 'architecture',
      layoutMode: 'auto',
    },
    animation: first.animation,
    zones: [...zones.values()],
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    flows,
  };
}

/** Reduce una vista consolidada al recorrido activo sin perder su contrato. */
export function focusIrOnFlow(ir: Ir, flowId: string): Ir {
  const flow = ir.flows.find((candidate) => candidate.id === flowId);
  if (!flow) return ir;
  const nodeIds = new Set(flow.nodeIds);
  const edgeIds = new Set(flow.steps.map((step) => step.edgeId));
  const edges = ir.edges.filter((edge) => edgeIds.has(edge.id));
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return {
    ...ir,
    zones: ir.zones
      .map((zone) => ({ ...zone, nodeIds: zone.nodeIds.filter((id) => nodeIds.has(id)) }))
      .filter((zone) => zone.nodeIds.length > 0),
    nodes: ir.nodes.filter((node) => nodeIds.has(node.id)).map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 })),
    edges,
    flows: [flow],
  };
}
