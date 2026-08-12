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
  console.error('Uso: node build-inventory-xlsx.mjs <inventario.json> --out inventario.xlsx [--preview-dir previews]');
  process.exit(2);
}

const output = path.resolve(option('--out', path.basename(input, path.extname(input)) + '.xlsx'));
const previewDir = option('--preview-dir');
const data = JSON.parse(await fs.readFile(input, 'utf8'));
const workbook = Workbook.create();
const summary = workbook.worksheets.add('Resumen');
const inventory = workbook.worksheets.add('Inventario');
const services = workbook.worksheets.add('Servicios');
const dependencies = workbook.worksheets.add('Dependencias');
const audit = workbook.worksheets.add('Auditoría XML');

const colors = {
  navy: '#15324A',
  blue: '#176B87',
  teal: '#2E8B8B',
  paleTeal: '#E8F4F3',
  paleBlue: '#EAF1F7',
  paleAmber: '#FFF4D6',
  paleRed: '#FCE8E6',
  text: '#243746',
  muted: '#607786',
  line: '#D7E2E8',
  white: '#FFFFFF',
};

for (const sheet of [summary, inventory, services, dependencies, audit]) sheet.showGridLines = false;

function titleBand(sheet, title, subtitle, lastColumn) {
  sheet.getRange(`A1:${lastColumn}1`).merge();
  sheet.getRange('A1').values = [[title]];
  sheet.getRange('A1').format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white, size: 18 },
    verticalAlignment: 'center',
  };
  sheet.getRange('1:1').format.rowHeight = 34;
  sheet.getRange(`A2:${lastColumn}2`).merge();
  sheet.getRange('A2').values = [[subtitle]];
  sheet.getRange('A2').format = {
    fill: colors.paleBlue,
    font: { color: colors.muted, italic: true, size: 10 },
    wrapText: true,
    verticalAlignment: 'center',
  };
  sheet.getRange('2:2').format.rowHeight = 30;
}

function styleHeader(range) {
  range.format = {
    fill: colors.blue,
    font: { bold: true, color: colors.white, size: 10 },
    wrapText: true,
    verticalAlignment: 'center',
    borders: { preset: 'outside', style: 'thin', color: colors.blue },
  };
  range.format.rowHeight = 34;
}

function setColumnWidths(sheet, widths) {
  for (const [column, width] of Object.entries(widths)) sheet.getRange(`${column}:${column}`).format.columnWidth = width;
}

const inventoryHeaders = [
  'Flujo', 'Servicio', 'Capa', 'Método', 'Ruta conservada del XML', 'Descripción', 'Propósito del servicio',
  'Consume-Servicio', 'Consume-Endpoint', 'Redis', 'Mapa1', 'Mapa2', 'Mapa3', 'Otros mapas',
  'Base de Datos', 'Estado de revisión', 'Confianza', 'Evidencia XML',
];
const inventoryRows = data.inventory.map((row) => [
  row.flow,
  row.service,
  row.layer,
  row.method,
  row.route,
  row.description,
  row.servicePurpose,
  row.dependencyServices.join('\n'),
  row.dependencyEndpoints.join('\n'),
  row.redis,
  row.maps[0] || '',
  row.maps[1] || '',
  row.maps[2] || '',
  row.maps.slice(3).join('\n'),
  row.database,
  row.reviewStatus,
  row.confidence,
  row.evidenceIds.join(', '),
]);
titleBand(inventory, 'Inventario técnico de endpoints', `${data.source} · ${data.convention}`, 'R');
inventory.getRange(`A4:R${4 + inventoryRows.length}`).values = [inventoryHeaders, ...inventoryRows];
styleHeader(inventory.getRange('A4:R4'));
const inventoryTable = inventory.tables.add(`A4:R${4 + inventoryRows.length}`, true, 'InventarioEndpoints');
inventoryTable.style = 'TableStyleMedium2';
inventoryTable.showBandedRows = true;
inventory.getRange(`A5:R${4 + inventoryRows.length}`).format = {
  font: { color: colors.text, size: 9 },
  verticalAlignment: 'top',
  wrapText: true,
};
inventory.getRange(`D5:D${4 + inventoryRows.length}`).format = { horizontalAlignment: 'center', font: { bold: true, color: colors.blue } };
inventory.getRange(`J5:J${4 + inventoryRows.length}`).format.horizontalAlignment = 'center';
inventory.getRange(`P5:P${4 + inventoryRows.length}`).dataValidation = {
  rule: { type: 'list', values: ['Por validar con OpenAPI/código', 'Validado', 'Observado en XML', 'Descartado'] },
};
inventory.getRange(`P5:P${4 + inventoryRows.length}`).conditionalFormats.add('containsText', {
  text: 'Por validar', format: { fill: colors.paleAmber, font: { color: '#7A5200' } },
});
inventory.getRange(`J5:J${4 + inventoryRows.length}`).conditionalFormats.add('containsText', {
  text: 'Sí', format: { fill: colors.paleTeal, font: { bold: true, color: '#116466' } },
});
inventory.freezePanes.freezeRows(4);
inventory.freezePanes.freezeColumns(2);
setColumnWidths(inventory, {
  A: 27, B: 34, C: 15, D: 10, E: 49, F: 42, G: 42, H: 34, I: 48,
  J: 10, K: 31, L: 31, M: 31, N: 30, O: 26, P: 30, Q: 14, R: 26,
});
inventory.getRange(`A5:R${4 + inventoryRows.length}`).format.rowHeight = 60;

