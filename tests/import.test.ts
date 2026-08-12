import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { detectFormat, fromDrawio, importDiagram, toDraft } from '../src/import/index.js';
import { compile } from '../src/schema/compile.js';
import { parseDiagram } from '../src/schema/parse.js';
import { toArchimate } from '../src/export/archimate.js';

/**
 * El importador produce borradores: la prueba no es que acierte en todo, sino
 * que **lo que produce compila** y que dice en voz alta lo que ha deducido. Un
 * borrador que no valida obliga a arreglar YAML a mano, que es peor que no
 * importar; y uno que se presenta como exacto quema la confianza.
 */

const fixture = new URL('../examples/fixtures/consulta-cuentas.drawio', import.meta.url);
const challengeFixture = new URL('../examples/fixtures/challenge-management.drawio', import.meta.url);

describe('importar de draw.io', () => {
  it('mantiene Challenge Management como fixture de regresión espacial', async () => {
    const evidence = fromDrawio(await readFile(challengeFixture, 'utf8'));
    const draft = parseDiagram(toDraft(evidence, { name: 'Challenge Management' }).yaml);

    expect(evidence.links).toHaveLength(21);
    expect(evidence.shapes.filter((shape) => shape.container)).toHaveLength(26);
    expect(evidence.shapes.find((shape) => shape.label === 'CLOUD BCP')).toMatchObject({
      x: 260,
      y: 580,
      width: 1940,
      height: 1320,
    });
    expect(draft.ok).toBe(true);
    expect(draft.diagram?.layoutMode).toBe('faithful');
    expect(draft.diagram?.edges.some((edge) => (edge.layout?.points.length ?? 0) > 0)).toBe(true);
    expect(evidence.shapes.filter((shape) => shape.renderKind === 'invisible-group')).not.toHaveLength(0);
    expect(evidence.shapes.filter((shape) => shape.renderKind === 'annotation').every((shape) => shape.drawioIcon === 'api-management')).toBe(true);
    expect(draft.diagram?.nodes.some((node) => node.label === 'BADI')).toBe(false);

    // Regresión visual: estos mxCell son hijos sin etiqueta de grupos, no
    // decoración. El glifo se conserva y el rótulo hermano mantiene su propia
    // posición del XML (por eso el icono no duplica el texto).
    expect(evidence.shapes.find((shape) => shape.id === 'KLtuKOiZbpCLr4o21I4e-87')).toMatchObject({ drawioIcon: 'mobile', renderKind: 'image', hideLabel: true });
    expect(evidence.shapes.find((shape) => shape.id === 'KLtuKOiZbpCLr4o21I4e-81')).toMatchObject({ drawioIcon: 'firewall', renderKind: 'image', hideLabel: true });
    expect(evidence.shapes.find((shape) => shape.id === 'KLtuKOiZbpCLr4o21I4e-91')).toMatchObject({ drawioIcon: 'application-gateway', renderKind: 'image', hideLabel: true });
    expect(evidence.shapes.find((shape) => shape.id === 'KLtuKOiZbpCLr4o21I4e-30')).toMatchObject({ drawioIcon: 'firestore', renderKind: 'image', width: 36, height: 42 });

    // Diff de geometría: el draft se limita a añadir presentación; cada
    // elemento principal conserva exactamente el rectángulo del mxCell.
    const zones = new Map(draft.diagram!.zones.map((zone) => [zone.id, zone]));
    for (const [id, renderKind] of [
      ['KLtuKOiZbpCLr4o21I4e-21', 'component'], // API UX BADI
      ['KLtuKOiZbpCLr4o21I4e-57', 'component'], // Information Profile
      ['KLtuKOiZbpCLr4o21I4e-6', 'component'], // Challenge UX
      ['KLtuKOiZbpCLr4o21I4e-103', 'component'], // External Services
      ['KLtuKOiZbpCLr4o21I4e-30', 'image'], // Firestore
      ['KLtuKOiZbpCLr4o21I4e-87', 'image'], // FrontEnd
      ['KLtuKOiZbpCLr4o21I4e-91', 'image'], // Application Gateway
    ]) {
      const sourceShape = evidence.shapes.find((shape) => shape.id === id)!;
      const node = draft.diagram!.nodes.find((candidate) => candidate.label === sourceShape.label && candidate.tags.includes(`drawio:render:${renderKind}`) && candidate.layout?.width === Math.round(sourceShape.width))!;
      const zone = node.zone ? zones.get(node.zone) : undefined;
      expect({
        x: (zone?.layout?.x ?? 0) + (node.layout?.x ?? 0),
        y: (zone?.layout?.y ?? 0) + (node.layout?.y ?? 0),
        width: node.layout?.width,
        height: node.layout?.height,
      }).toEqual({ x: Math.round(sourceShape.x), y: Math.round(sourceShape.y), width: Math.round(sourceShape.width), height: Math.round(sourceShape.height) });
    }

    const informationProfile = evidence.links.find((link) => link.id === 'KLtuKOiZbpCLr4o21I4e-77');
    expect(informationProfile).toMatchObject({
      source: 'KLtuKOiZbpCLr4o21I4e-76',
      target: 'KLtuKOiZbpCLr4o21I4e-57',
      geometry: { sourcePoint: { x: 630, y: 1565 }, points: [] },
    });
    // La punta importada se mantiene dentro del plano y el renderer completa
    // ortogonalmente el tramo que no trae Array as="points".
    expect(informationProfile!.geometry!.sourcePoint!.x).toBeGreaterThan(260);
    expect(informationProfile!.geometry!.sourcePoint!.y).toBeLessThan(1900);

    const toChallenge = evidence.links.find((link) => link.id === 'KLtuKOiZbpCLr4o21I4e-98');
    expect(toChallenge).toMatchObject({
      source: 'KLtuKOiZbpCLr4o21I4e-92',
      target: 'KLtuKOiZbpCLr4o21I4e-6',
      geometry: { points: [{ x: 1150, y: 870 }, { x: 1630, y: 870 }, { x: 1630, y: 1010 }] },
    });
  });

  it('separa grupos invisibles, límites pintados y etiquetas de contenedor', () => {
    const evidence = fromDrawio(`<mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="logical" style="group;" vertex="1" parent="1"><mxGeometry x="100" y="60" width="500" height="300" as="geometry" /></mxCell>
      <mxCell id="visible" value="Dominio" style="rounded=0;fillColor=#dbeafe;strokeColor=none;" vertex="1" parent="logical"><mxGeometry x="20" y="30" width="360" height="220" as="geometry" /></mxCell>
      <mxCell id="title" value="Dominio" style="text;html=1;strokeColor=none;fillColor=none;" vertex="1" parent="logical"><mxGeometry x="30" y="40" width="80" height="20" as="geometry" /></mxCell>
      <mxCell id="api" value="API Management" style="image;image=img/lib/mscae/API_Management.svg;" vertex="1" parent="1"><mxGeometry x="30" y="280" width="25" height="20" as="geometry" /></mxCell>
    </root></mxGraphModel>`);
    expect(evidence.shapes.find((shape) => shape.id === 'logical')?.renderKind).toBe('invisible-group');
    expect(evidence.shapes.find((shape) => shape.id === 'visible')?.renderKind).toBe('visible-container');
    expect(evidence.shapes.find((shape) => shape.id === 'title')?.renderKind).toBe('label');
    expect(evidence.shapes.find((shape) => shape.id === 'api')?.renderKind).toBe('annotation');
    const parsed = parseDiagram(toDraft(evidence).yaml);
    expect(parsed.ok).toBe(true);
    expect(parsed.diagram?.zones).toHaveLength(1);
    expect(parsed.diagram?.nodes.some((node) => node.label === 'Dominio')).toBe(false);
  });

  it('descomprime el modelo que guarda draw.io', async () => {
    // El fichero real viene en base64 de un deflate crudo: sin deshacerlo no
    // hay ni una caja que leer.
    const source = await readFile(fixture, 'utf8');
    expect(source).not.toContain('<mxCell');

    const evidence = fromDrawio(source);
    expect(evidence.shapes.length).toBeGreaterThan(0);
    expect(evidence.pages[0]!.name).toBe('Consulta de cuentas');
  });

  it('deduce el tipo por forma y por texto, y dice de dónde lo saca', async () => {
    const evidence = fromDrawio(await readFile(fixture, 'utf8'));
    const kind = (label: string) => evidence.shapes.find((shape) => shape.label.includes(label));

    expect(kind('Oracle')?.kind).toBe('database');
    expect(kind('Oracle')?.reason).toMatch(/cilindro/);
    expect(kind('Kafka')?.kind).toBe('broker');
    expect(kind('Redis')?.kind).toBe('cache');
    expect(kind('API Gateway')?.kind).toBe('gateway');
    expect(kind('App Móvil')?.kind).toBe('client');
  });

  it('descarta maquetas pero conserva las anotaciones', async () => {
    const evidence = fromDrawio(await readFile(fixture, 'utf8'));
    expect(evidence.shapes.some((shape) => shape.label === 'Login')).toBe(false);
    expect(evidence.warnings.some((warning) => /imagen o maqueta/.test(warning))).toBe(true);
    expect(evidence.shapes.some((shape) => shape.label === 'Pendiente de confirmar con seguridad')).toBe(true);
    // Y la flecha que salía de la imagen se cae con ella.
    expect(evidence.links.some((link) => link.label === 'mockup')).toBe(false);
  });

  it('reconoce el carril como contenedor y el HTML de las etiquetas', async () => {
    const evidence = fromDrawio(await readFile(fixture, 'utf8'));
    const lane = evidence.shapes.find((shape) => shape.container);
    expect(lane?.label).toBe('Canales');
    expect(evidence.shapes.find((shape) => shape.id === 'movil')?.label).toBe('App Móvil iOS');
  });

  it('recupera un dominio rotulado sobre un rectángulo de fondo', () => {
    const evidence = fromDrawio(`<mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="background" style="rounded=0;fillColor=#ffffff;" vertex="1" parent="1"><mxGeometry x="100" y="80" width="600" height="400" as="geometry" /></mxCell>
      <mxCell id="title" value="BADI" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="110" y="90" width="60" height="30" as="geometry" /></mxCell>
      <mxCell id="api" value="&lt;&lt;API BS&gt;&gt; Pagos" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="180" y="180" width="220" height="60" as="geometry" /></mxCell>
    </root></mxGraphModel>`);

    expect(evidence.shapes.find((shape) => shape.id === 'background')).toMatchObject({ container: true, label: 'BADI' });
    const draft = parseDiagram(toDraft(evidence).yaml);
    expect(draft.diagram?.nodes.find((node) => node.label?.includes('Pagos'))?.zone).toBe('badi');
  });

  it('conserva la geometría de los elementos importados', async () => {
    const draft = toDraft(fromDrawio(await readFile(fixture, 'utf8')));
    const parsed = parseDiagram(draft.yaml);
    expect(parsed.ok).toBe(true);
    const diagram = parsed.diagram!;
    expect(diagram.zones.find((zone) => zone.id === 'canales')?.layout).toMatchObject({ x: 20, y: 20 });
    expect(diagram.nodes.find((node) => node.id === 'app-movil-ios')?.layout).toMatchObject({ x: 60, y: 40 });
    expect(diagram.layoutMode).toBe('faithful');
  });

  it('resuelve padres anidados y conserva waypoints, anchors y flechas', () => {
    const evidence = fromDrawio(`<mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="outer" value="Entorno" style="swimlane;fillColor=#dbeafe;" vertex="1" parent="1"><mxGeometry x="100" y="50" width="700" height="500" as="geometry" /></mxCell>
      <mxCell id="inner" value="Dominio" style="group;fillColor=#ffffff;" vertex="1" parent="outer"><mxGeometry x="40" y="80" width="420" height="280" as="geometry" /></mxCell>
      <mxCell id="a" value="Servicio A" style="rounded=1;" vertex="1" parent="inner"><mxGeometry x="20" y="30" width="140" height="60" as="geometry" /></mxCell>
      <mxCell id="b" value="Servicio B" style="rounded=1;" vertex="1" parent="inner"><mxGeometry x="240" y="150" width="140" height="60" as="geometry" /></mxCell>
      <mxCell id="e" value="consulta" edge="1" parent="1" source="a" target="b" style="exitX=1;exitY=0.5;entryX=0;entryY=0.5;startArrow=oval;endArrow=block;orthogonalLoop=1;"><mxGeometry relative="1" as="geometry"><mxPoint as="sourcePoint" x="260" y="190"/><Array as="points"><mxPoint x="310" y="190"/><mxPoint x="310" y="280"/></Array><mxPoint as="targetPoint" x="380" y="280"/></mxGeometry></mxCell>
    </root></mxGraphModel>`);
    expect(evidence.shapes.find((shape) => shape.id === 'a')).toMatchObject({ x: 160, y: 160, parent: 'inner' });
    expect(evidence.shapes.find((shape) => shape.id === 'inner')?.container).toBe(true);
    expect(evidence.links[0]).toMatchObject({
      geometry: { sourcePoint: { x: 260, y: 190 }, targetPoint: { x: 380, y: 280 }, points: [{ x: 310, y: 190 }, { x: 310, y: 280 }] },
      anchors: { source: { x: 1, y: 0.5 }, target: { x: 0, y: 0.5 } },
      startArrow: 'oval',
      endArrow: 'block',
    });
    const parsed = parseDiagram(toDraft(evidence).yaml);
    expect(parsed.diagram?.edges[0]?.layout?.points).toHaveLength(2);
  });

  it('no confunde dashed=0 con una conexión asíncrona', () => {
    const evidence = fromDrawio(`<mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="40" as="geometry" /></mxCell>
      <mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="200" y="0" width="100" height="40" as="geometry" /></mxCell>
      <mxCell id="e" edge="1" parent="1" source="a" target="b" style="dashed=0;"><mxGeometry relative="1" as="geometry" /></mxCell>
    </root></mxGraphModel>`);
    expect(evidence.links[0]?.async).toBe(false);
  });

  it('mantiene como nodo una caja conectada aunque parezca contenedor', () => {
    const evidence = fromDrawio(`<mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="screen" value="Pantalla" style="fillColor=#ffff88;strokeColor=#36393d;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="320" height="180" as="geometry" /></mxCell>
      <mxCell id="api" value="API" vertex="1" parent="1"><mxGeometry x="500" y="0" width="100" height="40" as="geometry" /></mxCell>
      <mxCell id="e" edge="1" parent="1" source="screen" target="api"><mxGeometry relative="1" as="geometry" /></mxCell>
    </root></mxGraphModel>`);
    const parsed = parseDiagram(toDraft(evidence).yaml);
    expect(parsed.ok).toBe(true);
    expect(parsed.diagram?.nodes.find((node) => node.label === 'Pantalla')).toMatchObject({
      appearance: { fill: '#ffff88', stroke: '#36393d' },
    });
    expect(parsed.diagram?.zones.find((zone) => zone.label === 'Pantalla')).toBeUndefined();
  });

  it('lee la etiqueta que draw.io guarda en una celda hija', async () => {
    const evidence = fromDrawio(await readFile(fixture, 'utf8'));
    const first = evidence.links.find((link) => link.id === 'e1');
    expect(first?.label).toBe('1. POST /login HTTPS');
    expect(first?.protocol).toBe('https');
  });

  it('produce un borrador que compila, con zonas y pasos en orden', async () => {
    const evidence = fromDrawio(await readFile(fixture, 'utf8'));
    const draft = toDraft(evidence);

    const parsed = parseDiagram(draft.yaml);
    expect(parsed.issues.filter((issue) => issue.level === 'error')).toEqual([]);
    expect(parsed.ok).toBe(true);

    const ir = compile(parsed.diagram!);
    expect(ir.zones.map((zone) => zone.label)).toContain('Canales');
    expect(ir.nodes.find((node) => node.id === 'app-movil-ios')?.zone).toBe('canales');
    // La numeración de las flechas manda sobre la posición.
    expect(ir.flows[0]!.steps.map((step) => step.to)).toEqual([
      'api-gateway',
      'bff-cuentas',
      'redis-sesiones',
      'oracle-clientes',
      'kafka-eventos',
    ]);
    expect(ir.flows[0]!.steps.at(-1)!.async).toBe(true);
    // El número de la etiqueta se cae: ArchiFlow numera los pasos él solo.
    expect(ir.flows[0]!.steps[0]!.label).toBe('POST /login HTTPS');
  });

  it('encabeza el borrador diciendo que lo es', async () => {
    const draft = toDraft(fromDrawio(await readFile(fixture, 'utf8')));
    expect(draft.yaml).toMatch(/^#\s*BORRADOR/);
    expect(draft.yaml).toMatch(/orden de los pasos sale de la numeración/i);
  });

  it('avisa de que el orden es una conjetura cuando nadie numeró las flechas', () => {
    const sinNumerar = fromDrawio(`<mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="a" value="Servicio A" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="40" as="geometry" /></mxCell>
      <mxCell id="b" value="Servicio B" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="200" width="100" height="40" as="geometry" /></mxCell>
      <mxCell id="e" value="llama" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry" /></mxCell>
    </root></mxGraphModel>`);
    const draft = toDraft(sinNumerar);
    expect(draft.warnings.some((warning) => /no demuestra el orden/.test(warning))).toBe(true);
    // Una cadena simple sí tiene un único orden posible y puede animarse.
    expect(parseDiagram(draft.yaml).diagram?.flows).toHaveLength(1);
  });

  it('no convierte un grafo ramificado sin numeración en un flujo gigante', () => {
    const evidence = fromDrawio(`<mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="40" as="geometry" /></mxCell>
      <mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="200" y="0" width="100" height="40" as="geometry" /></mxCell>
      <mxCell id="c" value="C" vertex="1" parent="1"><mxGeometry x="200" y="100" width="100" height="40" as="geometry" /></mxCell>
      <mxCell id="e1" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry" /></mxCell>
      <mxCell id="e2" edge="1" parent="1" source="a" target="c"><mxGeometry relative="1" as="geometry" /></mxCell>
    </root></mxGraphModel>`);
    const draft = toDraft(evidence);
    const parsed = parseDiagram(draft.yaml);
    expect(parsed.diagram?.edges).toHaveLength(2);
    expect(parsed.diagram?.flows).toHaveLength(0);
    expect(draft.warnings.some((warning) => /flujo gigante/.test(warning))).toBe(true);
  });

  it('conserva la figura módulo y marca los extremos propuestos por geometría', () => {
    const evidence = fromDrawio(`<mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="a" value="API UX" style="shape=module;strokeWidth=2;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry" /></mxCell>
      <mxCell id="b" value="MS UX" style="shape=module;" vertex="1" parent="1"><mxGeometry x="240" y="0" width="120" height="60" as="geometry" /></mxCell>
      <mxCell id="e" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"><mxPoint x="240" y="30" as="targetPoint" /></mxGeometry></mxCell>
    </root></mxGraphModel>`);
    expect(evidence.links[0]).toMatchObject({ source: 'a', target: 'b', targetInferred: true });
    const parsed = parseDiagram(toDraft(evidence).yaml);
    expect(parsed.diagram?.nodes.find((node) => node.id === 'api-ux')?.appearance).toMatchObject({ shape: 'module', strokeWidth: 2 });
    expect(parsed.diagram?.edges[0]).toMatchObject({ targetInferred: true });
    expect(parsed.issues.filter((issue) => issue.level === 'warning')).toHaveLength(1);
    expect(parsed.issues[0]?.path).toEqual(['edges', 0]);
  });

  it('eleva grupos y entiende iconos de librería sin convertirlos en decoración', () => {
    const evidence = fromDrawio(`<mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="cloud" value="Cloud" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="900" height="500" as="geometry" /></mxCell>
      <mxCell id="group" style="group;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="220" height="60" as="geometry" /></mxCell>
      <mxCell id="api" value="&lt;&lt;API BS&gt;&gt; Pagos" style="html=1;" vertex="1" parent="group"><mxGeometry x="0" y="0" width="220" height="60" as="geometry" /></mxCell>
      <mxCell id="deco" style="shape=component;" vertex="1" parent="group"><mxGeometry x="1" y="1" width="20" height="20" as="geometry" /></mxCell>
      <mxCell id="cosmos" value="Transacciones" style="image;image=img/lib/azure2/databases/Azure_Cosmos_DB.svg;" vertex="1" parent="1"><mxGeometry x="500" y="120" width="68" height="68" as="geometry" /></mxCell>
      <mxCell id="e" value="1. POST /pagos" edge="1" parent="1" source="deco" target="cosmos"><mxGeometry relative="1" as="geometry" /></mxCell>
    </root></mxGraphModel>`);

    expect(evidence.shapes.find((shape) => shape.id === 'deco')).toBeUndefined();
    expect(evidence.links[0]).toMatchObject({ source: 'api', target: 'cosmos' });
    expect(evidence.shapes.find((shape) => shape.id === 'cosmos')).toMatchObject({
      kind: 'database',
      drawioIcon: 'azure-cosmos-db',
    });

    const draft = toDraft(evidence);
    const parsed = parseDiagram(draft.yaml);
    expect(parsed.ok).toBe(true);
    const ir = compile(parsed.diagram!);
    expect(ir.zones.map((zone) => zone.label)).toContain('Cloud');
    expect(ir.nodes.find((node) => node.label === 'Transacciones')?.tech).toBe('Azure Cosmos DB');
  });
});

describe('importar de ArchiMate', () => {
  const source = `archiflow: 1
name: Ida y vuelta
zones:
  - id: negocio
    label: Negocio
nodes:
  - id: apigw
    label: API Gateway
    kind: gateway
    zone: negocio
  - id: svc
    label: ms-cuentas
    kind: service
    zone: negocio
  - id: db
    label: Oracle
    kind: database
  - id: kafka
    label: Kafka
    kind: broker
flows:
  - id: f
    steps:
      - from: apigw
        to: svc
        op: GET /v1/cuentas
      - from: svc
        to: db
        protocol: jdbc
      - from: svc
        to: kafka
        protocol: kafka
        async: true
`;

  it('vuelve del formato de intercambio conservando tipos y zonas', async () => {
    const xml = await toArchimate(compile(parseDiagram(source).diagram!));
    expect(detectFormat(xml)).toBe('archimate');

    const draft = toDraft(importDiagram(xml));
    const parsed = parseDiagram(draft.yaml);
    expect(parsed.ok).toBe(true);

    const ir = compile(parsed.diagram!);
    const kind = (label: string) => ir.nodes.find((node) => node.label === label)?.kind;
    expect(kind('API Gateway')).toBe('gateway');
    expect(kind('ms-cuentas')).toBe('service');
    expect(kind('Oracle')).toBe('database');
    expect(kind('Kafka')).toBe('broker');
    expect(ir.zones.map((zone) => zone.label)).toEqual(['Negocio']);
    expect(ir.nodes.find((node) => node.label === 'ms-cuentas')?.zone).toBe('negocio');
  });

  it('avisa de que el orden de los pasos no viaja en el formato', async () => {
    const xml = await toArchimate(compile(parseDiagram(source).diagram!));
    const evidence = importDiagram(xml);
    expect(evidence.warnings.some((warning) => /no guarda el orden/.test(warning))).toBe(true);
  });
});

describe('detectFormat', () => {
  it('elige por contenido, no por extensión', () => {
    expect(detectFormat('<mxfile><diagram/></mxfile>')).toBe('drawio');
    expect(detectFormat('<?xml version="1.0"?><model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" identifier="m">')).toBe('archimate');
    expect(detectFormat('archiflow: 1')).toBe(null);
    expect(() => importDiagram('archiflow: 1')).toThrow(/no parece/);
  });
});
