#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cac } from 'cac';
import pc from 'picocolors';
import { compile } from '../schema/compile.js';
import { parseDiagram, type Issue } from '../schema/parse.js';
import { scanRepository } from '../analyzer/index.js';
import { toDrawio } from '../export/drawio.js';
import { toJson } from '../export/json.js';
import { toMermaid } from '../export/mermaid.js';
import { toSvg } from '../export/svg.js';
import { loadAllDiagrams } from './loader.js';
import { serve } from './server.js';

const cli = cac('archiflow');

function printIssues(file: string, issues: Issue[]): void {
  for (const issue of issues) {
    const mark = issue.level === 'error' ? pc.red('×') : pc.yellow('!');
    const where = issue.line !== undefined ? pc.dim(`${file}:${issue.line}:${issue.column ?? 1}`) : pc.dim(file);
    console.log(`  ${mark} ${where} ${issue.message}`);
  }
}

cli
  .command('serve [dir]', 'Levanta la web local y vigila los diagramas')
  .option('-p, --port <port>', 'Puerto', { default: 4123 })
  .option('--open', 'Abre el navegador al arrancar', { default: false })
  .action(async (dir: string | undefined, options: { port: number; open: boolean }) => {
    const root = path.resolve(process.cwd(), dir ?? '.');
    await serve({ root, port: Number(options.port), open: options.open });
  });

cli
  .command('validate [dir]', 'Valida todos los .arch.yaml de un directorio')
  .action(async (dir: string | undefined) => {
    const root = path.resolve(process.cwd(), dir ?? '.');
    const diagrams = await loadAllDiagrams(root);

    if (diagrams.length === 0) {
      console.log(pc.yellow(`No se encontró ningún .arch.yaml en ${root}`));
      process.exitCode = 1;
      return;
    }

    let errors = 0;
    let warnings = 0;

    for (const entry of diagrams) {
      const status = entry.ok ? pc.green('✓') : pc.red('×');
      console.log(`${status} ${pc.bold(entry.file)} ${pc.dim(entry.name)}`);
      printIssues(entry.file, entry.issues);
      errors += entry.issues.filter((issue) => issue.level === 'error').length;
      warnings += entry.issues.filter((issue) => issue.level === 'warning').length;
    }

    console.log();
    console.log(
      `${diagrams.length} diagrama(s) · ${errors > 0 ? pc.red(`${errors} error(es)`) : pc.green('sin errores')} · ${pc.yellow(`${warnings} aviso(s)`)}`,
    );
    if (errors > 0) process.exitCode = 1;
  });

cli
  .command('export <file>', 'Exporta un diagrama a draw.io, SVG, Mermaid o JSON')
  .option('--to <format>', 'Formato: drawio | svg | mermaid | json', { default: 'drawio' })
  .option('-o, --out <file>', 'Fichero de salida')
  .option('--flow <id>', 'Resalta un flujo concreto (svg)')
  .option('--light', 'Tema claro, para imprimir o pegar en un documento (svg)', { default: false })
  .option('--transparent', 'Fondo transparente (svg)', { default: false })
  .action(
    async (
      file: string,
      options: { to: string; out?: string; flow?: string; light: boolean; transparent: boolean },
    ) => {
      const input = path.resolve(process.cwd(), file);
      const source = await readFile(input, 'utf8');
      const result = parseDiagram(source);

      if (!result.ok || !result.diagram) {
        console.log(pc.red(`No se pudo exportar ${file}:`));
        printIssues(file, result.issues);
        process.exitCode = 1;
        return;
      }

      const ir = compile(result.diagram);
      const format = options.to.toLowerCase();

      if (options.flow && !ir.flows.some((flow) => flow.id === options.flow)) {
        console.log(
          pc.red(`No existe el flujo '${options.flow}'. Hay: ${ir.flows.map((f) => f.id).join(', ')}`),
        );
        process.exitCode = 1;
        return;
      }

      let content: string;
      let extension: string;

      switch (format) {
        case 'drawio':
        case 'xml':
          content = await toDrawio(ir);
          extension = '.drawio';
          break;
        case 'svg':
          content = await toSvg(ir, {
            flowId: options.flow,
            light: options.light,
            transparent: options.transparent,
          });
          extension = '.svg';
          break;
        case 'mermaid':
        case 'md':
          content = toMermaid(ir);
          extension = '.md';
          break;
        case 'json':
          content = toJson(ir);
          extension = '.json';
          break;
        default:
          console.log(
            pc.red(`Formato desconocido: ${options.to}. Usa 'drawio', 'svg', 'mermaid' o 'json'.`),
          );
          process.exitCode = 1;
          return;
      }

      const suffix = options.flow ? `-${options.flow}${extension}` : extension;
      const output = options.out
        ? path.resolve(process.cwd(), options.out)
        : input.replace(/\.arch\.ya?ml$/i, suffix);

      await writeFile(output, content, 'utf8');
      console.log(`${pc.green('✓')} ${path.relative(process.cwd(), output)}`);

      if ((format === 'drawio' || format === 'xml') && ir.flows.length > 0) {
        console.log(
          pc.dim(`  ${ir.flows.length + 1} páginas: topología + una por flujo, con los pasos numerados.`),
        );
      }
      if (format === 'svg' && !options.flow && ir.flows.length > 0) {
        console.log(pc.dim(`  Usa --flow <id> para resaltar un recorrido concreto.`));
      }
      // PNG y JPG salen de este mismo SVG, pero rasterizarlos necesita un
      // navegador: se descargan desde la web con `archiflow serve`.
      if (format === 'svg') {
        console.log(pc.dim('  Para PNG o JPG, usa el menú Exportar de la web.'));
      }
    },
  );

cli
  .command('scan [repo]', 'Recolecta evidencias de un microservicio Quarkus o Spring Boot')
  .option('-o, --out <file>', 'Escribe el resultado en un fichero JSON')
  .action(async (repo: string | undefined, options: { out?: string }) => {
    const root = path.resolve(process.cwd(), repo ?? '.');
    const evidence = await scanRepository(root);

    if (options.out) {
      const output = path.resolve(process.cwd(), options.out);
      await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      console.log(`${pc.green('✓')} ${path.relative(process.cwd(), output)}`);
    } else {
      console.log(JSON.stringify(evidence, null, 2));
    }

    const { service, endpoints, outbound, messaging, datastores, warnings } = evidence;
    console.error();
    console.error(
      `  ${pc.bold(service.name)} ${pc.dim(`${service.framework}${service.frameworkVersion ? ` ${service.frameworkVersion}` : ''}`)}`,
    );
    console.error(
      `  ${endpoints.length} endpoint(s) · ${outbound.length} llamada(s) saliente(s) · ` +
        `${messaging.length} canal(es) · ${datastores.length} almacén(es)`,
    );

    // Las evidencias son indicios, no verdad: avisarlo aquí evita que alguien
    // publique un diagrama generado sin revisarlo.
    if (warnings.length > 0) {
      console.error(`  ${pc.yellow(`${warnings.length} aviso(s)`)}:`);
      for (const warning of warnings.slice(0, 8)) console.error(`    ${pc.dim('·')} ${warning}`);
      if (warnings.length > 8) console.error(`    ${pc.dim(`… y ${warnings.length - 8} más`)}`);
    }
    console.error();
  });

cli.help();
cli.version('0.1.0');

try {
  cli.parse();
} catch (error) {
  console.error(pc.red((error as Error).message));
  process.exitCode = 1;
}
