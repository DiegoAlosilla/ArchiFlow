import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { compile } from '../src/schema/compile.js';
import { parseDiagram } from '../src/schema/parse.js';
import { toDrawio } from '../src/export/drawio.js';
import { toSvg } from '../src/export/svg.js';
import { toArchimate } from '../src/export/archimate.js';
import { fromDrawio, toDraft } from '../src/import/index.js';

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
const challengeFixture = new URL('../examples/fixtures/challenge-management.drawio', import.meta.url);

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

  it('embebe flujos editables y animables para la extensión ArchiFlow de Draw.io', async () => {
    const xml = await toDrawio(ir);
    expect(xml).toContain('archiflowFlows=');
    expect(xml).toContain('&quot;fromCellId&quot;:&quot;n-gw&quot;');
    expect(xml).toContain('&quot;cellId&quot;:&quot;n-svc&quot;');
    expect(xml).toContain('&quot;requestHeaders&quot;');
    expect(xml).toContain('id="fs-f-1"');
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

  it('incluye el contrato y la explicación del paso en fotogramas para GIF', async () => {
    const detailed = compile(parseDiagram(`archiflow: 1
name: Inspector exportable
nodes:
  - id: canal
  - id: api
flows:
  - id: consulta
    steps:
      - from: canal
        to: api
        op: GET /clientes/{customerId}
        pathParams:
          - { name: customerId, value: '123' }
        queryParams:
          - { name: includeInactive, value: 'false', required: false }
        headers:
          - { name: X-Correlation-Id, required: true }
        request: Sin body
        purpose: Recuperar el perfil cacheado para validar elegibilidad
        dataUsed: [customerId, sex]
`).diagram!);
    const svg = await toSvg(detailed, { flowId: 'consulta', timeMs: 100, includeTrafficPanel: true });
    expect(svg).toContain('¿POR QUÉ OCURRE?');
    expect(svg).toContain('PATH PARAMS');
    expect(svg).toContain('QUERY PARAMS');
    expect(svg).toContain('X-Correlation-Id');
    expect(svg).toContain('sex');
  });

  it('mantiene los waypoints y puntas importados, sin volver a enrutar', async () => {
    const faithful = compile(
      parseDiagram(
        `archiflow: 1
name: Ruta fiel
layoutMode: faithful
nodes:
  - id: origen
    layout: { x: 20, y: 100, width: 160, height: 50 }
  - id: destino
    layout: { x: 260, y: 210, width: 160, height: 50 }
edges:
  - from: origen
    to: destino
    layout:
      sourcePoint: { x: 100, y: 125 }
      targetPoint: { x: 260, y: 235 }
      points:
        - { x: 180, y: 125 }
        - { x: 180, y: 235 }
      startArrow: classic
      endArrow: block
`,
      ).diagram!,
    );
    const svg = await toSvg(faithful);
    expect(svg).toContain('M 100 125 L 180 125 L 180 235 L 260 235');
    expect(svg).toContain('marker-start="url(#arrow-http)"');
    expect(svg).toContain('marker-end="url(#arrow-http)"');
  });

  it('congela los glifos importados completos y no usa el fallback lejano de Information Profile', async () => {
    const evidence = fromDrawio(await readFile(challengeFixture, 'utf8'));
    const faithful = compile(parseDiagram(toDraft(evidence).yaml).diagram!);
    const svg = await toSvg(faithful, { assetBaseUrl: 'http://127.0.0.1:4125' });

    expect(svg).toContain('/brands/mobile.svg');
    expect(svg).toContain('/brands/firewall.svg');
    expect(svg).toContain('/azure/application-gateway.svg');
    expect(svg).toContain('/brands/firebase.svg');
    expect(svg).not.toContain('M 630 1565');
  });
});

