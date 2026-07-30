import { useEffect, useRef, useState } from 'react';
import type { Ir } from '@archiflow/schema';
import { toArchimate, toDrawio, toJson, toMermaid, toSvg } from '@archiflow/export';

/**
 * Menú de exportación.
 *
 * Todo se genera en el navegador con el mismo código que usa el CLI, así que
 * no hace falta subir nada a ningún sitio: coherente con que la herramienta
 * sea 100 % local. El PNG y el JPG se rasterizan del SVG mediante un canvas,
 * sin librerías: el SVG es autocontenido, así que basta cargarlo como imagen.
 */

interface Props {
  ir: Ir;
  /** Flujo activo, para poder exportar solo ese recorrido. */
  flowId?: string;
  fileName: string;
}

type Format = 'svg' | 'png' | 'jpg' | 'drawio' | 'mermaid' | 'json' | 'archimate';

const SCALES = [1, 2, 3];

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revocar antes de que el navegador haya iniciado la descarga la aborta.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Rasteriza un SVG usando un canvas. Devuelve el blob del formato pedido. */
async function rasterize(
  svg: string,
  scale: number,
  mime: 'image/png' | 'image/jpeg',
): Promise<Blob> {
  const width = Number(/width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 1200);
  const height = Number(/height="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 800);

  const source = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(source);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('el navegador no pudo cargar el SVG'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const context = canvas.getContext('2d');
    if (!context) throw new Error('no hay contexto 2D disponible');

    // El JPEG no tiene canal alfa: sin fondo explícito saldría en negro.
    if (mime === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('la conversión no produjo datos'))),
        mime,
        0.92,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ExportMenu({ ir, flowId, fileName }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(2);
  const [onlyFlow, setOnlyFlow] = useState(false);
  const [light, setLight] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [archimateShapes, setArchimateShapes] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const base = fileName.replace(/\.arch\.ya?ml$/i, '') || 'diagrama';
  const suffix = onlyFlow && flowId ? `-${flowId}` : '';

  const run = async (format: Format) => {
    setBusy(format);
    setError(null);
    try {
      const svgOptions = {
        flowId: onlyFlow ? flowId : undefined,
        light,
        transparent: transparent && format !== 'jpg',
      };

      switch (format) {
        case 'svg':
          download(
            new Blob([await toSvg(ir, svgOptions)], { type: 'image/svg+xml' }),
            `${base}${suffix}.svg`,
          );
          break;
        case 'png':
          download(await rasterize(await toSvg(ir, svgOptions), scale, 'image/png'), `${base}${suffix}.png`);
          break;
        case 'jpg':
          download(
            await rasterize(await toSvg(ir, { ...svgOptions, light: true }), scale, 'image/jpeg'),
            `${base}${suffix}.jpg`,
          );
          break;
        case 'drawio':
          download(
            new Blob([await toDrawio(ir, { archimate: archimateShapes })], { type: 'application/xml' }),
            `${base}.drawio`,
          );
          break;
        case 'archimate':
          download(new Blob([await toArchimate(ir)], { type: 'application/xml' }), `${base}.xml`);
          break;
        case 'mermaid':
          download(new Blob([toMermaid(ir)], { type: 'text/markdown' }), `${base}.md`);
          break;
        case 'json':
          download(new Blob([toJson(ir)], { type: 'application/json' }), `${base}.json`);
          break;
      }
      setOpen(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="export" ref={container}>
      <button type="button" className="tool" onClick={() => setOpen((value) => !value)}>
        Exportar ▾
      </button>

      {open && (
        <div className="export__menu" role="menu">
          <div className="export__section">
            <span className="export__title">Imagen</span>

            <div className="export__row">
              <span className="export__label">Escala</span>
              <div className="export__scales">
                {SCALES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`export__scale${scale === value ? ' is-active' : ''}`}
                    onClick={() => setScale(value)}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            </div>

            <label className="export__check">
              <input type="checkbox" checked={light} onChange={(e) => setLight(e.target.checked)} />
              Tema claro
            </label>

            <label className="export__check">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
              />
              Fondo transparente
              <span className="export__note">no aplica a JPG</span>
            </label>

            {flowId && (
              <label className="export__check">
                <input type="checkbox" checked={onlyFlow} onChange={(e) => setOnlyFlow(e.target.checked)} />
                Solo el flujo activo
                <span className="export__note">con los pasos numerados</span>
              </label>
            )}

            <div className="export__buttons">
              <button type="button" onClick={() => void run('png')} disabled={busy !== null}>
                {busy === 'png' ? '…' : 'PNG'}
              </button>
              <button type="button" onClick={() => void run('jpg')} disabled={busy !== null}>
                {busy === 'jpg' ? '…' : 'JPG'}
              </button>
              <button type="button" onClick={() => void run('svg')} disabled={busy !== null}>
                {busy === 'svg' ? '…' : 'SVG'}
              </button>
            </div>
          </div>

          <div className="export__section">
            <span className="export__title">Para otras herramientas</span>
            <button type="button" className="export__item" onClick={() => void run('drawio')}>
              <strong>draw.io</strong>
              <span>Topología y una página por flujo</span>
            </button>
            <label className="export__check">
              <input
                type="checkbox"
                checked={archimateShapes}
                onChange={(e) => setArchimateShapes(e.target.checked)}
              />
              Formas ArchiMate
              <span className="export__note">solo draw.io</span>
            </label>
            <button type="button" className="export__item" onClick={() => void run('archimate')}>
              <strong>ArchiMate</strong>
              <span>Open Exchange, para importar en Archi</span>
            </button>
            <button type="button" className="export__item" onClick={() => void run('mermaid')}>
              <strong>Mermaid</strong>
              <span>Para pegar en la descripción de un PR</span>
            </button>
            <button type="button" className="export__item" onClick={() => void run('json')}>
              <strong>JSON</strong>
              <span>El modelo compilado, para otras herramientas</span>
            </button>
          </div>

          {error && <p className="export__error">{error}</p>}
        </div>
      )}
    </div>
  );
}