const serviceHeaders = ['Servicio', 'Capa', 'Propósito', 'Cantidad de endpoints', 'Redis', 'Mapas Redis', 'Base de Datos', 'Apariciones XML', 'Evidencia XML'];
const serviceRows = data.services.map((row) => [
  row.service, row.layer, row.purpose, null, row.redis, row.maps.join('\n'), row.database, row.appearanceCount, row.evidenceIds.join(', '),
]);
titleBand(services, 'Servicios identificados', 'Servicios deduplicados por identidad semántica; las apariciones visuales se conservan para auditoría.', 'I');
services.getRange(`A4:I${4 + serviceRows.length}`).values = [serviceHeaders, ...serviceRows];
for (let row = 5; row <= 4 + serviceRows.length; row += 1) {
  services.getRange(`D${row}`).formulas = [[`=COUNTIF('Inventario'!$B$5:$B$${4 + inventoryRows.length},A${row})`]];
}
styleHeader(services.getRange('A4:I4'));
const servicesTable = services.tables.add(`A4:I${4 + serviceRows.length}`, true, 'ServiciosTecnicos');
servicesTable.style = 'TableStyleMedium2';
services.getRange(`A5:I${4 + serviceRows.length}`).format = { font: { color: colors.text, size: 9 }, verticalAlignment: 'top', wrapText: true };
services.getRange(`D5:E${4 + serviceRows.length}`).format.horizontalAlignment = 'center';
services.getRange(`D5:D${4 + serviceRows.length}`).format.numberFormat = '#,##0';
services.getRange(`E5:E${4 + serviceRows.length}`).conditionalFormats.add('containsText', {
  text: 'Sí', format: { fill: colors.paleTeal, font: { bold: true, color: '#116466' } },
});
services.freezePanes.freezeRows(4);
setColumnWidths(services, { A: 42, B: 17, C: 45, D: 19, E: 11, F: 42, G: 30, H: 16, I: 36 });
services.getRange(`5:${4 + serviceRows.length}`).format.rowHeight = 42;

const dependencyHeaders = ['Consume-Servicio', 'Consume-Endpoint', 'Servicio proveedor', 'Endpoint consumido', 'Protocolo', 'Evidencia XML', 'Confianza'];
const dependencyRows = data.dependencies.map((row) => [
  row.consumerService, row.consumerEndpoint, row.providerService, row.providerEndpoint, row.protocol, row.evidenceId, row.confidence,
]);
titleBand(dependencies, 'Dependencias entre servicios', 'Cada fila representa una relación normalizada consumidor → proveedor; PENDIENTE significa que el XML no identifica el endpoint consumido.', 'G');
dependencies.getRange(`A4:G${4 + dependencyRows.length}`).values = [dependencyHeaders, ...dependencyRows];
styleHeader(dependencies.getRange('A4:G4'));
const dependenciesTable = dependencies.tables.add(`A4:G${4 + dependencyRows.length}`, true, 'DependenciasServicios');
dependenciesTable.style = 'TableStyleMedium2';
dependencies.getRange(`A5:G${4 + dependencyRows.length}`).format = { font: { color: colors.text, size: 9 }, verticalAlignment: 'top', wrapText: true };
dependencies.getRange(`D5:D${4 + dependencyRows.length}`).conditionalFormats.add('containsText', {
  text: 'PENDIENTE', format: { fill: colors.paleAmber, font: { bold: true, color: '#7A5200' } },
});
dependencies.freezePanes.freezeRows(4);
setColumnWidths(dependencies, { A: 39, B: 49, C: 39, D: 56, E: 14, F: 28, G: 16 });
dependencies.getRange(`5:${4 + dependencyRows.length}`).format.rowHeight = 38;

