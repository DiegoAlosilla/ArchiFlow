import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  flattenYaml,
  hostToServiceName,
  joinPaths,
  parseProperties,
  resolvePlaceholders,
} from './config.js';
import { scanJavaFile } from './java.js';
import type { Datastore, Evidence, Framework, MessagingChannel, OutboundCall } from './types.js';

export * from './types.js';

/**
 * Recolector de evidencias de un repositorio Quarkus o Spring Boot.
 *
 * La estrategia está en el ADR-001 (decisión C): la configuración manda sobre
 * el código. `quarkus.rest-client.customer-api.url=http://ms-customer...`
 * identifica el destino con una precisión que ninguna heurística sobre el
 * código Java alcanza; el escaneo de fuentes solo aporta lo que la
 * configuración no puede dar (qué endpoints se exponen, qué canales se
 * consumen, qué entidades existen).
 */

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'target', 'build', 'out', '.gradle', '.idea', '.mvn', 'bin',
]);

/** Prefijos de propiedades que interesan; el resto es ruido para un diagrama. */
const RELEVANT_CONFIG = [
  'quarkus.rest-client', 'quarkus.datasource', 'quarkus.redis', 'quarkus.mongodb',
  'quarkus.http.root-path', 'quarkus.application.name', 'quarkus.kafka',
  'mp.messaging', 'kafka.bootstrap.servers',
  'spring.application.name', 'spring.datasource', 'spring.kafka', 'spring.redis',
  'spring.data.redis', 'spring.data.mongodb', 'spring.rabbitmq', 'spring.cloud',
  'server.servlet.context-path', 'feign.client',
];

interface RepoFiles {
  java: string[];
  config: string[];
  build: string[];
}

async function collectFiles(root: string): Promise<RepoFiles> {
  const files: RepoFiles = { java: [], config: [], build: [] };

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(full);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.java')) files.java.push(full);
        else if (/^application.*\.(properties|ya?ml)$/i.test(entry.name)) files.config.push(full);
        else if (/^(pom\.xml|build\.gradle(\.kts)?)$/i.test(entry.name)) files.build.push(full);
      }
    }
  };

  await walk(root);
  return files;
}

function detectFramework(buildSources: string[]): { framework: Framework; version?: string } {
  const combined = buildSources.join('\n');

  const quarkus = /<quarkus\.platform\.version>([^<]+)</.exec(combined)?.[1];
  if (quarkus || /io\.quarkus/.test(combined)) return { framework: 'quarkus', version: quarkus };

  const spring = /<parent>[\s\S]*?spring-boot-starter-parent[\s\S]*?<version>([^<]+)</.exec(combined)?.[1];
  if (spring || /org\.springframework\.boot/.test(combined)) {
    return { framework: 'spring-boot', version: spring };
  }

  return { framework: 'unknown' };
}

/** Vendor a partir de una URL JDBC: `jdbc:oracle:thin:@host` → Oracle. */
function vendorFromJdbc(url: string): string | undefined {
  const scheme = /^jdbc:([a-z0-9]+):/i.exec(url)?.[1]?.toLowerCase();
  const vendors: Record<string, string> = {
    oracle: 'Oracle', postgresql: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB',
    sqlserver: 'SQL Server', db2: 'Db2', h2: 'H2',
  };
  return scheme ? vendors[scheme] ?? scheme : undefined;
}

/** Correlaciona cada cliente REST con la URL que le corresponde en la configuración. */
function resolveOutboundUrls(outbound: OutboundCall[], config: Record<string, string>): void {
  for (const call of outbound) {
    if (!call.url && call.configKey) {
      const key = call.configKey;
      const candidates = [
        `quarkus.rest-client.${key}.url`,
        `quarkus.rest-client."${key}".url`,
        `${key}/mp-rest/url`, // MicroProfile clásico, aún muy presente
        `feign.client.config.${key}.url`,
        `${key}.url`,
        `${key}.ribbon.listOfServers`,
      ];
      for (const candidate of candidates) {
        const value = config[candidate];
        if (value) {
          call.url = value;
          break;
        }
      }
    }

    if (call.url) {
      call.url = resolvePlaceholders(call.url, config);
      call.targetHint = hostToServiceName(call.url);
    }

    // Sin URL resoluble, el nombre de la interfaz suele ser la mejor pista
    // disponible: `CustomerRestClient` → `customer`.
    if (!call.targetHint) {
      const derived = call.declaredIn
        .replace(/(Rest)?(Client|Api|Service|Resource|Gateway|Proxy)$/i, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
      if (derived && derived !== call.declaredIn.toLowerCase()) call.targetHint = derived;
    }
  }
}

/** Completa cada canal SmallRye con su topic y su broker desde `mp.messaging.*`. */
function resolveMessaging(messaging: MessagingChannel[], config: Record<string, string>): void {
  for (const channel of messaging) {
    const prefix = `mp.messaging.${channel.direction}.${channel.channel}`;
    const connector = config[`${prefix}.connector`];
    const topic = config[`${prefix}.topic`];

    if (topic) channel.topic = topic;
    // SmallRye usa el nombre del canal como topic cuando no se declara otro.
    else if (connector && !channel.topic) channel.topic = channel.channel;

    if (connector?.includes('kafka')) channel.broker = 'kafka';
    else if (connector?.includes('amqp')) channel.broker = 'amqp';
    else if (connector?.includes('jms')) channel.broker = 'jms';
  }
}

/**
 * Un cliente REST configurado para el que no se encontró interfaz suele
 * significar que el escaneo se perdió algo: una llamada construida a mano, una
 * clase generada en tiempo de compilación, o una convención que este recolector
 * no conoce. La arista existe de todas formas, así que se reporta con el aviso
 * en vez de callarla.
 */
function reportUnmatchedRestClients(
  outbound: OutboundCall[],
  config: Record<string, string>,
  warnings: string[],
): void {
  const patterns = [
    /^quarkus\.rest-client\."?([^".]+)"?\.url$/,
    /^feign\.client\.config\.([^.]+)\.url$/,
    /^(.+)\/mp-rest\/url$/,
  ];

  const known = new Set(outbound.map((call) => call.configKey).filter(Boolean));

  for (const [key, raw] of Object.entries(config)) {
    for (const pattern of patterns) {
      const configKey = pattern.exec(key)?.[1];
      if (!configKey || known.has(configKey)) continue;

      const url = resolvePlaceholders(raw, config);
      outbound.push({
        kind: 'unknown',
        declaredIn: '(interfaz no encontrada)',
        configKey,
        url,
        targetHint: hostToServiceName(url),
        operations: [],
        source: { file: 'application.properties', line: 0 },
      });
      known.add(configKey);
      warnings.push(
        `'${configKey}' está configurado como cliente REST pero no se encontró su interfaz Java; ` +
          'revisa si la llamada se construye de otra forma',
      );
    }
  }
}

