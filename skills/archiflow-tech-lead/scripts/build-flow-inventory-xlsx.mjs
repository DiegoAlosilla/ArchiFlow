#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith('--'));
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

if (!input) {
  console.error('Uso: node build-flow-inventory-xlsx.mjs <inventario-flujos.json> --out inventario.xlsx [--preview-dir previews]');
  process.exit(2);
}

const output = path.resolve(option('--out', 'inventario-flujos.xlsx'));
const previewDir = option('--preview-dir');
const data = JSON.parse(await fs.readFile(input, 'utf8'));
const workbook = Workbook.create();
const summary = workbook.worksheets.add('Resumen');
const flowsSheet = workbook.worksheets.add('Flujos');
const componentsSheet = workbook.worksheets.add('Componentes por flujo');
const dependenciesSheet = workbook.worksheets.add('Dependencias por flujo');
const endpointsSheet = workbook.worksheets.add('Endpoints');
const auditSheet = workbook.worksheets.add('Auditoría XML');

const palette = {
  navy: '#15324A', blue: '#176B87', teal: '#2E8B8B', white: '#FFFFFF', text: '#243746', muted: '#607786',
  line: '#D7E2E8', paleBlue: '#EAF1F7', paleTeal: '#E8F4F3', paleAmber: '#FFF4D6', paleRed: '#FCE8E6',
};
for (const sheet of [summary, flowsSheet, componentsSheet, dependenciesSheet, endpointsSheet, auditSheet]) sheet.showGridLines = false;

function title(sheet, name, subtitle, lastColumn) {
  sheet.getRange(`A1:${lastColumn}1`).merge();
  sheet.getRange('A1').values = [[name]];
  sheet.getRange('A1').format = { fill: palette.navy, font: { bold: true, color: palette.white, size: 18 }, verticalAlignment: 'center' };
  sheet.getRange('1:1').format.rowHeight = 34;
  sheet.getRange(`A2:${lastColumn}2`).merge();
  sheet.getRange('A2').values = [[subtitle]];
  sheet.getRange('A2').format = { fill: palette.paleBlue, font: { italic: true, color: palette.muted, size: 10 }, wrapText: true, verticalAlignment: 'center' };
  sheet.getRange('2:2').format.rowHeight = 30;
}

function header(range) {
  range.format = { fill: palette.blue, font: { bold: true, color: palette.white, size: 10 }, wrapText: true, verticalAlignment: 'center' };
  range.format.rowHeight = 36;
}

function widths(sheet, config) {
  for (const [column, width] of Object.entries(config)) sheet.getRange(`${column}:${column}`).format.columnWidth = width;
}

function tableSheet(sheet, name, headers, rows, lastColumn, tableName, widthConfig, rowHeight = 44) {
  const lastRow = 4 + rows.length;
  sheet.getRange(`A4:${lastColumn}${lastRow}`).values = [headers, ...rows];
  header(sheet.getRange(`A4:${lastColumn}4`));
  const table = sheet.tables.add(`A4:${lastColumn}${lastRow}`, true, tableName);
  table.style = 'TableStyleMedium2';
  table.showBandedRows = true;
  sheet.getRange(`A5:${lastColumn}${lastRow}`).format = { font: { color: palette.text, size: 9 }, verticalAlignment: 'top', wrapText: true };
  sheet.getRange(`A5:${lastColumn}${lastRow}`).format.rowHeight = rowHeight;
  sheet.freezePanes.freezeRows(4);
  sheet.freezePanes.freezeColumns(2);
  widths(sheet, widthConfig);
  return lastRow;
}

