import type { Issue } from './parse.js';
import type { Diagram, Step } from './schema.js';

const CHANNEL_KINDS = new Set(['client', 'frontend', 'gateway']);
const TRIVIAL_RESPONSE = /^(?:ok|miss|hit|sin body(?: \(\d+\))?)$/i;

function nodeId(reference: string): string {
  return reference.split('/')[0]!;
}

function hasOperation(reference: string): boolean {
  return reference.includes('/');
}

function reverseOf(left: Step, right: Step): boolean {
  return left.from === right.to && left.to === right.from;
}

/**
 * Auditor estricto para artefactos producidos por `archiflow-scan`.
 * No se ejecuta en la validación general porque un boceto manual puede ser
 * deliberadamente incompleto; la skill sí debe entregar recorridos cerrados.
 */
export function validateScanContract(diagram: Diagram): Issue[] {
  const issues: Issue[] = [];
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));

  diagram.flows.forEach((flow, flowIndex) => {
    const at = (stepIndex: number, field?: string): (string | number)[] =>
      ['flows', flowIndex, 'steps', stepIndex, ...(field ? [field] : [])];
    if (flow.steps.length === 0) return;

    const first = flow.steps[0]!;
    const last = flow.steps.at(-1)!;
    const entryNode = nodes.get(nodeId(first.from));
    if (!entryNode || !CHANNEL_KINDS.has(entryNode.kind)) {
      issues.push({ level: 'error', message: `el flujo '${flow.id}' debe comenzar en un canal, cliente o gateway`, path: at(0, 'from') });
    }
    if (last.to !== first.from) {
      issues.push({ level: 'error', message: `el flujo '${flow.id}' debe cerrar volviendo al canal '${first.from}'`, path: at(flow.steps.length - 1, 'to') });
    }

    flow.steps.forEach((step, stepIndex) => {
      const fromNode = nodes.get(nodeId(step.from));
      const toNode = nodes.get(nodeId(step.to));

      for (const [reference, node, field] of [[step.from, fromNode, 'from'], [step.to, toNode, 'to']] as const) {
        if (node?.kind === 'service' && node.provides.length > 0 && !hasOperation(reference)) {
          issues.push({ level: 'error', message: `el paso ${stepIndex + 1} debe anclarse a una operación concreta: usa '${node.id}/<operation-id>'`, path: at(stepIndex, field) });
        }
      }

      const httpOperation = ['http', 'https'].includes(step.protocol)
        && /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i.test(step.op ?? '');
      const placeholders = httpOperation ? [...(step.op ?? '').matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!) : [];
      for (const placeholder of placeholders) {
        if (!step.pathParams.some((parameter) => parameter.name === placeholder)) {
          issues.push({ level: 'error', message: `el path param '${placeholder}' no está declarado en pathParams`, path: at(stepIndex, 'pathParams') });
        }
      }
      if (httpOperation && (step.op ?? '').includes('?') && step.queryParams.length === 0) {
        issues.push({ level: 'error', message: `la operación '${step.op}' contiene query string pero queryParams está vacío`, path: at(stepIndex, 'queryParams') });
      }

      if (step.async) {
        if (!step.request) issues.push({ level: 'error', message: `el paso asíncrono ${stepIndex + 1} debe documentar el payload en request`, path: at(stepIndex, 'request') });
        return;
      }

      const isResponse = Boolean(step.response) && !step.request;
      if (!step.request && !step.response) {
        issues.push({ level: 'error', message: `el paso síncrono ${stepIndex + 1} debe declarar request o response`, path: at(stepIndex) });
      }

      if (!isResponse) {
        const reverseIndex = flow.steps.findIndex((candidate, candidateIndex) => candidateIndex > stepIndex && reverseOf(step, candidate) && Boolean(candidate.response));
        if (reverseIndex < 0) {
          issues.push({ level: 'error', message: `el request del paso ${stepIndex + 1} no tiene una flecha de retorno posterior con response`, path: at(stepIndex) });
        }
        if (fromNode?.kind === 'service' && toNode && !CHANNEL_KINDS.has(toNode.kind) && !step.purpose) {
          issues.push({ level: 'error', message: `el salto a '${toNode.label ?? toNode.id}' debe explicar purpose (¿por qué se llama?)`, path: at(stepIndex, 'purpose') });
        }
      } else {
        const forwardIndex = flow.steps.findIndex((candidate, candidateIndex) => candidateIndex < stepIndex && reverseOf(candidate, step) && Boolean(candidate.request));
        if (forwardIndex < 0) {
          issues.push({ level: 'error', message: `el response del paso ${stepIndex + 1} no corresponde a un request anterior`, path: at(stepIndex) });
        }
        if (fromNode && !CHANNEL_KINDS.has(fromNode.kind) && step.response && !TRIVIAL_RESPONSE.test(step.response.trim()) && step.dataUsed.length === 0) {
          issues.push({ level: 'error', message: `el retorno desde '${fromNode.label ?? fromNode.id}' debe declarar dataUsed`, path: at(stepIndex, 'dataUsed') });
        }
      }
    });
  });

  return issues;
}
