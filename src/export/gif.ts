import { kindAccent, protocolColor } from '../theme.js';

/**
 * Codificador GIF89a, sin dependencias.
 *
 * El GIF es lo que permite pegar el recorrido en un Confluence o en un Teams,
 * que es donde acaba viviendo la documentación. El problema del formato es que
 * solo admite 256 colores por fotograma, y un tema oscuro reducido a lo bruto
 * sale con bandas horribles: peor que no exportarlo.
 *
 * La salida no se cuantiza en general — **los colores los ponemos nosotros**.
 * La paleta se construye a partir del tema (fondos, textos, acentos de tipo y
 * colores de protocolo) más sus mezclas con el fondo, que es exactamente lo que
 * produce el antialias de las letras y las transparencias de las zonas. Eso
 * evita escribir un algoritmo de corte mediano y da mejor resultado que uno
 * genérico, porque la paleta cubre justo lo que hay en la imagen.
 */

export interface GifFrame {
  /** Píxeles RGBA, tal como los devuelve `getImageData`. */
  data: Uint8ClampedArray;
}

export interface GifOptions {
  width: number;
  height: number;
  /** Milisegundos por fotograma. El GIF los guarda en centésimas. */
  delayMs: number;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const digits = hex.replace('#', '');
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function mix(color: Rgb, background: Rgb, amount: number): Rgb {
  return [
    Math.round(color[0] * amount + background[0] * (1 - amount)),
    Math.round(color[1] * amount + background[1] * (1 - amount)),
    Math.round(color[2] * amount + background[2] * (1 - amount)),
  ];
}

/** Mezclas que hay que cubrir: antialias de texto y rellenos translúcidos. */
const BLENDS = [0.08, 0.16, 0.28, 0.42, 0.58, 0.74, 0.88];

/**
 * Paleta fija a partir del tema. Se le pasan los colores de fondo y de texto
 * del SVG porque cambian entre el tema claro y el oscuro.
 */
export function buildPalette(background: string, foregrounds: string[]): Rgb[] {
  const bg = hexToRgb(background);
  const palette: Rgb[] = [bg];
  const seen = new Set([bg.join(',')]);

  const add = (color: Rgb) => {
    const key = color.join(',');
    if (seen.has(key) || palette.length >= 256) return;
    seen.add(key);
    palette.push(color);
  };

  const bases = [
    ...foregrounds,
    ...Object.values(kindAccent),
    ...Object.values(protocolColor),
  ].map(hexToRgb);

  // Primero los colores puros: son los que tienen que salir exactos.
  for (const base of bases) add(base);
  // Y después sus mezclas con el fondo, que es donde se produce el bandeo.
  for (const base of bases) for (const amount of BLENDS) add(mix(base, bg, amount));

  return palette;
}

/**
 * Índice del color más parecido, con caché en una tabla de 32 768 entradas
 * (RGB de 5 bits por canal).
 *
 * Buscar el más cercano por fuerza bruta son 256 comparaciones por píxel, y un
 * fotograma de 1200×900 tiene un millón. La tabla lo convierte en una lectura.
 */
function buildLookup(palette: Rgb[]): Uint8Array {
  const lookup = new Uint8Array(32_768);

  for (let index = 0; index < 32_768; index++) {
    const r = ((index >> 10) & 31) * 8;
    const g = ((index >> 5) & 31) * 8;
    const b = (index & 31) * 8;

    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const color = palette[i]!;
      // Distancia euclídea ponderada: el ojo distingue mucho mejor el verde.
      const dr = (color[0] - r) * 0.3;
      const dg = (color[1] - g) * 0.59;
      const db = (color[2] - b) * 0.11;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    lookup[index] = best;
  }

  return lookup;
}

function quantize(data: Uint8ClampedArray, lookup: Uint8Array): Uint8Array {
  const indices = new Uint8Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const key = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3);
    indices[p] = lookup[key]!;
  }
  return indices;
}

/** Escritor de bytes que crece solo. */
class ByteWriter {
  private bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  short(value: number): void {
    this.byte(value);
    this.byte(value >> 8);
  }