describe('toArchimate', () => {
  it('exporta los elementos y relaciones del IR', async () => {
    const xml = await toArchimate(ir);
    expect(xml).toContain('xsi:type="ApplicationService"');
    expect(xml).toContain('xsi:type="ApplicationComponent"');
    expect(xml).toContain('API &lt;Gateway&gt;');
    expect(attributesWithRawMarkup(xml)).toEqual([]);
  });

  it('usa los tipos de relación del formato de intercambio, no los de Archi', async () => {
    const xml = await toArchimate(ir);
    // `ServingRelationship` es el formato nativo de Archi; el XSD del Open
    // Exchange solo admite `Serving`, y con el sufijo rechaza el fichero entero.
    expect(xml).toContain('xsi:type="Serving"');
    expect(xml).not.toContain('ServingRelationship');
  });

  it('produce identificadores válidos como xsd:ID', async () => {
    const numeric = compile(
      parseDiagram(`archiflow: 1\nname: Ids\nnodes:\n  - id: 1-canal\n  - id: 2.servicio\nflows:\n  - id: f\n    steps:\n      - from: 1-canal\n        to: 2.servicio\n`)
        .diagram!,
    );
    const xml = await toArchimate(numeric);
    for (const [, id] of xml.matchAll(/(?:identifier|source|target|elementRef|relationshipRef)="([^"]*)"/g)) {
      // Un xsd:ID no puede empezar por dígito ni llevar caracteres raros; los
      // ids de las aristas son `origen__destino`, así que hay que sanearlos.
      expect(id).toMatch(/^[a-zA-Z_][a-zA-Z0-9._-]*$/);
    }
  });

  it('incluye una vista con geometría y las referencias resueltas', async () => {
    const xml = await toArchimate(ir);
    expect(xml).toContain('<views><diagrams><view identifier="view-topologia"');
    // Sin vista Archi importa el modelo pero no dibuja nada.
    expect(xml).toMatch(/<node identifier="view-svc" elementRef="n-svc" xsi:type="Element" x="\d+"/);

    const declared = new Set([...xml.matchAll(/identifier="([^"]*)"/g)].map((match) => match[1]));
    for (const [, reference] of xml.matchAll(/(?:source|target|elementRef|relationshipRef)="([^"]*)"/g)) {
      expect(declared).toContain(reference);
    }
  });

  it('no emite coordenadas negativas', async () => {
    // El lienzo de ArchiFlow no tiene origen y una zona arrastrada hacia arriba
    // acaba en negativo; el XSD las declara `nonNegativeInteger` y rechaza el
    // fichero completo.
    const arrastrado = compile(
      parseDiagram(
        `archiflow: 1\nname: Arrastrado\nzones:\n  - id: canales\n    layout:\n      x: -120\n      y: -31\n      width: 300\n      height: 200\nnodes:\n  - id: app\n    zone: canales\n  - id: api\n    zone: canales\nflows:\n  - id: f\n    steps:\n      - from: app\n        to: api\n`,
      ).diagram!,
    );
    const xml = await toArchimate(arrastrado);
    expect(xml).not.toMatch(/(?:x|y|w|h)="-/);
  });

  it('mantiene el orden de hijos que exige el XSD', async () => {
    const xml = await toArchimate(ir);
    expect(xml.indexOf('<name')).toBeLessThan(xml.indexOf('<elements>'));
    expect(xml.indexOf('<elements>')).toBeLessThan(xml.indexOf('<relationships>'));
    expect(xml.indexOf('<relationships>')).toBeLessThan(xml.indexOf('<views>'));
  });
});

describe('nodos expandidos', () => {
  const expanded = compile(
    parseDiagram(
      `archiflow: 1\nname: Endpoints\nnodes:\n  - id: api\n    kind: gateway\n  - id: cuentas\n    expanded: true\n    provides:\n      - id: listar\n        method: GET\n        path: /v1/cuentas\n      - id: detalle\n        method: POST\n        path: /v1/cuentas/{id}\nflows:\n  - id: f\n    steps:\n      - from: api\n        to: cuentas/listar\n`,
    ).diagram!,
  );

  it('dibuja todas las operaciones en el SVG', async () => {
    const svg = await toSvg(expanded);
    expect(svg).toContain('/v1/cuentas/{id}');
    expect(svg).toContain('>POST<');
  });

  it('dibuja todas las operaciones en draw.io', async () => {
    const xml = await toDrawio(expanded);
    expect(xml).toContain('POST /v1/cuentas/{id}');
    expect(xml).toContain('archiflowOpenApi=');
    expect(xml).toContain('archiflowKind="endpoint"');
    expect(xml).toContain('id="op-cuentas-listar"');
    expect(xml).toContain('&quot;cellId&quot;:&quot;op-cuentas-listar&quot;');
    expect(attributesWithRawMarkup(xml)).toEqual([]);
  });

  it('sin expandir solo asoma la primera operación', async () => {
    const compact = compile(
      parseDiagram(
        `archiflow: 1\nname: Endpoints\nnodes:\n  - id: cuentas\n    provides:\n      - id: listar\n        method: GET\n        path: /v1/cuentas\n      - id: detalle\n        method: POST\n        path: /v1/cuentas/{id}\n`,
      ).diagram!,
    );
    const svg = await toSvg(compact);
    expect(svg).toContain('GET /v1/cuentas');
    expect(svg).not.toContain('/v1/cuentas/{id}');
  });
});

describe('formas ArchiMate en draw.io', () => {
  it('traduce cada tipo a su forma, siguiendo el ADR-003', async () => {
    const xml = await toDrawio(ir, { archimate: true });
    // gateway → ApplicationService (rounded); service → ApplicationComponent.
    expect(xml).toContain('appType=serv;archiType=rounded;');
    expect(xml).toContain('appType=comp;archiType=square;');
  });

  it('no las usa por omisión', async () => {
    const xml = await toDrawio(ir);
    expect(xml).not.toContain('mxgraph.archimate3');
  });
});
