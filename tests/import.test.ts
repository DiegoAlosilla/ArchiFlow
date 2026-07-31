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

describe('importar de draw.io', () => {
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

  it('descarta imágenes y rótulos, y lo avisa', async () => {
    const evidence = fromDrawio(await readFile(fixture, 'utf8'));
    expect(evidence.shapes.some((shape) => shape.label === 'Login')).toBe(false);
    expect(evidence.warnings.some((warning) => /imagen o maqueta/.test(warning))).toBe(true);
    expect(evidence.warnings.some((warning) => /rótulo suelto/.test(warning))).toBe(true);
    // Y la flecha que salía de la imagen se cae con ella.
    expect(evidence.links.some((link) => link.label === 'mockup')).toBe(false);
  });

  it('reconoce el carril como contenedor y el HTML de las etiquetas', async () => {
    const evidence = fromDrawio(await readFile(fixture, 'utf8'));
    const lane = evidence.shapes.find((shape) => shape.container);
    expect(lane?.label).toBe('Canales');
    expect(evidence.shapes.find((shape) => shape.id === 'movil')?.label).toBe('App Móvil iOS');
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
    expect(draft.warnings.some((warning) => /conjetura/.test(warning))).toBe(true);
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
