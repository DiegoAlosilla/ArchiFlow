import type { NodeKind } from '@archiflow/schema';

export type FigureGroup = 'General' | 'Azure' | 'UML';

export interface FigureDefinition {
  id: string;
  label: string;
  group: FigureGroup;
  kind: NodeKind;
  image?: string;
}

export const FIGURES: FigureDefinition[] = [
  { id: 'general:service', label: 'Servicio', group: 'General', kind: 'service' },
  { id: 'general:frontend', label: 'Web', group: 'General', kind: 'frontend' },
  { id: 'general:client', label: 'Canal móvil', group: 'General', kind: 'client' },
  { id: 'general:gateway', label: 'Gateway', group: 'General', kind: 'gateway' },
  { id: 'general:database', label: 'Base de datos', group: 'General', kind: 'database' },
  { id: 'general:cache', label: 'Caché', group: 'General', kind: 'cache' },
  { id: 'general:broker', label: 'Evento', group: 'General', kind: 'broker' },
  { id: 'general:external', label: 'Externo', group: 'General', kind: 'external' },
  { id: 'azure:app-service', label: 'App Service', group: 'Azure', kind: 'service', image: '/azure/app-service.svg' },
  { id: 'azure:function-app', label: 'Function App', group: 'Azure', kind: 'service', image: '/azure/function-app.svg' },
  { id: 'azure:kubernetes-service', label: 'AKS', group: 'Azure', kind: 'service', image: '/azure/kubernetes-service.svg' },
  { id: 'azure:api-management', label: 'API Management', group: 'Azure', kind: 'gateway', image: '/azure/api-management.svg' },
  { id: 'azure:application-gateway', label: 'App Gateway', group: 'Azure', kind: 'gateway', image: '/azure/application-gateway.svg' },
  { id: 'azure:front-door', label: 'Front Door', group: 'Azure', kind: 'gateway', image: '/azure/front-door.svg' },
  { id: 'azure:sql-database', label: 'Azure SQL', group: 'Azure', kind: 'database', image: '/azure/sql-database.svg' },
  { id: 'azure:cosmos-db', label: 'Cosmos DB', group: 'Azure', kind: 'database', image: '/azure/cosmos-db.svg' },
  { id: 'azure:service-bus', label: 'Service Bus', group: 'Azure', kind: 'broker', image: '/azure/service-bus.svg' },
  { id: 'azure:event-hubs', label: 'Event Hubs', group: 'Azure', kind: 'broker', image: '/azure/event-hubs.svg' },
  { id: 'azure:storage-account', label: 'Storage', group: 'Azure', kind: 'storage', image: '/azure/storage-account.svg' },
  { id: 'azure:virtual-network', label: 'Virtual Network', group: 'Azure', kind: 'external', image: '/azure/virtual-network.svg' },
  { id: 'azure:key-vault', label: 'Key Vault', group: 'Azure', kind: 'external', image: '/azure/key-vault.svg' },
  { id: 'uml:actor', label: 'Actor', group: 'UML', kind: 'client', image: '/uml/actor.svg' },
  { id: 'uml:component', label: 'Componente', group: 'UML', kind: 'component', image: '/uml/component.svg' },
  { id: 'uml:interface', label: 'Interfaz', group: 'UML', kind: 'component', image: '/uml/interface.svg' },
  { id: 'uml:package', label: 'Paquete', group: 'UML', kind: 'component', image: '/uml/package.svg' },
  { id: 'uml:use-case', label: 'Caso de uso', group: 'UML', kind: 'component', image: '/uml/use-case.svg' },
  { id: 'uml:class', label: 'Clase', group: 'UML', kind: 'component', image: '/uml/class.svg' },
];
