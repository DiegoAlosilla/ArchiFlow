import { useEffect, useRef, useState } from 'react';

/**
 * Campos del inspector.
 *
 * Todos confirman al perder el foco o con Enter, nunca en cada pulsación:
 * cada confirmación escribe el fichero en disco, y guardar por carácter
 * llenaría el YAML de estados intermedios y saturaría al vigilante.
 * Escape descarta lo escrito.
 */

interface BaseProps {
  label: string;
  hint?: string;
}

interface TextProps extends BaseProps {
  value: string | undefined;
  onCommit: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
}

export function TextField({ label, value, onCommit, placeholder, mono, multiline, hint }: TextProps) {
  const [draft, setDraft] = useState(value ?? '');
  const committed = useRef(value ?? '');

  useEffect(() => {
    setDraft(value ?? '');
    committed.current = value ?? '';
  }, [value]);

  const commit = () => {
    if (draft !== committed.current) {
      committed.current = draft;
      onCommit(draft);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !multiline) {
      event.preventDefault();
      (event.target as HTMLElement).blur();
    }
    if (event.key === 'Escape') {
      setDraft(committed.current);
      (event.target as HTMLElement).blur();
    }
  };

  const className = `field__input${mono ? ' field__input--mono' : ''}`;

  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {multiline ? (
        <textarea
          className={className}
          rows={3}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <input
          className={className}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      )}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

interface NumberProps extends BaseProps {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  placeholder?: string;
}

export function NumberField({ label, value, onCommit, placeholder, hint }: NumberProps) {
  const [draft, setDraft] = useState(value?.toString() ?? '');
  const committed = useRef(value?.toString() ?? '');

  useEffect(() => {
    setDraft(value?.toString() ?? '');
    committed.current = value?.toString() ?? '';
  }, [value]);

  const commit = () => {
    if (draft === committed.current) return;
    committed.current = draft;
    const parsed = Number(draft);
    // Vacío borra el campo; un número inválido no se propaga.
    if (draft.trim() === '') onCommit(undefined);
    else if (Number.isFinite(parsed) && parsed > 0) onCommit(parsed);
  };

  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input field__input--mono"
        inputMode="numeric"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLElement).blur();
        }}
      />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

interface SelectProps extends BaseProps {
  value: string | undefined;
  options: ReadonlyArray<string | { value: string; label: string }>;
  onCommit: (value: string) => void;
  /** Añade una opción vacía al principio, para poder desasignar. */
  allowEmpty?: string;
}

export function SelectField({ label, value, options, onCommit, allowEmpty, hint }: SelectProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select
        className="field__input"
        value={value ?? ''}
        onChange={(event) => onCommit(event.target.value)}
      >
        {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
        {options.map((option) => {
          const item = typeof option === 'string' ? { value: option, label: option } : option;
          return (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          );
        })}
      </select>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

interface CheckboxProps extends BaseProps {
  value: boolean;
  onCommit: (value: boolean) => void;
}

export function CheckboxField({ label, value, onCommit, hint }: CheckboxProps) {
  return (
    <label className="field field--inline">
      <input type="checkbox" checked={value} onChange={(event) => onCommit(event.target.checked)} />
      <span className="field__label">{label}</span>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}