  string(value: string): void {
    for (const char of value) this.byte(char.charCodeAt(0));
  }

  raw(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.byte(values[i]!);
  }

  /** Los datos de imagen van en bloques de 255 bytes como máximo. */
  blocks(values: number[]): void {
    for (let i = 0; i < values.length; i += 255) {
      const chunk = values.slice(i, i + 255);
      this.byte(chunk.length);
      this.raw(chunk);
    }
    this.byte(0);
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/**
 * Compresión LZW tal como la define el GIF: códigos de longitud variable, tabla
 * que se reinicia al llenarse y códigos de control de limpieza y de fin.
 */
function lzwCompress(indices: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  // Clave numérica `prefijo * 256 + siguiente` en vez de una cadena: un
  // fotograma tiene un millón de píxeles y concatenar cadenas por cada uno
  // convierte la exportación en una espera de diez segundos.
  let dictionary = new Map<number, number>();

  const output: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;

  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  if (indices.length === 0) {
    emit(endCode);
    if (bitCount > 0) output.push(bitBuffer & 0xff);
    return output;
  }

  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const next = indices[i]!;
    const key = prefix * 256 + next;
    const known = dictionary.get(key);

    if (known !== undefined) {
      prefix = known;
      continue;
    }

    emit(prefix);
    dictionary.set(key, nextCode++);

    if (nextCode > 1 << codeSize) {
      if (codeSize < 12) {
        codeSize++;
      } else {
        // La tabla está llena: se limpia y se vuelve a empezar, que es lo que
        // el descodificador espera al ver el código de limpieza.
        emit(clearCode);
        dictionary = new Map();
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
      }
    }

    prefix = next;
  }

  emit(prefix);
  emit(endCode);
  if (bitCount > 0) output.push(bitBuffer & 0xff);

  return output;
}

/**
 * Ensambla el GIF animado. La paleta es la misma para todos los fotogramas, así
 * que va como tabla global y cada fotograma solo lleva sus píxeles.
 */
export function encodeGif(frames: GifFrame[], palette: Rgb[], options: GifOptions): Uint8Array {
  const { width, height, delayMs } = options;
  const lookup = buildLookup(palette);

  // El tamaño de la tabla es una potencia de dos: 2^(n+1) entradas.
  let tableSize = 1;
  while (1 << (tableSize + 1) < palette.length) tableSize++;
  const entries = 1 << (tableSize + 1);
  const minCodeSize = Math.max(2, tableSize + 1);

  const writer = new ByteWriter();
  writer.string('GIF89a');
  writer.short(width);
  writer.short(height);
  writer.byte(0b1_111_0_000 | tableSize); // tabla global, 8 bits de color
  writer.byte(0); // índice del color de fondo
  writer.byte(0); // relación de aspecto

  for (let i = 0; i < entries; i++) {
    const color = palette[i] ?? [0, 0, 0];
    writer.byte(color[0]);
    writer.byte(color[1]);
    writer.byte(color[2]);
  }

  // Bucle infinito: la extensión de NETSCAPE es lo que lo activa, y sin ella
  // el GIF se reproduce una vez y se queda en el último fotograma.
  writer.byte(0x21);
  writer.byte(0xff);
  writer.byte(11);
  writer.string('NETSCAPE2.0');
  writer.byte(3);
  writer.byte(1);
  writer.short(0);
  writer.byte(0);

  const delay = Math.max(2, Math.round(delayMs / 10));

  for (const frame of frames) {
    writer.byte(0x21); // control gráfico
    writer.byte(0xf9);
    writer.byte(4);
    writer.byte(0b000_001_00); // sin transparencia, restaurar al fondo no
    writer.short(delay);
    writer.byte(0);
    writer.byte(0);

    writer.byte(0x2c); // descriptor de imagen
    writer.short(0);
    writer.short(0);
    writer.short(width);
    writer.short(height);
    writer.byte(0); // sin tabla local ni entrelazado

    writer.byte(minCodeSize);
    writer.blocks(lzwCompress(quantize(frame.data, lookup), minCodeSize));
  }

  writer.byte(0x3b); // fin del fichero
  return writer.toUint8Array();
}
