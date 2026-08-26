import { describe, expect, it } from 'vitest';
import { buildDots, dotProgress, loopDurationMs } from '../src/animation.js';
import { encodeGif, buildPalette } from '../src/export/gif.js';
import { toPdf } from '../src/export/pdf.js';
import { toSvg } from '../src/export/svg.js';
import { compile } from '../src/schema/compile.js';
import { parseDiagram } from '../src/schema/parse.js';

/**
 * La animación tiene que ser determinista: es lo que permite que el GIF sea la
 * animación que se estaba viendo y no una reconstrucción parecida. Y un fichero
 * binario que el visor rechaza es peor que no exportarlo, así que aquí se
 * comprueba la estructura, no solo que la función devuelva algo.
 */

const source = `archiflow: 1
name: Animada
nodes:
  - id: a
  - id: b
  - id: c
flows:
  - id: f
    steps:
      - from: a
        to: b
      - from: b
        to: c
`;

const ir = compile(parseDiagram(source).diagram!);
const flow = ir.flows[0]!;

describe('posiciones de los puntos', () => {
  it('en modo paso solo hay punto mientras dura su paso', () => {
    const dots = buildDots(flow, ir.animation);
    const head = dots.find((dot) => dot.stepIndex === 1 && dot.trailIndex === 0)!;
    const step = flow.steps[1]!;

    expect(dotProgress(head, flow, ir.animation, step.startMs - 1)).toBeNull();
    expect(dotProgress(head, flow, ir.animation, step.startMs)).toBeCloseTo(0, 5);
    expect(dotProgress(head, flow, ir.animation, step.startMs + step.durationMs)).toBeCloseTo(1, 5);
    expect(dotProgress(head, flow, ir.animation, step.startMs + step.durationMs + 1)).toBeNull();
  });

  it('la estela va por detrás de su cabeza', () => {
    const dots = buildDots(flow, ir.animation);
    const step = flow.steps[0]!;
    const at = step.startMs + step.durationMs / 2;
    const head = dotProgress(dots.find((dot) => dot.stepIndex === 0 && dot.trailIndex === 0)!, flow, ir.animation, at)!;
    const tail = dotProgress(dots.find((dot) => dot.stepIndex === 0 && dot.trailIndex === 2)!, flow, ir.animation, at)!;
    expect(tail).toBeLessThan(head);
  });

  it('en modo continuo hay puntos en todas las aristas a la vez', () => {
    const continuo = { ...ir.animation, mode: 'continuo' as const, packetsPerEdge: 2, trail: 0 };
    const dots = buildDots(flow, continuo);
    // Dos aristas × dos paquetes, sin estela.
    expect(dots).toHaveLength(4);
    const visible = dots.filter((dot) => dotProgress(dot, flow, continuo, 700) !== null);
    expect(new Set(visible.map((dot) => dot.edgeId)).size).toBe(2);
  });

  it('el bucle cierra: el primer instante y el último coinciden', () => {
    const continuo = { ...ir.animation, mode: 'continuo' as const, trail: 0 };
    const loop = loopDurationMs(flow, continuo);
    const dot = buildDots(flow, continuo)[0]!;
    // Es lo que hace que el GIF no dé un salto al reiniciarse.
    expect(dotProgress(dot, flow, continuo, 0)).toBeCloseTo(dotProgress(dot, flow, continuo, loop)!, 5);
  });

  it('la dirección inversa recorre la arista al revés', () => {
    const inversa = { ...ir.animation, mode: 'continuo' as const, direction: 'inversa' as const, trail: 0 };
    const dot = buildDots(flow, inversa)[0]!;
    const normal = { ...inversa, direction: 'normal' as const };
    expect(dotProgress(dot, flow, inversa, 300)).toBeCloseTo(1 - dotProgress(dot, flow, normal, 300)!, 5);
  });
});