title(flowsSheet, 'Inventario de flujos', 'Cada fila representa un recorrido completo y enlaza su diagrama ArchiFlow individual.', 'Q');
const flowHeaders = [
  'Flow ID', 'Flujo', 'Endpoint de entrada', 'Componentes', 'Dependencias', 'Endpoints', 'Servicios', 'Golpea caché',
  'Mapa1', 'Mapa2', 'Mapa3', 'Otros mapas', 'Golpea base de datos', 'Bases de datos/almacenes', 'Diagrama individual', 'Confianza', 'Estado de revisión',
];
const flowRows = data.flows.map((flow) => [
  flow.flowId, flow.flow, flow.entryEndpoint, null, null, null, null, flow.hasCache,
  flow.maps[0] || '', flow.maps[1] || '', flow.maps[2] || '', flow.maps.slice(3).join('\n'),
  flow.hasDatabase, flow.databases.join('\n'), flow.diagramFile, flow.confidence, flow.reviewStatus,
]);
const flowLast = tableSheet(flowsSheet, 'Flujos', flowHeaders, flowRows, 'Q', 'FlujosArquitectura', {
  A: 38, B: 40, C: 52, D: 15, E: 15, F: 13, G: 12, H: 15, I: 34, J: 34, K: 34, L: 30, M: 20, N: 34, O: 48, P: 14, Q: 29,
});

title(componentsSheet, 'Componentes por flujo', 'Orden y rama muestran cómo participa cada componente dentro de su recorrido, incluidos mapas Redis y almacenes.', 'O');
const componentHeaders = [
  'Flow ID', 'Flujo', 'Orden', 'Rama', 'Componente', 'Tipo', 'Capa', 'Rol', 'Endpoint(s)', 'Recurso(s)',
  'Consume caché', 'Consume base de datos', 'Propósito', 'Confianza', 'Evidencia XML',
];
const componentRows = data.flowComponents.map((component) => [
  component.flowId, component.flow, component.order, component.branch, component.component, component.type, component.layer,
  component.role, component.endpoints.join('\n'), component.resources.join('\n'), component.hasCache, component.hasDatabase,
  component.purpose, component.confidence, component.evidenceIds.join(', '),
]);
const componentLast = tableSheet(componentsSheet, 'Componentes por flujo', componentHeaders, componentRows, 'O', 'ComponentesFlujo', {
  A: 38, B: 38, C: 10, D: 14, E: 43, F: 13, G: 16, H: 24, I: 54, J: 38, K: 16, L: 22, M: 44, N: 14, O: 32,
}, 50);
componentsSheet.getRange(`C5:C${componentLast}`).format = { numberFormat: '#,##0', horizontalAlignment: 'center' };
componentsSheet.getRange(`K5:L${componentLast}`).conditionalFormats.add('containsText', { text: 'Sí', format: { fill: palette.paleTeal, font: { bold: true, color: '#116466' } } });

title(dependenciesSheet, 'Dependencias por flujo', 'Una fila por salto: entrada, servicio, caché o base de datos. Las ramas conservan el abanico completo del orquestador.', 'L');
const dependencyHeaders = [
  'Flow ID', 'Flujo', 'Paso', 'Rama', 'Componente origen', 'Endpoint origen', 'Tipo de dependencia',
  'Componente destino', 'Endpoint/Recurso destino', 'Protocolo', 'Confianza', 'Evidencia XML',
];
const dependencyStep = new Map();
const dependencyRows = data.flowDependencies.map((dependency) => {
  const step = (dependencyStep.get(dependency.flowId) || 0) + 1;
  dependencyStep.set(dependency.flowId, step);
  return [
    dependency.flowId, dependency.flow, step, dependency.branch, dependency.fromComponent, dependency.fromEndpoint,
    dependency.dependencyType, dependency.toComponent, dependency.toEndpoint, dependency.protocol, dependency.confidence, dependency.evidenceId,
  ];
});
const dependencyLast = tableSheet(dependenciesSheet, 'Dependencias por flujo', dependencyHeaders, dependencyRows, 'L', 'DependenciasFlujo', {
  A: 38, B: 38, C: 10, D: 14, E: 43, F: 52, G: 22, H: 43, I: 58, J: 14, K: 14, L: 29,
}, 46);
dependenciesSheet.getRange(`C5:C${dependencyLast}`).format = { numberFormat: '#,##0', horizontalAlignment: 'center' };
dependenciesSheet.getRange(`G5:G${dependencyLast}`).conditionalFormats.add('containsText', { text: 'cache', format: { fill: palette.paleAmber, font: { bold: true, color: '#7A5200' } } });
dependenciesSheet.getRange(`G5:G${dependencyLast}`).conditionalFormats.add('containsText', { text: 'base de datos', format: { fill: palette.paleRed, font: { bold: true, color: '#8B2E24' } } });
dependenciesSheet.getRange(`I5:I${dependencyLast}`).conditionalFormats.add('containsText', { text: 'PENDIENTE', format: { fill: palette.paleAmber, font: { bold: true, color: '#7A5200' } } });

