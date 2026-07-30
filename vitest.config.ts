import { defineConfig } from 'vitest/config';

// Configuración propia para que Vitest no herede `root: 'web'` de vite.config.ts:
// las pruebas son de los módulos de Node, no de la web.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