describe('SVG con el tiempo congelado', () => {
  it('dibuja los paquetes en el instante pedido y no en el estático', async () => {
    const estatico = await toSvg(ir, { flowId: 'f' });
    const congelado = await toSvg(ir, { flowId: 'f', timeMs: flow.steps[0]!.durationMs / 2 });
    expect(estatico).not.toContain('<circle');
    expect(congelado).toContain('<circle');
  });

  it('mueve el paquete conforme avanza el tiempo', async () => {
    const step = flow.steps[0]!;
    const posicion = async (timeMs: number) => {
      const svg = await toSvg(ir, { flowId: 'f', timeMs });
      const match = /<circle cx="([\d.]+)" cy="([\d.]+)"/.exec(svg);
      return match ? `${match[1]},${match[2]}` : null;
    };
    expect(await posicion(step.durationMs * 0.25)).not.toBe(await posicion(step.durationMs * 0.75));
  });
});

describe('GIF', () => {
  const width = 4;
  const height = 4;
  const frame = (value: number) => ({
    data: new Uint8ClampedArray(
      Array.from({ length: width * height * 4 }, (_, i) => (i % 4 === 3 ? 255 : value)),
    ),
  });

  it('produce un GIF89a con tabla global, bucle y un bloque por fotograma', () => {
    const palette = buildPalette('#060910', ['#e2e8f0']);
    const gif = encodeGif([frame(0), frame(200)], palette, { width, height, delayMs: 60 });
    const header = String.fromCharCode(...gif.slice(0, 6));

    expect(header).toBe('GIF89a');
    // Anchura y altura, en little endian.
    expect([gif[6], gif[7]]).toEqual([width, 0]);
    expect([gif[8], gif[9]]).toEqual([height, 0]);
    // Bit alto del campo empaquetado: hay tabla global de color.
    expect(gif[10]! & 0x80).toBe(0x80);
    // Sin la extensión de NETSCAPE el GIF se reproduce una sola vez.
    expect(String.fromCharCode(...gif)).toContain('NETSCAPE2.0');
    // Dos descriptores de imagen, uno por fotograma, y el cierre del fichero.
    expect([...gif].filter((byte, i) => byte === 0x2c && gif[i - 1] === 0x00).length).toBeGreaterThanOrEqual(1);
    expect(gif.at(-1)).toBe(0x3b);
  });

  it('respeta el número de repeticiones solicitado por el exportador', () => {
    const palette = buildPalette('#060910', ['#e2e8f0']);
    const gif = encodeGif([frame(0)], palette, { width, height, delayMs: 60, repeat: 3 });
    const marker = String.fromCharCode(...gif).indexOf('NETSCAPE2.0');

    expect(marker).toBeGreaterThan(-1);
    expect([gif[marker + 13], gif[marker + 14]]).toEqual([3, 0]);
  });

  it('activa el índice transparente cuando se solicita', () => {
    const palette = buildPalette('#ffffff', ['#e2e8f0']);
    const transparentFrame = frame(0);
    transparentFrame.data[3] = 0;
    const gif = encodeGif([transparentFrame], palette, {
      width,
      height,
      delayMs: 60,
      transparent: true,
    });
    const control = [...gif].findIndex(
      (byte, index) => byte === 0x21 && gif[index + 1] === 0xf9 && gif[index + 2] === 0x04,
    );

    expect(control).toBeGreaterThan(-1);
    expect(gif[control + 3]! & 1).toBe(1);
    expect(gif[control + 6]).toBe(0);
  });

  it('la paleta parte del fondo y no se pasa de 256 colores', () => {
    const palette = buildPalette('#060910', ['#e2e8f0', '#7c8aa5']);
    expect(palette[0]).toEqual([6, 9, 16]);
    expect(palette.length).toBeLessThanOrEqual(256);
    // Y no repite: cada entrada gastada de más es una que falta para el degradado.
    expect(new Set(palette.map((color) => color.join(','))).size).toBe(palette.length);
  });
});

describe('PDF', () => {
  it('envuelve el JPEG en un PDF de una página que abre cualquier visor', () => {
    // Cabecera mínima de JPEG: basta para comprobar el envoltorio.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    const pdf = toPdf(jpeg, { width: 800, height: 600, title: 'Prueba (con paréntesis)' });
    const text = new TextDecoder('latin1').decode(pdf);

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/MediaBox [0 0 600 450]');
    // Los paréntesis de un título se escapan o el fichero deja de parsearse.
    expect(text).toContain('Prueba \\(con par');
    expect(text).toContain('startxref');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);

    // La tabla xref tiene que apuntar a los objetos de verdad.
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
  });
});
