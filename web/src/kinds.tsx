import type { NodeKind } from '@archiflow/schema';
import { kindAccent, kindLabel } from '@archiflow/theme';

/**
 * Presentación por tipo de nodo. Los colores viven en `src/theme.ts`, que
 * comparten los exportadores: un diagrama exportado a draw.io tiene que
 * reconocerse como el mismo que se vio animado.
 */

export { protocolColor, kindLabel, kindAccent } from '@archiflow/theme';

export interface KindStyle {
  label: string;
  accent: string;
  icon: React.ReactNode;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const icons: Record<NodeKind, React.ReactNode> = {
  service: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" {...stroke} />
      <path d="M8 9h8M8 12h8M8 15h5" {...stroke} />
    </>
  ),
  frontend: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" {...stroke} />
      <path d="M8 20h8M12 17v3" {...stroke} />
    </>
  ),
  client: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" {...stroke} />
      <path d="M11 18.5h2" {...stroke} />
    </>
  ),
  gateway: (
    <>
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" {...stroke} />
      <path d="M8.5 12h7M13 9.5l2.5 2.5-2.5 2.5" {...stroke} />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="3.2" {...stroke} />
      <path d="M4.5 6v12c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2V6" {...stroke} />
      <path d="M4.5 12c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2" {...stroke} />
    </>
  ),
  cache: (
    <>
      <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z" {...stroke} />
    </>
  ),
  broker: (
    <>
      <circle cx="6" cy="6" r="2.6" {...stroke} />
      <circle cx="18" cy="6" r="2.6" {...stroke} />
      <circle cx="12" cy="18" r="2.6" {...stroke} />
      <path d="M8.4 7.4 10.6 15.6M15.6 7.4 13.4 15.6M8.6 6h6.8" {...stroke} />
    </>
  ),
  external: (
    <>
      <circle cx="12" cy="12" r="9" {...stroke} />
      <path d="M3.2 12h17.6M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" {...stroke} />
    </>
  ),
  job: (
    <>
      <circle cx="12" cy="12" r="9" {...stroke} />
      <path d="M12 7v5.5l3.5 2" {...stroke} />
    </>
  ),
  storage: (
    <>
      <path d="M3 7.5 12 3l9 4.5-9 4.5z" {...stroke} />
      <path d="M3 12.5 12 17l9-4.5M3 17 12 21.5 21 17" {...stroke} />
    </>
  ),
  component: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" {...stroke} />
      <path d="M2.5 8H7M2.5 12H7M2.5 16H7" {...stroke} />
    </>
  ),
};

export function kindStyle(kind: NodeKind): KindStyle {
  return { label: kindLabel[kind], accent: kindAccent[kind], icon: icons[kind] };
}