title(endpointsSheet, 'Catálogo de endpoints', 'Vista secundaria: operaciones deduplicadas y asociadas al flujo, con rutas conservadas literalmente desde el XML.', 'R');
const endpointHeaders = [
  'Flujo', 'Servicio', 'Capa', 'Método', 'Ruta conservada del XML', 'Descripción', 'Propósito del servicio',
  'Consume-Servicio', 'Consume-Endpoint', 'Redis', 'Mapa1', 'Mapa2', 'Mapa3', 'Otros mapas', 'Base de Datos',
  'Estado de revisión', 'Confianza', 'Evidencia XML',
];
const endpointRows = data.inventory.map((endpoint) => [
  endpoint.flow, endpoint.service, endpoint.layer, endpoint.method, endpoint.route, endpoint.description, endpoint.servicePurpose,
  endpoint.dependencyServices.join('\n'), endpoint.dependencyEndpoints.join('\n'), endpoint.redis,
  endpoint.maps[0] || '', endpoint.maps[1] || '', endpoint.maps[2] || '', endpoint.maps.slice(3).join('\n'), endpoint.database,
  endpoint.reviewStatus, endpoint.confidence, endpoint.evidenceIds.join(', '),
]);
const endpointLast = tableSheet(endpointsSheet, 'Endpoints', endpointHeaders, endpointRows, 'R', 'CatalogoEndpoints', {
  A: 31, B: 39, C: 15, D: 10, E: 52, F: 40, G: 42, H: 38, I: 52, J: 10, K: 34, L: 34, M: 34, N: 30, O: 29, P: 29, Q: 14, R: 30,
}, 54);
endpointsSheet.getRange(`D5:D${endpointLast}`).format = { horizontalAlignment: 'center', font: { bold: true, color: palette.blue } };
endpointsSheet.getRange(`P5:P${endpointLast}`).dataValidation = { rule: { type: 'list', values: ['Por validar con OpenAPI/código', 'Validado', 'Observado en XML', 'Descartado'] } };
endpointsSheet.getRange(`P5:P${endpointLast}`).conditionalFormats.add('containsText', { text: 'Por validar', format: { fill: palette.paleAmber, font: { color: '#7A5200' } } });

for (let row = 5; row <= flowLast; row += 1) {
  flowsSheet.getRange(`D${row}`).formulas = [[`=COUNTIF('Componentes por flujo'!$A$5:$A$${componentLast},A${row})`]];
  flowsSheet.getRange(`E${row}`).formulas = [[`=COUNTIF('Dependencias por flujo'!$A$5:$A$${dependencyLast},A${row})`]];
  flowsSheet.getRange(`F${row}`).formulas = [[`=COUNTIF('Endpoints'!$A$5:$A$${endpointLast},B${row})`]];
  flowsSheet.getRange(`G${row}`).formulas = [[`=COUNTIFS('Componentes por flujo'!$A$5:$A$${componentLast},A${row},'Componentes por flujo'!$F$5:$F$${componentLast},"service")`]];
}
flowsSheet.getRange(`D5:G${flowLast}`).format = { numberFormat: '#,##0', horizontalAlignment: 'center' };
flowsSheet.getRange(`H5:H${flowLast}`).conditionalFormats.add('containsText', { text: 'Sí', format: { fill: palette.paleTeal, font: { bold: true, color: '#116466' } } });
flowsSheet.getRange(`M5:M${flowLast}`).conditionalFormats.add('containsText', { text: 'Sí', format: { fill: palette.paleRed, font: { bold: true, color: '#8B2E24' } } });
flowsSheet.getRange(`Q5:Q${flowLast}`).dataValidation = { rule: { type: 'list', values: ['Por validar con OpenAPI/código', 'Validado', 'Observado en XML', 'Descartado'] } };

