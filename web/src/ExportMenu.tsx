import { useEffect, useRef, useState } from 'react';
import type { Ir } from '@archiflow/schema';
import { buildPalette, encodeGif, toArchimate, toDrawio, toJson, toMermaid, toPdf, toSvg } from '@archiflow/export';
import { loopDurationMs } from '@archiflow/animation';

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

type Format = 'svg' | 'png' | 'jpg' | 'pdf' | 'gif' | 'drawio' | 'mermaid' | 'json' | 'archimate';

const SCALES = [1, 2, 3];
/** Fotogramas por segundo del GIF. Más de 20 engorda el fichero sin ganancia. */
const GIF_FPS = [12, 16, 20];
/** Ritmos pensados para lectura; el 70 % evita GIFs que parecen un fast-forward. */
const GIF_SPEEDS = [0.6, 0.75, 1];
/**
 * Lado máximo del GIF en píxeles. Un GIF de 2000 px con veinte fotogramas se va
 * a decenas de megas y ningún Confluence lo acepta. Se acota el lado mayor, no
 * el ancho: un diagrama de banca suele ser más alto que ancho.
 */
const GIF_MAX_SIDE = 1100;

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revocar antes de que el navegador haya iniciado la descarga la aborta.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function svgSize(svg: string): { width: number; height: number } {
  return {
    width: Number(/width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 1200),
    height: Number(/height="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 800),
  };
}

/** Dibuja un SVG en un canvas. Es la base de PNG, JPG, PDF y GIF. */
async function draw(svg: string, scale: number, background?: string): Promise<HTMLCanvasElement> {
  const { width, height } = svgSize(svg);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));

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

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no hay contexto 2D disponible');

    // El JPEG y el GIF no tienen canal alfa: sin fondo explícito salen negros.
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Los codificadores devuelven bytes crudos. El `as ArrayBuffer` es seguro
 * porque los construyen ellos: TypeScript no puede saber que no vienen de un
 * `SharedArrayBuffer`.
 */
function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes.buffer as ArrayBuffer], { type });
}

function toBlob(canvas: HTMLCanvasElement, mime: 'image/png' | 'image/jpeg'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('la conversión no produjo datos'))),
      mime,
      0.92,
    );
  });
}

/** Rasteriza un SVG usando un canvas. Devuelve el blob del formato pedido. */
async function rasterize(
  svg: string,
  scale: number,
  mime: 'image/png' | 'image/jpeg',
): Promise<Blob> {
  return toBlob(await draw(svg, scale, mime === 'image/jpeg' ? '#ffffff' : undefined), mime);
}

