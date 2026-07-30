import type {
  Datastore,
  ExposedEndpoint,
  MessagingChannel,
  OutboundCall,
  SourceRef,
} from './types.js';

/**
 * Escaneo heurístico de fuentes Java (Quarkus y Spring Boot).
 *
 * No es un analizador de AST y no pretende serlo: el ADR-001 descarta esa vía
 * por coste frente a 102 servicios heterogéneos. Lo que hace es reconocer los
 * patrones que un microservicio de banco usa el 95 % de las veces, y dejar
 * constancia de la línea exacta para que el agente pueda contrastar cada dato.
 *
 * Todo lo que salga de aquí es un indicio, no una verdad.
 */

export interface JavaScanResult {
  endpoints: ExposedEndpoint[];
  outbound: OutboundCall[];
  messaging: MessagingChannel[];
  entities: string[];
  datastoreHints: Array<Datastore['kind']>;
  warnings: string[];
}

const JAXRS_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

const SPRING_MAPPINGS: Record<string, string | undefined> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
  RequestMapping: undefined,
};

/** Palabras que abren un bloque con paréntesis pero no son declaraciones. */
const NOT_A_DECLARATION = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'do', 'try',
  'synchronized', 'assert', 'throw', 'super', 'this',
]);

/**
 * Sustituye los comentarios por espacios conservando la longitud, de modo que
 * los números de línea sigan siendo válidos. Se hace con un recorrido con
 * estado y no con una expresión regular porque `http://host` dentro de una
 * cadena se confundiría con el inicio de un comentario.
 */
export function stripComments(source: string): string {
  let result = '';
  let state: 'code' | 'line-comment' | 'block-comment' | 'string' | 'char' = 'code';

  for (let i = 0; i < source.length; i++) {
    const current = source[i]!;
    const next = source[i + 1];

    switch (state) {
      case 'code':
        if (current === '/' && next === '/') {
          state = 'line-comment';
          result += '  ';
          i++;
        } else if (current === '/' && next === '*') {
          state = 'block-comment';
          result += '  ';
          i++;
        } else {
          if (current === '"') state = 'string';
          else if (current === "'") state = 'char';
          result += current;
        }
        break;

      case 'line-comment':
        if (current === '\n') {
          state = 'code';
          result += current;
        } else {
          result += ' ';
        }
        break;

      case 'block-comment':
        if (current === '*' && next === '/') {
          state = 'code';
          result += '  ';
          i++;
        } else {
          result += current === '\n' ? current : ' ';
        }
        break;

      case 'string':
      case 'char':
        result += current;
        if (current === '\\') {
          result += source[i + 1] ?? '';
          i++;
        } else if ((state === 'string' && current === '"') || (state === 'char' && current === "'")) {
          state = 'code';
        }
        break;
    }
  }

  return result;
}

/** Primer argumento de cadena de una anotación: `@Path("/v1/cuentas")`. */
function firstStringArg(annotation: string): string | undefined {
  return /"([^"]*)"/.exec(annotation)?.[1];
}

/** Atributo con nombre: `@FeignClient(name = "customer")`. */
function namedArg(annotation: string, attribute: string): string | undefined {
  const match = new RegExp(`${attribute}\\s*=\\s*"([^"]*)"`).exec(annotation);
  return match?.[1];
}

/** Todas las cadenas de un atributo tipo array: `topics = {"a", "b"}`. */
function namedArrayArg(annotation: string, attribute: string): string[] {
  const match = new RegExp(`${attribute}\\s*=\\s*\\{([^}]*)\\}`).exec(annotation);
  if (match) return [...match[1]!.matchAll(/"([^"]*)"/g)].map((item) => item[1]!);
  const single = namedArg(annotation, attribute);
  return single !== undefined ? [single] : [];
}

function annotationName(annotation: string): string {
  return /^@([\w.]+)/.exec(annotation)?.[1]?.split('.').pop() ?? '';
}

function findAnnotation(annotations: string[], name: string): string | undefined {
  return annotations.find((annotation) => annotationName(annotation) === name);
}

interface Declaration {
  kind: 'type' | 'method';
  name: string;
  /** Solo en tipos: `class`, `interface`, `record` o `enum`. */
  typeKind?: string;
  annotations: string[];
  line: number;
}

/**
 * Recorre el fichero acumulando anotaciones hasta encontrar la declaración a
 * la que pertenecen. Las anotaciones repartidas en varias líneas se unen
 * contando paréntesis, que es lo habitual en Spring.
 */
