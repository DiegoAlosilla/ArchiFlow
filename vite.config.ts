import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const resolvePath = (segment: string) => fileURLToPath(new URL(segment, import.meta.url));

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@archiflow/schema': resolvePath('./src/schema/index.ts'),
      '@archiflow/shared': resolvePath('./src/shared/index.ts'),
      '@archiflow/layout': resolvePath('./src/layout/index.ts'),
      '@archiflow/theme': resolvePath('./src/theme.ts'),
    },
  },
  server: {
    port: 4124,
    // En desarrollo la web vive en Vite y los datos los sirve el CLI.
    // En producción el CLI sirve ambos desde el mismo origen.
    proxy: {
      '/api': 'http://localhost:4123',
      '/ws': { target: 'ws://localhost:4123', ws: true },
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
});
