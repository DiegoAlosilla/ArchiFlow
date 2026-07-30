import { describe, expect, it } from 'vitest';
import { compile } from '../src/schema/compile.js';
import { parseDiagram } from '../src/schema/parse.js';
import { toDrawio } from '../src/export/drawio.js';
import { toSvg } from '../src/export/svg.js';
import { toArchimate } from '../src/export/archimate.js';

/**
 * Un fichero exportado que la herramienta destino rechaza es peor que no
 * exportar: el usuario descubre el fallo cuando ya está delante de quien iba a
 * enseñárselo. Estas pruebas comprueban que la salida es XML bien formado, no
 * solo que el comando termina sin error.
 */

const source = `
archiflow: 1
name: Demo & Prueba
nodes:
  - id: gw
    label: "API <Gateway>"
    kind: gateway
    tech: Azure APIM
  - id: svc
    label: bff-cuentas
    tech: Quarkus 3
    provides:
      - method: GET
        path: /v1/cuentas
flows:
  - id: f
    label: Flujo con "comillas" & ampersand
    steps:
      - from: gw
        to: svc
        op: GET /v1/cuentas?filtro=<todos>
        condition: cache miss
`;

const ir = compile(parseDiagram(source).diagram!);

/** Detecta `<` sin escapar dentro de un valor de atributo, que es el fallo
 * exacto que draw.io reporta como "Unescaped '<' not allowed". */
function attributesWithRawMarkup(xml: string): string[] {
  return [...xml.matchAll(/\w+="([^"]*)"/g)]
    .map((match) => match[1]!)
    .filter((value) => value.includes('<') || value.includes('>'));
}

describe('toDrawio', () => {
  it('no deja marcado sin escapar dentro de los atributos', async () => {
    const xml = await toDrawio(ir);
    expect(attributesWithRawMarkup(xml)).toEqual([]);
  });

  it('escapa los caracteres especiales del contenido del usuario', async () => {
    const xml = await toDrawio(ir);
    expect(xml).toContain('&lt;b&gt;');
    expect(xml).not.toContain('value="<b>');
    // El & del nombre del diagrama tampoco puede salir crudo.
    expect(xml).not.toMatch(/name="[^"]*&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it('conserva los saltos de línea como marcado escapado que mxGraph entiende', async () => {
    const xml = await toDrawio(ir);
    expect(xml).toContain('&lt;br/&gt;');
    expect(xml).not.toContain('<br/>');
  });

  it('genera una página por flujo más la topología', async () => {
    const xml = await toDrawio(ir);
    expect([...xml.matchAll(/<diagram /g)]).toHaveLength(2);
  });

  it('produce XML que un parser acepta', async () => {
    const xml = await toDrawio(ir);
    // Sin DOM en Node, se comprueba el balance de etiquetas y la ausencia de
    // marcado crudo en atributos, que es lo que rompía draw.io.
    const opens = (xml.match(/<(?![/?!])[a-zA-Z]/g) ?? []).length;
    const selfClosing = (xml.match(/\/>/g) ?? []).length;
    const closes = (xml.match(/<\//g) ?? []).length;
    expect(opens).toBe(selfClosing + closes);
  });
});

describe('toSvg', () => {
  it('escapa el contenido del usuario', async () => {
    const svg = await toSvg(ir);
    expect(attributesWithRawMarkup(svg)).toEqual([]);
    expect(svg).toContain('API &lt;Gateway&gt;');
  });

  it('respeta el fondo transparente', async () => {
    const opaque = await toSvg(ir);
    const transparent = await toSvg(ir, { transparent: true });
    expect(opaque).toContain('fill="#060910"');
    expect(transparent).not.toContain('fill="#060910"');
  });

  it('numera los pasos cuando se resalta un flujo', async () => {
    const svg = await toSvg(ir, { flowId: 'f' });
    expect(svg).toContain('1. GET /v1/cuentas');
  });
});

describe('toArchimate', () => {
  it('exporta los elementos y relaciones del IR', () => {
    const xml = toArchimate(ir);
    expect(xml).toContain('ApplicationService');
    expect(xml).toContain('ServingRelationship');
    expect(xml).toContain('API &lt;Gateway&gt;');
  });
});