export function parseDeclarations(source: string): Declaration[] {
  const lines = stripComments(source).split(/\r?\n/);
  const declarations: Declaration[] = [];
  let pending: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.trim();
    if (line === '') continue;

    if (line.startsWith('@')) {
      let balance = (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
      while (balance > 0 && i + 1 < lines.length) {
        const continuation = lines[++i]!.trim();
        line += continuation;
        balance += (continuation.match(/\(/g) ?? []).length - (continuation.match(/\)/g) ?? []).length;
      }
      pending.push(line);
      continue;
    }

    const typeMatch = /\b(class|interface|record|enum)\s+(\w+)/.exec(line);
    if (typeMatch) {
      declarations.push({
        kind: 'type',
        typeKind: typeMatch[1],
        name: typeMatch[2]!,
        annotations: pending,
        line: i + 1,
      });
      pending = [];
      continue;
    }

    const methodMatch = /(?:^|\s)(\w+)\s*\(/.exec(line);
    if (methodMatch && !NOT_A_DECLARATION.has(methodMatch[1]!) && !line.startsWith('}')) {
      declarations.push({ kind: 'method', name: methodMatch[1]!, annotations: pending, line: i + 1 });
      pending = [];
      continue;
    }

    // Una sentencia cualquiera rompe la asociación: las anotaciones colgadas
    // no pertenecen a nada y arrastrarlas produciría falsos positivos.
    if (line.endsWith(';') || line === '}') pending = [];
  }

  return declarations;
}

/** Detecta el envío de mensajes fuera de anotaciones: `kafkaTemplate.send("topic", ...)`. */
function scanKafkaTemplateCalls(source: string, file: string, declaredIn: string): MessagingChannel[] {
  const found: MessagingChannel[] = [];
  const pattern = /\b(\w*[tT]emplate|\w*[pP]roducer)\s*\.\s*send\s*\(\s*"([^"]+)"/g;
  const clean = stripComments(source);

  for (const match of clean.matchAll(pattern)) {
    const line = clean.slice(0, match.index).split('\n').length;
    found.push({
      direction: 'outgoing',
      channel: match[1]!,
      topic: match[2]!,
      broker: 'kafka',
      declaredIn,
      source: { file, line },
    });
  }

  return found;
}

/** Llamadas HTTP con URL literal, típicas de `RestTemplate` y `WebClient`. */
function scanInlineHttpCalls(source: string, file: string, declaredIn: string): OutboundCall[] {
  const found: OutboundCall[] = [];
  const clean = stripComments(source);
  const pattern =
    /\b(restTemplate|webClient|httpClient|client)\s*\.\s*(\w+)\s*\([^)]*?"(https?:\/\/[^"]+|\/[^"]*)"/gi;

  for (const match of clean.matchAll(pattern)) {
    const line = clean.slice(0, match.index).split('\n').length;
    const target = match[3]!;
    found.push({
      kind: /webClient/i.test(match[1]!) ? 'web-client' : 'rest-template',
      declaredIn,
      url: target.startsWith('http') ? target : undefined,
      operations: [{ path: target.startsWith('http') ? undefined : target }],
      source: { file, line },
    });
  }

  return found;
}

