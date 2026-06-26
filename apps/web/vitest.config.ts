import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    include: ['**/*.spec.{ts,tsx}'],
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@platform/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