title(summary, 'Inventario arquitectónico por flujo', 'El flujo es la entidad raíz; componentes, dependencias, cachés, datos y endpoints se derivan de cada recorrido.', 'H');
summary.getRange('A4:A6').values = [['Fuente XML'], ['Generado'], ['Criterio']];
for (const [row, value] of [[4, data.source], [5, data.generatedAt.slice(0, 19).replace('T', ' ')], [6, 'Ejecución normalizada consumidor → proveedor; rutas conservadas literalmente.']]) {
  summary.getRange(`B${row}:H${row}`).merge();
  summary.getRange(`B${row}`).values = [[value]];
}
summary.getRange('A4:A6').format = { fill: palette.paleBlue, font: { bold: true, color: palette.navy } };
summary.getRange('B4:H6').format = { font: { color: palette.text }, wrapText: true };
summary.getRange('A4:H6').format.borders = { preset: 'outside', style: 'thin', color: palette.line };

summary.getRange('A8:H8').values = [['Flujos', '', 'Componentes por flujo', '', 'Dependencias', '', 'Endpoints', '']];
summary.getRange('A9:H9').formulas = [[
  `=COUNTA('Flujos'!$A$5:$A$${flowLast})`, '', `=COUNTA('Componentes por flujo'!$A$5:$A$${componentLast})`, '',
  `=COUNTA('Dependencias por flujo'!$A$5:$A$${dependencyLast})`, '', `=COUNTA('Endpoints'!$D$5:$D$${endpointLast})`, '',
]];
for (const area of ['A8:B9', 'C8:D9', 'E8:F9', 'G8:H9']) summary.getRange(area).format = { fill: palette.paleTeal, borders: { preset: 'outside', style: 'thin', color: palette.teal } };
summary.getRange('A8:H8').format = { font: { bold: true, color: palette.muted, size: 10 }, horizontalAlignment: 'center' };
summary.getRange('A9:H9').format = { font: { bold: true, color: palette.navy, size: 20 }, horizontalAlignment: 'center', numberFormat: '#,##0' };

summary.getRange('A12:D12').values = [['Flujo', 'Componentes', 'Dependencias', 'Endpoints']];
header(summary.getRange('A12:D12'));
summary.getRange(`A13:A${12 + data.flows.length}`).values = data.flows.map((flow) => [flow.flow]);
for (let row = 13; row <= 12 + data.flows.length; row += 1) {
  summary.getRange(`B${row}`).formulas = [[`=COUNTIF('Componentes por flujo'!$B$5:$B$${componentLast},A${row})`]];
  summary.getRange(`C${row}`).formulas = [[`=COUNTIF('Dependencias por flujo'!$B$5:$B$${dependencyLast},A${row})`]];
  summary.getRange(`D${row}`).formulas = [[`=COUNTIF('Endpoints'!$A$5:$A$${endpointLast},A${row})`]];
}
summary.getRange(`A13:D${12 + data.flows.length}`).format = { font: { color: palette.text, size: 9 }, borders: { preset: 'inside', style: 'thin', color: palette.line } };
summary.getRange(`B13:D${12 + data.flows.length}`).format = { numberFormat: '#,##0', horizontalAlignment: 'center' };