titleBand(summary, 'Resumen ejecutivo del diagrama', 'Conteos trazables al XML; las interpretaciones funcionales permanecen pendientes de OpenAPI o código.', 'H');
summary.getRange('A4:A6').values = [['Fuente XML'], ['Generado'], ['Convención']];
for (const [row, value] of [[4, data.source], [5, data.generatedAt.slice(0, 19).replace('T', ' ')], [6, data.convention]]) {
  summary.getRange(`B${row}:H${row}`).merge();
  summary.getRange(`B${row}`).values = [[value]];
}
summary.getRange('A4:A6').format = { fill: colors.paleBlue, font: { bold: true, color: colors.navy }, verticalAlignment: 'top' };
summary.getRange('B4:H6').format = { font: { color: colors.text }, wrapText: true, verticalAlignment: 'top' };
summary.getRange('A4:H6').format.borders = { preset: 'outside', style: 'thin', color: colors.line };

const serviceLast = 4 + serviceRows.length;
const inventoryLast = 4 + inventoryRows.length;
const dependencyLast = 4 + dependencyRows.length;
summary.getRange('A8:H8').values = [['Servicios únicos', '', 'Endpoints', '', 'Dependencias', '', 'Servicios con Redis', '']];
summary.getRange('A9:H9').formulas = [[
  `=COUNTA('Servicios'!$A$5:$A$${serviceLast})`, '',
  `=COUNTA('Inventario'!$D$5:$D$${inventoryLast})`, '',
  `=COUNTA('Dependencias'!$A$5:$A$${dependencyLast})`, '',
  `=COUNTIF('Servicios'!$E$5:$E$${serviceLast},"Sí")`, '',
]];
for (const pair of [['A8:B9'], ['C8:D9'], ['E8:F9'], ['G8:H9']]) {
  const range = summary.getRange(pair[0]);
  range.format = { fill: colors.paleTeal, borders: { preset: 'outside', style: 'thin', color: colors.teal } };
}
summary.getRange('A8:H8').format = { font: { bold: true, color: colors.muted, size: 10 }, horizontalAlignment: 'center' };
summary.getRange('A9:H9').format = { font: { bold: true, color: colors.navy, size: 20 }, horizontalAlignment: 'center', numberFormat: '#,##0' };

const flows = [...new Set(data.inventory.map((row) => row.flow))].sort((a, b) => a.localeCompare(b, 'es'));
summary.getRange('A12:B12').values = [['Endpoints por flujo', 'Cantidad']];
styleHeader(summary.getRange('A12:B12'));
summary.getRange(`A13:A${12 + flows.length}`).values = flows.map((flow) => [flow]);
for (let row = 13; row <= 12 + flows.length; row += 1) summary.getRange(`B${row}`).formulas = [[`=COUNTIF('Inventario'!$A$5:$A$${inventoryLast},A${row})`]];
summary.getRange(`A13:B${12 + flows.length}`).format = { font: { color: colors.text, size: 9 }, borders: { preset: 'inside', style: 'thin', color: colors.line } };
summary.getRange(`B13:B${12 + flows.length}`).format = { numberFormat: '#,##0', horizontalAlignment: 'center' };

const layers = [...new Set(data.services.map((row) => row.layer))].sort((a, b) => a.localeCompare(b, 'es'));
summary.getRange('D12:E12').values = [['Servicios por capa', 'Cantidad']];
styleHeader(summary.getRange('D12:E12'));
summary.getRange(`D13:D${12 + layers.length}`).values = layers.map((layer) => [layer]);
for (let row = 13; row <= 12 + layers.length; row += 1) summary.getRange(`E${row}`).formulas = [[`=COUNTIF('Servicios'!$B$5:$B$${serviceLast},D${row})`]];
summary.getRange(`D13:E${12 + layers.length}`).format = { font: { color: colors.text, size: 9 }, borders: { preset: 'inside', style: 'thin', color: colors.line } };
summary.getRange(`E13:E${12 + layers.length}`).format = { numberFormat: '#,##0', horizontalAlignment: 'center' };

summary.getRange('G12:H12').values = [['Revisión', 'Cantidad']];
styleHeader(summary.getRange('G12:H12'));
summary.getRange('G13:G14').values = [['Con Redis'], ['Con base de datos/almacén']];
summary.getRange('H13:H14').formulas = [[
  `=COUNTIF('Servicios'!$E$5:$E$${serviceLast},"Sí")`,
], [
  `=COUNTIF('Servicios'!$G$5:$G$${serviceLast},"<>No")`,
]];
summary.getRange('G13:H14').format = { font: { color: colors.text, size: 9 }, borders: { preset: 'inside', style: 'thin', color: colors.line } };
summary.getRange('H13:H14').format = { numberFormat: '#,##0', horizontalAlignment: 'center' };
summary.freezePanes.freezeRows(2);
setColumnWidths(summary, { A: 39, B: 34, C: 5, D: 29, E: 14, F: 5, G: 31, H: 14 });
summary.getRange('4:6').format.rowHeight = 28;

