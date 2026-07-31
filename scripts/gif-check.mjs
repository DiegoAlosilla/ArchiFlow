import { writeFileSync } from 'node:fs';
import { buildPalette, encodeGif } from '../src/export/gif.ts';

/**
 * Genera un GIF de prueba para comprobarlo con un descodificador de verdad.
 *
 * Los tests comprueban la estructura del fichero, pero la parte que se rompe en
 * silencio es el LZW: un flujo mal cerrado produce un GIF que algunos visores
 * abren y otros rechazan. Esto escribe un fichero con un cuadrado que se mueve,
 * fácil de verificar píxel a píxel desde fuera.
 *
 *   node --experimental-strip-types scripts/gif-check.mjs salida.gif
 */

const size = 64;
const palette = buildPalette('#060910', ['#e2e8f0', '#38bdf8', '#f59e0b']);
const colors = [
  [56, 189, 248],
  [245, 158, 11],
  [226, 232, 240],
];

const frames = [];
for (let frame = 0; frame < 3; frame++) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      const inside = x >= frame * 16 && x < frame * 16 + 16 && y >= 16 && y < 32;
      const [r, g, b] = inside ? colors[frame] : [6, 9, 16];
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
  }
  frames.push({ data });
}

const gif = encodeGif(frames, palette, { width: size, height: size, delayMs: 100 });
writeFileSync(process.argv[2] ?? 'prueba.gif', gif);
console.log(`${gif.length} bytes, ${frames.length} fotogramas`);

/**
 * Segundo fichero: ruido a pantalla completa.
 *
 * Un fotograma real tiene más de un millón de píxeles y llena la tabla LZW
 * varias veces, con lo que se ejecuta la rama de limpieza de diccionario — la
 * que un fixture pequeño nunca toca y la que rompe el fichero si está mal.
 */
const big = 700;
const noisy = new Uint8ClampedArray(big * big * 4);
let seed = 12345;
for (let i = 0; i < big * big; i++) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  const color = palette[seed % palette.length];
  noisy[i * 4] = color[0];
  noisy[i * 4 + 1] = color[1];
  noisy[i * 4 + 2] = color[2];
  noisy[i * 4 + 3] = 255;
}
const stress = encodeGif([{ data: noisy }], palette, { width: big, height: big, delayMs: 100 });
writeFileSync((process.argv[2] ?? 'prueba.gif').replace(/\.gif$/, '-ruido.gif'), stress);
console.log(`${stress.length} bytes de ruido en ${big}x${big}`);
