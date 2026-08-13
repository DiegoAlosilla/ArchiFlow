const OPENING: Record<string, string> = { '{': '}', '[': ']' };

/**
 * Presenta JSON real y las formas compactas que suele producir el scanner
 * (`Tipo { campo, otro: string(...) }`) como un body legible tipo Postman.
 */
export function beautifyPayload(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed) return '';

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    // Los contratos inferidos no siempre son JSON válido. Se formatean sin
    // inventar comillas ni cambiar el significado que vino del repositorio.
  }

  let output = '';
  let indent = 0;
  let quote: string | null = null;
  let escaped = false;
  let parenthesisDepth = 0;
  const containers: string[] = [];

  const newline = () => {
    output = output.trimEnd();
    if (!output.endsWith('\n')) output += '\n';
    output += '  '.repeat(indent);
  };

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;

    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      continue;
    }

    if (character === '(') {
      parenthesisDepth += 1;
      output += character;
      continue;
    }
    if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      output += character;
      continue;
    }

    if (OPENING[character]) {
      containers.push(character);
      output = `${output.trimEnd()} ${character}`;
      indent += 1;
      newline();
      continue;
    }

    if (character === '}' || character === ']') {
      containers.pop();
      indent = Math.max(0, indent - 1);
      output = output.trimEnd();
      output += '\n' + '  '.repeat(indent) + character;
      continue;
    }

    if (character === ',' && containers.length > 0 && parenthesisDepth === 0) {
      output += character;
      newline();
      continue;
    }

    if (character === ':' && containers.length > 0) {
      output = `${output.trimEnd()}: `;
      while (trimmed[index + 1] === ' ') index += 1;
      continue;
    }

    if (/\s/.test(character)) {
      if (!output.endsWith(' ') && !output.endsWith('\n')) output += ' ';
      continue;
    }

    output += character;
  }

  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}