summary.getRange('F12:H12').values = [['Cobertura técnica', 'Cantidad', 'Detalle']];
header(summary.getRange('F12:H12'));
summary.getRange('F13:F14').values = [['Flujos con caché'], ['Flujos con base de datos']];
summary.getRange('G13:G14').formulas = [[`=COUNTIF('Flujos'!$H$5:$H$${flowLast},"Sí")`], [`=COUNTIF('Flujos'!$M$5:$M$${flowLast},"Sí")`]];
summary.getRange('H13:H14').values = [['Revisar mapas en Flujos'], ['Incluye almacenes como Datalake']];
summary.getRange('F13:H14').format = { font: { color: palette.text, size: 9 }, borders: { preset: 'inside', style: 'thin', color: palette.line } };
summary.getRange('G13:G14').format = { numberFormat: '#,##0', horizontalAlignment: 'center' };
summary.freezePanes.freezeRows(2);
widths(summary, { A: 43, B: 17, C: 18, D: 17, E: 5, F: 29, G: 14, H: 35 });
summary.getRange('4:6').format.rowHeight = 28;

title(auditSheet, 'Auditoría del XML', 'Trazabilidad de la extracción y límites de la reconstrucción semántica.', 'F');
auditSheet.getRange('A4:B12').values = [
  ['Métrica', 'Valor'], ['Figuras XML', data.counts.shapes], ['Conectores XML', data.counts.links], ['Flujos detectados', data.counts.flows],
  ['Componentes por flujo', data.counts.flowComponents], ['Dependencias por flujo', data.counts.flowDependencies], ['Endpoints únicos', data.counts.endpoints],
  ['Flujos con caché', data.counts.flowsWithCache], ['Flujos con datos', data.counts.flowsWithDatabase],
];
header(auditSheet.getRange('A4:B4'));
auditSheet.getRange('A5:A12').format = { fill: palette.paleBlue, font: { bold: true, color: palette.navy } };
auditSheet.getRange('B5:B12').format = { numberFormat: '#,##0', horizontalAlignment: 'center', font: { color: palette.text } };
auditSheet.getRange('A4:B12').format.borders = { preset: 'outside', style: 'thin', color: palette.line };
auditSheet.getRange('D4:F4').merge();
auditSheet.getRange('D4').values = [['Reglas y advertencias']];
header(auditSheet.getRange('D4:F4'));
const notes = [
  'El flujo es la entidad raíz; un endpoint aislado no define por sí solo un recorrido.',
  'Las flechas del XML se interpretan en sentido lógico consumidor → proveedor.',
  'Los mapas Redis y bases de datos son componentes y dependencias explícitas del flujo.',
  'Las rutas conservan errores, espacios, variables y query strings del XML.',
  ...data.warnings,
];
for (let index = 0; index < notes.length; index += 1) {
  const row = 5 + index;
  auditSheet.getRange(`D${row}:F${row}`).merge();
  auditSheet.getRange(`D${row}`).values = [[notes[index]]];
  auditSheet.getRange(`D${row}:F${row}`).format = { fill: palette.paleAmber, font: { color: '#7A5200' }, wrapText: true, verticalAlignment: 'top', borders: { preset: 'outside', style: 'thin', color: '#F0D58A' } };
  auditSheet.getRange(`${row}:${row}`).format.rowHeight = 38;
}
widths(auditSheet, { A: 27, B: 16, C: 5, D: 37, E: 37, F: 37 });

const checks = [];
checks.push((await workbook.inspect({ kind: 'table', range: `Flujos!A4:Q${Math.min(flowLast, 10)}`, include: 'values,formulas', tableMaxRows: 10, tableMaxCols: 17 })).ndjson);
checks.push((await workbook.inspect({ kind: 'table', range: 'Resumen!A1:H18', include: 'values,formulas', tableMaxRows: 18, tableMaxCols: 8 })).ndjson);
checks.push((await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'final formula error scan' })).ndjson);

if (previewDir) {
  await fs.mkdir(previewDir, { recursive: true });
  for (const sheetName of ['Resumen', 'Flujos', 'Componentes por flujo', 'Dependencias por flujo', 'Endpoints', 'Auditoría XML']) {
    const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
    await fs.writeFile(path.join(previewDir, `${sheetName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
}

await fs.mkdir(path.dirname(output), { recursive: true });
const file = await SpreadsheetFile.exportXlsx(workbook);
await file.save(output);
await fs.writeFile(`${output}.inspect.ndjson`, `${checks.filter(Boolean).join('\n')}\n`, 'utf8');
console.log(output);