function datastoresFromConfig(config: Record<string, string>, hints: Set<Datastore['kind']>): Datastore[] {
  const found: Datastore[] = [];

  for (const [key, raw] of Object.entries(config)) {
    const value = resolvePlaceholders(raw, config);

    if (/^(quarkus\.datasource(\.[^.]+)?\.jdbc\.url|spring\.datasource\.url)$/.test(key)) {
      found.push({ kind: 'sql', vendor: vendorFromJdbc(value), url: value, entities: [] });
    } else if (/^(quarkus\.mongodb\.connection-string|spring\.data\.mongodb\.uri)$/.test(key)) {
      found.push({ kind: 'mongo', vendor: 'MongoDB', url: value, entities: [] });
    } else if (/^(quarkus\.redis\.hosts|spring\.(data\.)?redis\.(host|url))$/.test(key)) {
      found.push({ kind: 'redis', vendor: 'Redis', url: value, entities: [] });
    }
  }

  // Un indicio del código sin respaldo en la configuración se reporta igual:
  // puede que la URL llegue por variable de entorno en despliegue.
  for (const hint of hints) {
    if (!found.some((store) => store.kind === hint)) {
      found.push({ kind: hint, entities: [] });
    }
  }

  return found;
}

export async function scanRepository(root: string): Promise<Evidence> {
  const files = await collectFiles(root);
  const warnings: string[] = [];

  const buildSources = await Promise.all(
    files.build.map((file) => readFile(file, 'utf8').catch(() => '')),
  );
  const { framework, version } = detectFramework(buildSources);

  // ── Configuración ──────────────────────────────────────────────
  const config: Record<string, string> = {};
  for (const file of files.config) {
    const source = await readFile(file, 'utf8').catch(() => '');
    const parsed = file.endsWith('.properties') ? parseProperties(source) : flattenYaml(source);
    Object.assign(config, parsed);
  }

  const relevantConfig: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (RELEVANT_CONFIG.some((prefix) => key.startsWith(prefix)) || /\.url$|\/mp-rest\/url$/.test(key)) {
      relevantConfig[key] = value;
    }
  }

  // ── Fuentes Java ───────────────────────────────────────────────
  const endpoints: Evidence['endpoints'] = [];
  const outbound: OutboundCall[] = [];
  const messaging: MessagingChannel[] = [];
  const entities = new Set<string>();
  const datastoreHints = new Set<Datastore['kind']>();

  for (const file of files.java) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      warnings.push(`no se pudo leer ${relative}`);
      continue;
    }

    const result = scanJavaFile(relative, source);
    endpoints.push(...result.endpoints);
    outbound.push(...result.outbound);
    messaging.push(...result.messaging);
    for (const entity of result.entities) entities.add(entity);
    for (const hint of result.datastoreHints) datastoreHints.add(hint);
    warnings.push(...result.warnings);
  }

  resolveOutboundUrls(outbound, config);
  resolveMessaging(messaging, config);
  reportUnmatchedRestClients(outbound, relevantConfig, warnings);

  const rootPath = config['quarkus.http.root-path'] ?? config['server.servlet.context-path'];
  // Las rutas declaradas en el código son relativas al root-path. Lo que
  // interesa en un diagrama es la ruta que se ve desde fuera.
  if (rootPath) {
    for (const endpoint of endpoints) endpoint.path = joinPaths(rootPath, endpoint.path);
  }

  const datastores = datastoresFromConfig(relevantConfig, datastoreHints);
  const sqlStore = datastores.find((store) => store.kind === 'sql');
  if (sqlStore) sqlStore.entities = [...entities];

  const artifactId = /<artifactId>([^<]+)<\/artifactId>/.exec(buildSources[0] ?? '')?.[1];

  const name =
    config['quarkus.application.name'] ??
    config['spring.application.name'] ??
    artifactId ??
    path.basename(root);

  for (const call of outbound) {
    if (!call.url) {
      warnings.push(
        `no se pudo resolver la URL de '${call.declaredIn}'` +
          (call.configKey ? ` (configKey '${call.configKey}')` : '') +
          '; probablemente llegue por variable de entorno en despliegue',
      );
    }
  }

  return {
    service: {
      name,
      path: root,
      framework,
      frameworkVersion: version,
      buildTool: files.build.some((file) => file.endsWith('pom.xml'))
        ? 'maven'
        : files.build.length > 0
          ? 'gradle'
          : 'unknown',
      artifactId,
      rootPath,
    },
    endpoints,
    outbound,
    messaging,
    datastores,
    config: relevantConfig,
    stats: { javaFiles: files.java.length, configFiles: files.config.length },
    warnings,
  };
}
