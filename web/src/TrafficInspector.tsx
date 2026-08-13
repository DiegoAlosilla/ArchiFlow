import type { IrStep } from '@archiflow/schema';
import type { ReactNode } from 'react';
import { beautifyPayload } from './payloadFormat';

interface Props {
  step: IrStep | null;
  pinned: boolean;
  onFollow: () => void;
}

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(.+)$/i;

function valueTokens(value: string): ReactNode[] {
  const tokens = value.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b|[{}[\],])/g);
  return tokens.filter(Boolean).map((token, index) => {
    let kind = 'plain';
    if (/^["']/.test(token)) kind = 'string';
    else if (/^(?:true|false|null)$/.test(token)) kind = 'literal';
    else if (/^-?\d/.test(token)) kind = 'number';
    else if (/^[{}[\],]$/.test(token)) kind = 'punctuation';
    return <span className={`traffic__token traffic__token--${kind}`} key={`${index}-${token}`}>{token}</span>;
  });
}

function PayloadPreview({ payload }: { payload: string }) {
  const formatted = beautifyPayload(payload);
  return (
    <pre aria-label="Body formateado">
      <code>
        {formatted.split('\n').map((line, index) => {
          const property = /^(\s*)([\w.$/-]+)(\s*:\s*)(.*)$/.exec(line);
          const field = /^(\s*)([\w.$/-]+)(,?)$/.exec(line);
          const type = /^(\s*)([^{}[\]]+?)(\s*[{[])$/.exec(line);
          return (
            <span className="traffic__line" key={`${index}-${line}`}>
              {property ? <><span>{property[1]}</span><span className="traffic__token--key">{property[2]}</span><span className="traffic__token--punctuation">{property[3]}</span>{valueTokens(property[4]!)}</>
                : field ? <><span>{field[1]}</span><span className="traffic__token--key">{field[2]}</span><span className="traffic__token--punctuation">{field[3]}</span></>
                  : type ? <><span>{type[1]}</span><span className="traffic__token--type">{type[2]}</span><span className="traffic__token--punctuation">{type[3]}</span></>
                    : valueTokens(line)}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export function TrafficInspector({ step, pinned, onFollow }: Props) {
  if (!step) {
    return <section className="traffic traffic--empty"><p>Reproduce un flujo o selecciona una flecha para inspeccionar el mensaje.</p></section>;
  }

  const match = METHOD.exec(step.label);
  const method = match?.[1]?.toUpperCase();
  const path = match?.[2];
  const kind = step.request ? 'request' : 'response';
  const payload = step.request ?? step.response ?? step.returns;

  return (
    <section className={`traffic traffic--${kind}`} aria-label="Inspector de tráfico">
      <header className="traffic__header">
        <span className={`traffic__direction traffic__direction--${kind}`}>{kind}</span>
        <span className="traffic__step">Paso {step.index + 1}</span>
        {pinned ? <button type="button" onClick={onFollow}>Seguir animación</button> : <span className="traffic__live"><i /> En vivo</span>}
      </header>

      <div className="traffic__operation">
        {method && <strong className={`traffic__method traffic__method--${method.toLowerCase()}`}>{method}</strong>}
        <span>{path ?? step.label}</span>
      </div>

      <dl className="traffic__route">
        <div><dt>Origen</dt><dd>{step.from}{step.fromOp ? ` / ${step.fromOp}` : ''}</dd></div>
        <div><dt>Destino</dt><dd>{step.to}{step.toOp ? ` / ${step.toOp}` : ''}</dd></div>
        <div><dt>Protocolo</dt><dd>{step.protocol}</dd></div>
      </dl>

      <div className="traffic__section">
        <h3>Headers <span>{step.headers.length}</span></h3>
        {step.headers.length > 0 ? (
          <ul className="traffic__headers">
            {step.headers.map((header) => (
              <li key={header.name}>
                <code>{header.name}</code>
                {header.required && <b>required</b>}
                <span>{header.value ?? header.description ?? 'valor requerido'}</span>
              </li>
            ))}
          </ul>
        ) : <p className="traffic__none">Este salto no declara headers obligatorios.</p>}
      </div>

      <div className="traffic__section traffic__body">
        <h3>{kind === 'request' ? 'Request body' : 'Response body'}</h3>
        <PayloadPreview payload={payload ?? 'Sin cuerpo'} />
      </div>
    </section>
  );
}
