import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'cli/index': 'src/cli/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: false,
  splitting: false,
  sourcemap: false,
  // elkjs es un bundle GWT enorme y no se beneficia de ser reempaquetado.
  external: ['elkjs'],
  // Sin banner: tsup ya conserva el shebang de `src/cli/index.ts`. Añadirlo
  // aquí produce dos, y el segundo es un error de sintaxis para Node.
});
