import { parse as parseYaml } from 'yaml';

/**
 * Minería de ficheros de configuración.
 *
 * Es la fuente de evidencia más valiosa del recolector, por encima del código.
 * Una línea como `quarkus.rest-client.customer-api.url=http://ms-customer.negocio.svc`
 * da a la vez la arista, el nombre del destino y hasta la zona. Ninguna
 * heurística sobre el código Java se acerca a esa precisión.
 */

/** Formato `.properties`, incluidas las continuaciones de línea con `\`. */
export function parseProperties(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;

    while (line.endsWith('\\') && i + 1 < lines.length) {
      line = `${line.slice(0, -1)}${lines[++i]!.trim()}`;
    }

    const separator = line.search(/[=:]/);
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) result[key] = value;
  }

  return result;
}

/** Aplana un YAML a claves con puntos, que es como se referencian en el código. */
export function flattenYaml(source: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch {
    return {};
  }

  const result: Record<string, string> = {};

  const walk = (value: unknown, prefix: string): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${prefix}[${i}]`));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    result[prefix] = String(value);
  };

  walk(parsed, '');
  return result;
}

/**
 * Resuelve las interpolaciones `${VAR:default}` quedándose con el valor por
 * defecto. Un `${DB_HOST}` sin defecto no se puede resolver leyendo el
 * repositorio, y fingir lo contrario sería inventar arquitectura.
 */
export function resolvePlaceholders(value: string, config: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, expression: string) => {
    const [name = '', ...rest] = expression.split(':');
    const fallback = rest.join(':');
    const known = config[name.trim()];
    if (known !== undefined && !known.includes(match)) return known;
    return fallback !== '' ? fallback : match;
  });
}

/** Extrae un nombre de servicio plausible del host de una URL. */
export function hostToServiceName(url: string): string | undefined {
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/:?#]+)/.exec(url.trim());
  if (!match) return undefined;

  const host = match[1]!;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[.*\])$/.test(host)) return undefined;
  // Una IP no dice nada sobre el nombre del servicio.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return undefined;

  // En Kubernetes el primer segmento es el Service: `ms-customer.negocio.svc.cluster.local`.
  const first = host.split('.')[0]!;
  return first || undefined;
}

/** Une un `root-path` con la ruta de clase y la de método sin duplicar barras. */
export function joinPaths(...parts: Array<string | undefined>): string {
  const joined = parts
    .filter((part): part is string => Boolean(part))
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '')
    .join('/');
  return `/${joined}`;
}