export function scanJavaFile(file: string, source: string): JavaScanResult {
  const result: JavaScanResult = {
    endpoints: [],
    outbound: [],
    messaging: [],
    entities: [],
    datastoreHints: [],
    warnings: [],
  };

  const declarations = parseDeclarations(source);
  const type = declarations.find((declaration) => declaration.kind === 'type');
  if (!type) return result;

  const typeName = type.name;
  const ref = (line: number): SourceRef => ({ file, line });

  // ── Nivel de tipo ──────────────────────────────────────────────
  const classPath =
    firstStringArg(findAnnotation(type.annotations, 'Path') ?? '') ??
    namedArg(findAnnotation(type.annotations, 'RequestMapping') ?? '', 'value') ??
    firstStringArg(findAnnotation(type.annotations, 'RequestMapping') ?? '');

  const registerRestClient = findAnnotation(type.annotations, 'RegisterRestClient');
  const feignClient = findAnnotation(type.annotations, 'FeignClient');

  const isRestClient = registerRestClient !== undefined || feignClient !== undefined;

  if (registerRestClient) {
    result.outbound.push({
      kind: 'rest-client',
      declaredIn: typeName,
      configKey: namedArg(registerRestClient, 'configKey'),
      url: namedArg(registerRestClient, 'baseUri'),
      operations: [],
      source: ref(type.line),
    });
  }

  if (feignClient) {
    result.outbound.push({
      kind: 'feign',
      declaredIn: typeName,
      configKey: namedArg(feignClient, 'name') ?? namedArg(feignClient, 'value') ?? firstStringArg(feignClient),
      url: namedArg(feignClient, 'url'),
      operations: [],
      source: ref(type.line),
    });
  }

  const typeAnnotationNames = new Set(type.annotations.map(annotationName));
  if (typeAnnotationNames.has('Entity')) {
    result.entities.push(typeName);
    result.datastoreHints.push('sql');
  }
  if (/extends\s+PanacheEntity|implements\s+PanacheRepository|extends\s+PanacheRepository/.test(source)) {
    result.entities.push(typeName);
    result.datastoreHints.push('sql');
  }
  if (/extends\s+(?:Jpa|Crud|PagingAndSorting)Repository\s*</.test(source)) {
    const entity = /extends\s+(?:Jpa|Crud|PagingAndSorting)Repository\s*<\s*(\w+)/.exec(source)?.[1];
    if (entity) result.entities.push(entity);
    result.datastoreHints.push('sql');
  }
  if (/MongoRepository|PanacheMongoEntity|@MongoEntity/.test(source)) result.datastoreHints.push('mongo');
  if (/RedisClient|ReactiveRedisDataSource|RedisDataSource|StringRedisTemplate|RedisTemplate|Jedis/.test(source)) {
    result.datastoreHints.push('redis');
  }

  // ── Nivel de método ────────────────────────────────────────────
  for (const declaration of declarations) {
    if (declaration.kind !== 'method') continue;
    const { annotations, name, line } = declaration;
    if (annotations.length === 0) continue;

    const names = annotations.map(annotationName);
    const methodPath = firstStringArg(findAnnotation(annotations, 'Path') ?? '');

    // JAX-RS: la anotación del verbo y la de la ruta van separadas.
    const jaxrsVerb = names.find((candidate) => JAXRS_METHODS.includes(candidate));
    if (jaxrsVerb) {
      const path = joinSegments(classPath, methodPath);
      if (isRestClient) {
        const owner = result.outbound.find((call) => call.declaredIn === typeName);
        owner?.operations.push({ method: jaxrsVerb, path });
      } else {
        result.endpoints.push({
          method: jaxrsVerb,
          path,
          handler: `${typeName}#${name}`,
          source: ref(line),
        });
      }
    }

    // Spring: el verbo va implícito en el nombre de la anotación.
    for (const [annotation, verb] of Object.entries(SPRING_MAPPINGS)) {
      const found = findAnnotation(annotations, annotation);
      if (!found) continue;

      const springPath =
        namedArg(found, 'value') ?? namedArg(found, 'path') ?? firstStringArg(found) ?? undefined;
      const method =
        verb ?? /RequestMethod\.(\w+)/.exec(found)?.[1] ?? undefined;
      const path = joinSegments(classPath, springPath);

      if (isRestClient) {
        const owner = result.outbound.find((call) => call.declaredIn === typeName);
        owner?.operations.push({ method, path });
      } else {
        result.endpoints.push({ method, path, handler: `${typeName}#${name}`, source: ref(line) });
      }
    }

    // ── Mensajería ───────────────────────────────────────────────
    const incoming = findAnnotation(annotations, 'Incoming');
    if (incoming) {
      const channel = firstStringArg(incoming) ?? '?';
      result.messaging.push({
        direction: 'incoming',
        channel,
        broker: 'unknown',
        declaredIn: `${typeName}#${name}`,
        source: ref(line),
      });
    }

    const outgoing = findAnnotation(annotations, 'Outgoing');
    if (outgoing) {
      result.messaging.push({
        direction: 'outgoing',
        channel: firstStringArg(outgoing) ?? '?',
        broker: 'unknown',
        declaredIn: `${typeName}#${name}`,
        source: ref(line),
      });
    }

    const kafkaListener = findAnnotation(annotations, 'KafkaListener');
    if (kafkaListener) {
      const topics = namedArrayArg(kafkaListener, 'topics');
      const channels = topics.length > 0 ? topics : ['?'];
      for (const topic of channels) {
        result.messaging.push({
          direction: 'incoming',
          channel: topic,
          topic: topic === '?' ? undefined : topic,
          broker: 'kafka',
          declaredIn: `${typeName}#${name}`,
          source: ref(line),
        });
      }
    }
  }

  // `@Channel` es una inyección de campo, no una anotación de método.
  for (const match of stripComments(source).matchAll(/@Channel\s*\(\s*"([^"]+)"/g)) {
    const line = source.slice(0, match.index).split('\n').length;
    result.messaging.push({
      direction: 'outgoing',
      channel: match[1]!,
      broker: 'unknown',
      declaredIn: typeName,
      source: ref(line),
    });
  }

  result.messaging.push(...scanKafkaTemplateCalls(source, file, typeName));
  if (!isRestClient) result.outbound.push(...scanInlineHttpCalls(source, file, typeName));

  return result;
}

function joinSegments(classPath: string | undefined, methodPath: string | undefined): string {
  const parts = [classPath, methodPath]
    .filter((part): part is string => Boolean(part))
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '');
  return `/${parts.join('/')}`;
}
