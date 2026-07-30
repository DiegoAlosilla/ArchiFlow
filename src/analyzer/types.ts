/**
 * Evidencias extraídas de un repositorio de microservicio.
 *
 * Deliberadamente NO es un `.arch.yaml`. Este módulo solo reporta lo que puede
 * demostrar leyendo ficheros: anotaciones encontradas, propiedades de
 * configuración, dependencias declaradas. Convertir eso en un diagrama exige
 * criterio (cómo se llama de verdad el servicio destino, en qué zona vive, qué
 * pasos forman un flujo con sentido), y ese trabajo lo hace el agente con la
 * skill `archiflow-scan`. Ver ADR-001, decisión C.
 */

export type Framework = 'quarkus' | 'spring-boot' | 'unknown';

export interface SourceRef {
  /** Ruta relativa a la raíz del repositorio. */
  file: string;
  line: number;
}

export interface ExposedEndpoint {
  method?: string;
  path: string;
  /** Clase y método Java que lo atiende, útil para los flujos a nivel método. */
  handler?: string;
  source: SourceRef;
}

export type OutboundKind = 'rest-client' | 'feign' | 'rest-template' | 'web-client' | 'unknown';

export interface OutboundCall {
  kind: OutboundKind;
  /** Interfaz o clase Java que declara la llamada. */
  declaredIn: string;
  /** `configKey` de MicroProfile o `name` de Feign. */
  configKey?: string;
  /** URL resuelta desde la configuración, si se pudo correlacionar. */
  url?: string;
  /**
   * Nombre probable del servicio destino, deducido del host de la URL.
   * Es una conjetura: el agente debe contrastarla.
   */
  targetHint?: string;
  operations: Array<{ method?: string; path?: string }>;
  source: SourceRef;
}

export interface MessagingChannel {
  direction: 'incoming' | 'outgoing';
  /** Canal lógico (SmallRye) o nombre del bean. */
  channel: string;
  topic?: string;
  broker: 'kafka' | 'amqp' | 'jms' | 'unknown';
  declaredIn: string;
  source: SourceRef;
}

export interface Datastore {
  kind: 'sql' | 'mongo' | 'redis' | 'unknown';
  vendor?: string;
  url?: string;
  /** Entidades o repositorios detectados, como pista del dominio. */
  entities: string[];
  source?: SourceRef;
}

export interface Evidence {
  service: {
    name: string;
    path: string;
    framework: Framework;
    frameworkVersion?: string;
    buildTool: 'maven' | 'gradle' | 'unknown';
    artifactId?: string;
    /** Prefijo de todas las rutas expuestas, si está configurado. */
    rootPath?: string;
  };
  endpoints: ExposedEndpoint[];
  outbound: OutboundCall[];
  messaging: MessagingChannel[];
  datastores: Datastore[];
  /** Propiedades relevantes ya resueltas, para que el agente pueda comprobarlas. */
  config: Record<string, string>;
  stats: {
    javaFiles: number;
    configFiles: number;
  };
  /** Lo que el recolector vio pero no supo interpretar. */
  warnings: string[];
}
