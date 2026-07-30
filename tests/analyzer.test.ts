import { describe, expect, it } from 'vitest';
import { parseProperties, resolvePlaceholders, hostToServiceName, flattenYaml } from '../src/analyzer/config.js';
import { scanJavaFile, stripComments } from '../src/analyzer/java.js';
import { scanRepository } from '../src/analyzer/index.js';

describe('stripComments', () => {
  it('no confunde el // de una URL con un comentario', () => {
    const source = 'String url = "http://ms-customer/v1"; // comentario';
    const stripped = stripComments(source);
    expect(stripped).toContain('http://ms-customer/v1');
    expect(stripped).not.toContain('comentario');
  });

  it('conserva la longitud para no desplazar los números de línea', () => {
    const source = 'int a = 1; /* bloque\nmultilinea */ int b = 2;';
    expect(stripComments(source).split('\n').length).toBe(source.split('\n').length);
  });
});

describe('scanJavaFile', () => {
  it('compone la ruta del endpoint desde @Path de clase y de método', () => {
    const source = `
      @Path("/cuentas")
      public class CuentasResource {
        @GET
        @Path("/{id}/movimientos")
        public List<Mov> listar(@PathParam("id") String id) { return null; }
      }`;
    const result = scanJavaFile('X.java', source);
    expect(result.endpoints[0]?.path).toBe('/cuentas/{id}/movimientos');
    expect(result.endpoints[0]?.method).toBe('GET');
  });

  it('reconoce anotaciones de Spring repartidas en varias líneas', () => {
    const source = `
      @RestController
      @RequestMapping("/api/clientes")
      public class ClienteController {
        @GetMapping(
            value = "/{id}",
            produces = MediaType.APPLICATION_JSON_VALUE
        )
        public ClienteDto obtener(@PathVariable String id) { return null; }
      }`;
    const result = scanJavaFile('X.java', source);
    expect(result.endpoints[0]?.path).toBe('/api/clientes/{id}');
    expect(result.endpoints[0]?.method).toBe('GET');
  });

  it('trata un @RegisterRestClient como llamada saliente, no como endpoint', () => {
    const source = `
      @RegisterRestClient(configKey = "customer-api")
      @Path("/internal/clientes")
      public interface CustomerClient {
        @GET
        @Path("/{id}")
        ClienteDto obtener(@PathParam("id") String id);
      }`;
    const result = scanJavaFile('X.java', source);
    expect(result.endpoints).toHaveLength(0);
    expect(result.outbound[0]?.configKey).toBe('customer-api');
    expect(result.outbound[0]?.operations[0]?.path).toBe('/internal/clientes/{id}');
  });

  it('detecta topics de @KafkaListener declarados como array', () => {
    const source = `
      @Component
      public class Listener {
        @KafkaListener(topics = {"cuentas.creadas", "cuentas.cerradas"}, groupId = "g")
        public void escuchar(String mensaje) { }
      }`;
    const result = scanJavaFile('X.java', source);
    expect(result.messaging.map((channel) => channel.topic)).toEqual([
      'cuentas.creadas',
      'cuentas.cerradas',
    ]);
  });

  it('no inventa endpoints a partir de sentencias con paréntesis', () => {
    const source = `
      @Path("/x")
      public class R {
        public void metodo() {
          if (algo()) { return; }
          for (int i = 0; i < 3; i++) { hacer(i); }
        }
      }`;
    expect(scanJavaFile('X.java', source).endpoints).toHaveLength(0);
  });
});

describe('configuración', () => {
  it('parsea properties con continuación de línea', () => {
    const parsed = parseProperties('a.b=uno\\\n  dos\n# comentario\nc=tres');
    expect(parsed['a.b']).toBe('unodos');
    expect(parsed['c']).toBe('tres');
  });

  it('aplana YAML a claves con puntos', () => {
    const flat = flattenYaml('quarkus:\n  redis:\n    hosts: redis://x:6379\n');
    expect(flat['quarkus.redis.hosts']).toBe('redis://x:6379');
  });

  it('resuelve ${VAR:default} quedándose con el valor por defecto', () => {
    expect(resolvePlaceholders('${SALDOS_URL:http://ms-saldos:8080}', {})).toBe('http://ms-saldos:8080');
  });

  it('deja intacto un ${VAR} sin defecto en vez de inventarse un valor', () => {
    expect(resolvePlaceholders('${DB_HOST}', {})).toBe('${DB_HOST}');
  });

  it('extrae el nombre del Service de un host de Kubernetes', () => {
    expect(hostToServiceName('http://ms-customer.negocio.svc.cluster.local:8080')).toBe('ms-customer');
  });

  it('no deduce nombre de servicio desde localhost ni desde una IP', () => {
    expect(hostToServiceName('http://localhost:8080')).toBeUndefined();
    expect(hostToServiceName('http://10.20.30.40:8080')).toBeUndefined();
  });
});

describe('scanRepository', () => {
  it('correlaciona el cliente REST con su URL y reporta el que no encuentra', async () => {
    const evidence = await scanRepository('./examples/fixtures/bff-cuentas');

    expect(evidence.service.framework).toBe('quarkus');
    expect(evidence.service.name).toBe('bff-cuentas');

    // El root-path forma parte de la ruta visible desde fuera.
    expect(evidence.endpoints.map((endpoint) => endpoint.path)).toContain('/v1/cuentas');

    const customer = evidence.outbound.find((call) => call.configKey === 'customer-api');
    expect(customer?.targetHint).toBe('ms-customer');

    // Configurado pero sin interfaz: la arista se reporta con su aviso.
    const saldos = evidence.outbound.find((call) => call.configKey === 'saldos-api');
    expect(saldos?.targetHint).toBe('ms-saldos');
    expect(evidence.warnings.some((warning) => warning.includes('saldos-api'))).toBe(true);

    const outgoing = evidence.messaging.find((channel) => channel.direction === 'outgoing');
    expect(outgoing?.topic).toBe('cuentas.consultadas');
    expect(outgoing?.broker).toBe('kafka');
  });
});
