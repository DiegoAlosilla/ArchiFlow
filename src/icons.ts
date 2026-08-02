/**
 * Catálogo mínimo de activos que el editor y el exportador reconocen. Las
 * rutas son relativas al `public/` de la web; el exportador puede volverlas
 * absolutas para que el SVG intermedio también las vea al rasterizar PNG/JPG.
 */
export function vendorIconPath(tags: string[], label: string, tech?: string, platform?: string): string | undefined {
  const azureIcons: Record<string, string> = {
    'drawio:api-management': '/azure/api-management.svg',
    'drawio:application-gateway': '/azure/application-gateway.svg',
    'drawio:front-doors': '/azure/front-door.svg',
    'drawio:azure-cosmos-db': '/azure/cosmos-db.svg',
    'drawio:event-hubs': '/azure/event-hubs.svg',
  };
  const tagged = tags.map((tag) => azureIcons[tag]).find((icon): icon is string => Boolean(icon));
  if (tagged) return tagged;

  const identity = `${tags.join(' ')} ${label} ${tech ?? ''} ${platform ?? ''}`.toLowerCase();
  if (identity.includes('application gateway')) return '/azure/application-gateway.svg';
  if (identity.includes('front door')) return '/azure/front-door.svg';
  if (identity.includes('api management')) return '/azure/api-management.svg';
  if (identity.includes('cosmos')) return '/azure/cosmos-db.svg';
  if (identity.includes('event hub')) return '/azure/event-hubs.svg';
  if (identity.includes('firestore')) return '/brands/firebase.svg';
  if (/imperva|\bwaf\b|firewall/.test(identity)) return '/brands/firewall.svg';
  if (/frontend|mobile client/.test(identity)) return '/brands/mobile.svg';
  if (/spring(?:\s+boot)?/.test(identity)) return '/brands/spring.svg';
  if (identity.includes('quarkus')) return '/brands/quarkus.svg';
  if (/c#|csharp|\.net|dotnet/.test(identity)) return '/brands/dotnet.svg';
  if (/red[ -]?hat|\brhel\b|openshift/.test(identity)) return '/brands/redhat.svg';
  if (/\bios\b|iphone|ipad/.test(identity)) return '/brands/apple.svg';
  if (identity.includes('android')) return '/brands/android.svg';
  if (/node\.?js|nodejs/.test(identity)) return '/brands/nodejs.svg';
  if (/\bjava\b|\bjdk\b|openjdk/.test(identity)) return '/brands/java.svg';
  if (/on[ -]?prem|datacenter|centro de datos|legacy/.test(identity)) return '/brands/on-premise.svg';
  return undefined;
}
