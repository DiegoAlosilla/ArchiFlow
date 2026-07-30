/**
 * Registro del trazado real de cada arista.
 *
 * React Flow calcula el `path` SVG dentro del componente de arista, pero la
 * capa de paquetes necesita esa geometría para mover los puntos por encima.
 * En vez de levantar el dato hasta React (y re-renderizar), las aristas lo
 * depositan aquí y la animación lo lee cuando le hace falta.
 */

const paths = new Map<string, string>();

export function setEdgePath(id: string, d: string): void {
  paths.set(id, d);
}

export function removeEdgePath(id: string): void {
  paths.delete(id);
}

export function getEdgePath(id: string): string | undefined {
  return paths.get(id);
}

/**
 * Mide puntos sobre un path SVG reutilizando un único elemento oculto. Crear
 * un `<path>` por medición sería el camino fácil, pero se hace 60 veces por
 * segundo por cada paquete en vuelo.
 */
class PathMeasurer {
  private element: SVGPathElement | null = null;
  private currentD = '';
  private lengths = new Map<string, number>();

  private ensure(): SVGPathElement {
    if (this.element) return this.element;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';
    svg.style.opacity = '0';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(path);
    document.body.appendChild(svg);
    this.element = path;
    return path;
  }

  private load(d: string): SVGPathElement {
    const element = this.ensure();
    if (this.currentD !== d) {
      element.setAttribute('d', d);
      this.currentD = d;
    }
    return element;
  }

  length(d: string): number {
    const cached = this.lengths.get(d);
    if (cached !== undefined) return cached;
    const total = this.load(d).getTotalLength();
    this.lengths.set(d, total);
    return total;
  }

  /** Punto en la fracción `t` (0..1) del recorrido. */
  pointAt(d: string, t: number): { x: number; y: number } {
    const total = this.length(d);
    const point = this.load(d).getPointAtLength(total * Math.min(Math.max(t, 0), 1));
    return { x: point.x, y: point.y };
  }

  invalidate(): void {
    this.lengths.clear();
    this.currentD = '';
  }
}

export const measurer = new PathMeasurer();
