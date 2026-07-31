/**
 * PDF de una página con el diagrama rasterizado, sin dependencias.
 *
 * Un PDF con un JPEG dentro son unos pocos objetos y una tabla de referencias
 * cruzadas: mucho menos que arrastrar una librería de 300 kB para envolver una
 * imagen. El JPEG se incrusta **tal cual** con el filtro `DCTDecode`, que es
 * justo lo que hace que esto sea corto: el visor descomprime la imagen, no
 * nosotros.
 *
 * Vectorial sería mejor —el SVG ya lo es—, pero traducir texto y formas a
 * operadores de PDF con fuentes incrustadas es otro proyecto. Esto resuelve el
 * caso real: llevar el diagrama a un documento imprimible.
 */

export interface PdfOptions {
  /** Tamaño de la imagen en píxeles. */
  width: number;
  height: number;
  /** Puntos por pulgada con los que se calcula el tamaño de la página. */
  dpi?: number;
  title?: string;
}

function escapePdfText(value: string): string {
  return value.replace(/[\\()]/g, (match) => `\\${match}`);
}

export function toPdf(jpeg: Uint8Array, options: PdfOptions): Uint8Array {
  const { width, height, dpi = 96, title } = options;

  // 72 puntos por pulgada es la unidad del PDF; la imagen se escala para que
  // salga a su tamaño físico en vez de a un tamaño arbitrario.
  const pageWidth = Math.round((width / dpi) * 72);
  const pageHeight = Math.round((height / dpi) * 72);

  const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q\n`;

  const objects: (string | { header: string; stream: Uint8Array })[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
    {
      header:
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      stream: jpeg,
    },
    { header: `<< /Length ${content.length} >>`, stream: new TextEncoder().encode(content) },
    `<< /Title (${escapePdfText(title ?? 'Diagrama')}) /Producer (ArchiFlow) >>`,
  ];

  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  let offset = 0;
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const text = (value: string) => push(encoder.encode(value));

  text('%PDF-1.4\n');
  // Un comentario con bytes altos marca el fichero como binario, que es lo que
  // evita que un cliente de correo lo trate como texto y lo corrompa.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(offset);
    text(`${index + 1} 0 obj\n`);
    if (typeof object === 'string') {
      text(`${object}\n`);
    } else {
      text(`${object.header}\nstream\n`);
      push(object.stream);
      text('\nendstream\n');
    }
    text('endobj\n');
  });

  const xrefOffset = offset;
  text(`xref\n0 ${objects.length + 1}\n`);
  text('0000000000 65535 f \n');
  for (const value of offsets) text(`${String(value).padStart(10, '0')} 00000 n \n`);
  text(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  const result = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}