export function ExportMenu({ ir, flowId, fileName }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(2);
  const [onlyFlow, setOnlyFlow] = useState(false);
  // Una imagen se suele pegar en una presentación o documento: el claro da
  // mejor contraste impreso. El lienzo sigue oscuro y el usuario puede volver
  // a ese tema desde el propio menú.
  const [light, setLight] = useState(true);
  const [transparent, setTransparent] = useState(false);
  const [archimateShapes, setArchimateShapes] = useState(false);
  const [fps, setFps] = useState(16);
  const [gifSpeed, setGifSpeed] = useState(0.75);
  /** El GIF tarda segundos: sin avance parece que la web se ha colgado. */
  const [progress, setProgress] = useState(0);
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
  const assetBaseUrl = window.location.origin;

  /**
   * `toSvg` apunta a los activos locales para poder compartir el renderer con
   * el CLI. Antes de descargar o rasterizar, la web los incrusta: Chrome no
   * carga de forma fiable imágenes hermanas desde un SVG que vive en un Blob,
   * y el PNG resultaba con el icono de imagen rota. Así el SVG/PNG/GIF queda
   * autocontenido y no depende de que este servidor siga levantado.
   */
  const renderSvg = async (options: Parameters<typeof toSvg>[1] = {}) => {
    const svg = await toSvg(ir, { ...options, assetBaseUrl });
    const urls = [...svg.matchAll(/href="(https?:[^\"]+\/(?:azure|brands)\/[^\"]+\.svg)"/g)].map((match) => match[1]);
    const uniqueUrls = [...new Set(urls)].filter((url): url is string => Boolean(url));
    if (uniqueUrls.length === 0) return svg;

    const replacements = await Promise.all(
      uniqueUrls.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`no se pudo cargar el icono ${url}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });
        return [url, `data:image/svg+xml;base64,${btoa(binary)}`] as const;
      }),
    );

    return replacements.reduce((result, [url, dataUrl]) => result.replaceAll(url, dataUrl), svg);
  };

  /**
   * Genera el GIF fotograma a fotograma.
   *
   * Se apoya en que la animación es determinista: `dotProgress` da la posición
   * de cada punto en cualquier instante, así que basta pedirle al exportador el
   * mismo SVG con el tiempo congelado y rasterizarlo. El bucle cierra sin salto
   * porque se recorre exactamente una vuelta completa.
   */
  const renderGif = async (): Promise<Blob> => {
    const flow = ir.flows.find((candidate) => candidate.id === flowId);
    if (!flow) throw new Error('no se encontró el flujo');

    const loopMs = loopDurationMs(flow, ir.animation);
    const frameCount = Math.min(60, Math.max(6, Math.round((loopMs / 1000) * fps)));
    // Antes, el tope de 60 fotogramas conservaba el retraso de un FPS y
    // comprimía un recorrido largo. El tiempo total se conserva aunque se
    // reduzcan los frames: así el GIF no corre más que la animación del lienzo.
    const playbackMs = loopMs / gifSpeed;
    const probe = await renderSvg({ flowId, light, timeMs: 0 });
    const { width, height } = svgSize(probe);
    const gifScale = Math.min(1, GIF_MAX_SIDE / Math.max(width, height));

    const frames = [];
    let size = { width: 0, height: 0 };
    for (let i = 0; i < frameCount; i++) {
      setProgress(Math.round(((i + 1) / (frameCount + 1)) * 100));
      const svg = await renderSvg({ flowId, light, timeMs: (i / frameCount) * loopMs });
      const canvas = await draw(svg, gifScale, light ? '#ffffff' : '#060910');
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      frames.push({ data: context.getImageData(0, 0, canvas.width, canvas.height).data });
      size = { width: canvas.width, height: canvas.height };
    }

    // La paleta se construye con los colores del tema que se está exportando:
    // el claro y el oscuro no comparten ni fondos ni grises.
    const palette = buildPalette(
      light ? '#ffffff' : '#060910',
      light
        ? ['#0f172a', '#64748b', '#cbd5e1', '#ffffff']
        : ['#e2e8f0', '#7c8aa5', '#1e293b', '#111a2e', '#0b1120', '#334155'],
    );

    setProgress(100);
    return bytesToBlob(encodeGif(frames, palette, { ...size, delayMs: playbackMs / frameCount }), 'image/gif');
  };

  const run = async (format: Format) => {
    setBusy(format);
    setError(null);
    setProgress(0);
    try {
      const svgOptions = {
        flowId: onlyFlow ? flowId : undefined,
        light,
        transparent: transparent && format !== 'jpg' && format !== 'pdf',
        assetBaseUrl,
      };

      switch (format) {
        case 'svg':
          download(new Blob([await renderSvg(svgOptions)], { type: 'image/svg+xml' }), `${base}${suffix}.svg`);
          break;
        case 'png':
          download(await rasterize(await renderSvg(svgOptions), scale, 'image/png'), `${base}${suffix}.png`);
          break;
        case 'jpg':
          download(
            await rasterize(await renderSvg({ ...svgOptions, light: true }), scale, 'image/jpeg'),
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
        case 'pdf': {
          const canvas = await draw(await renderSvg({ ...svgOptions, light: true }), scale, '#ffffff');
          const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg')).arrayBuffer());
          download(
            bytesToBlob(
              toPdf(jpeg, { width: canvas.width, height: canvas.height, dpi: 96 * scale, title: ir.meta.name }),
              'application/pdf',
            ),
            `${base}${suffix}.pdf`,
          );
          break;
        }
        case 'gif': {
          if (!flowId) throw new Error('elige un flujo: el GIF anima un recorrido');
          download(await renderGif(), `${base}-${flowId}.gif`);
          break;
        }
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
              <button type="button" onClick={() => void run('pdf')} disabled={busy !== null}>
                {busy === 'pdf' ? '…' : 'PDF'}
              </button>
            </div>
          </div>

          <div className="export__section">
            <span className="export__title">Animación</span>

            {flowId ? (
              <>
                <div className="export__row">
                  <span className="export__label">FPS</span>
                  <div className="export__scales">
                    {GIF_FPS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`export__scale${fps === value ? ' is-active' : ''}`}
                        onClick={() => setFps(value)}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="export__row">
                  <span className="export__label">Ritmo</span>
                  <div className="export__scales">
                    {GIF_SPEEDS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`export__scale${gifSpeed === value ? ' is-active' : ''}`}
                        onClick={() => setGifSpeed(value)}
                      >
                        {value === 0.6 ? 'Lento' : value === 0.75 ? 'Normal' : 'Ágil'}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  className="export__item"
                  onClick={() => void run('gif')}
                  disabled={busy !== null}
                >
                  <strong>{busy === 'gif' ? `GIF animado · ${progress} %` : 'GIF animado'}</strong>
                  <span>
                    Una vuelta completa del flujo activo, en bucle. Es lo que se pega en un Confluence
                    o en un Teams.
                  </span>
                </button>
              </>
            ) : (
              <p className="export__note">Selecciona un flujo para exportarlo como GIF.</p>
            )}
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
