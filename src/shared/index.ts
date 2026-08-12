import type { Mutation } from '../edit/mutations.js';
import type { Ir } from '../schema/compile.js';
import type { Issue } from '../schema/parse.js';

/** Contrato entre el servidor del CLI y el renderer web. */

export interface DiagramEntry {
  /** Slug estable derivado de la ruta relativa. */
  id: string;
  /** Ruta relativa al directorio vigilado, para mostrarla en la UI. */
  file: string;
  /** Nombre del diagrama, o el fichero si no se pudo parsear. */
  name: string;
  /**
   * Huella del contenido en disco. La web la devuelve en cada mutación para
   * que el servidor detecte si el fichero cambió por otra vía mientras tanto.
   */
  revision: string;
  ok: boolean;
  issues: Issue[];
  ir?: Ir;
}

export interface DiagramsPayload {
  root: string;
  diagrams: DiagramEntry[];
  /** Historial volátil de la sesión del servidor, por fichero. */
  history: Record<string, { canUndo: boolean; canRedo: boolean }>;
  /** Marca de tiempo de la última recarga, para mostrar "actualizado hace X". */
  updatedAt: number;
}

export type ServerMessage = { type: 'diagrams'; payload: DiagramsPayload };

/** Cuerpo de `POST /api/mutate`. */
export interface MutateRequest {
  /** `id` del diagrama a modificar. */
  id: string;
  /** Revisión sobre la que se calcularon las mutaciones. */
  baseRevision: string;
  mutations: Mutation[];
}

export interface MutateResponse {
  ok: boolean;
  /** Nueva revisión tras escribir, si tuvo éxito. */
  revision?: string;
  error?: string;
  /**
   * `stale` indica que el fichero cambió por fuera y hay que recargar antes de
   * reintentar; se distingue de un error de validación, que sí es culpa de la
   * mutación.
   */
  reason?: 'stale' | 'invalid' | 'not-found' | 'failed';
  /** Problemas de validación, cuando el resultado no habría sido un diagrama válido. */
  issues?: Issue[];
}

export interface ImportRequest {
  name: string;
  source: string;
}

export interface ImportResponse {
  ok: boolean;
  file?: string;
  error?: string;
  warnings?: string[];
  summary?: {
    pages: number;
    shapes: number;
    containers: number;
    links: number;
  };
}

export type { Mutation };