titleBand(audit, 'Auditoría del XML', 'Hechos extraídos, reglas de normalización y advertencias para revisión humana.', 'F');
audit.getRange('A4:B9').values = [
  ['Métrica', 'Valor'],
  ['Figuras XML', data.counts.shapes],
  ['Conectores XML', data.counts.links],
  ['Servicios únicos', data.counts.services],
  ['Endpoints únicos', data.counts.endpoints],
  ['Dependencias normalizadas', data.counts.dependencies],
];
styleHeader(audit.getRange('A4:B4'));
audit.getRange('A5:A9').format = { fill: colors.paleBlue, font: { bold: true, color: colors.navy } };
audit.getRange('B5:B9').format = { numberFormat: '#,##0', horizontalAlignment: 'center', font: { color: colors.text } };
audit.getRange('A4:B9').format.borders = { preset: 'outside', style: 'thin', color: colors.line };
audit.getRange('D4:F4').merge();
audit.getRange('D4').values = [['Advertencias']];
styleHeader(audit.getRange('D4:F4'));
const warnings = data.warnings.length ? data.warnings : ['Sin advertencias del importador.'];
for (let index = 0; index < warnings.length; index += 1) {
  const row = 5 + index;
  audit.getRange(`D${row}:F${row}`).merge();
  audit.getRange(`D${row}`).values = [[warnings[index]]];
  audit.getRange(`D${row}:F${row}`).format = { fill: colors.paleAmber, font: { color: '#7A5200' }, wrapText: true, verticalAlignment: 'top', borders: { preset: 'outside', style: 'thin', color: '#F0D58A' } };
  audit.getRange(`${row}:${row}`).format.rowHeight = 42;
}
audit.getRange('A12:F12').merge();
audit.getRange('A12').values = [['Criterio de interpretación']];
styleHeader(audit.getRange('A12:F12'));
audit.getRange('A13:F16').values = [
  ['Rutas', 'Se conservan variables, dobles barras, espacios, mayúsculas, errores y query strings tal como aparecen en el XML.', '', '', '', ''],
  ['Ownership', 'Se asigna el endpoint al servicio más pequeño que lo contiene geométricamente.', '', '', '', ''],
  ['Dependencias', 'Las flechas del archivo apuntan del proveedor al consumidor; la salida se normaliza como consumidor → proveedor.', '', '', '', ''],
  ['Semántica', 'Flujo, descripción y propósito son inferidos y permanecen pendientes hasta contrastarlos con OpenAPI o código.', '', '', '', ''],
];
for (let row = 13; row <= 16; row += 1) {
  audit.getRange(`B${row}:F${row}`).merge();
  audit.getRange(`A${row}:F${row}`).format = { font: { color: colors.text, size: 9 }, wrapText: true, verticalAlignment: 'top', borders: { preset: 'outside', style: 'thin', color: colors.line } };
  audit.getRange(`A${row}`).format = { fill: colors.paleBlue, font: { bold: true, color: colors.navy } };
  audit.getRange(`${row}:${row}`).format.rowHeight = 40;
}
setColumnWidths(audit, { A: 22, B: 22, C: 4, D: 34, E: 34, F: 34 });

const checks = [];
checks.push((await workbook.inspect({ kind: 'table', range: `Inventario!A4:R${Math.min(inventoryLast, 12)}`, include: 'values,formulas', tableMaxRows: 12, tableMaxCols: 18 })).ndjson);
checks.push((await workbook.inspect({ kind: 'table', range: 'Resumen!A1:H18', include: 'values,formulas', tableMaxRows: 18, tableMaxCols: 8 })).ndjson);
checks.push((await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'final formula error scan' })).ndjson);

if (previewDir) {
  await fs.mkdir(previewDir, { recursive: true });
  for (const sheetName of ['Resumen', 'Inventario', 'Servicios', 'Dependencias', 'Auditoría XML']) {
    const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
    await fs.writeFile(path.join(previewDir, `${sheetName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
}

await fs.mkdir(path.dirname(output), { recursive: true });
const file = await SpreadsheetFile.exportXlsx(workbook);
await file.save(output);
await fs.writeFile(`${output}.inspect.ndjson`, `${checks.filter(Boolean).join('\n')}\n`, 'utf8');
console.log(output);
