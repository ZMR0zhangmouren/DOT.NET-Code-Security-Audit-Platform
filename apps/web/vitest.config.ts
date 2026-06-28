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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.spec.tsx',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/main.ts',
        'src/**/migrations/**',
      ],
      // MVP coverage 目标(后续按需调严并启用):
      //   lines: 70, functions: 70, branches: 60, statements: 70
      // 当前首跑覆盖率 < 70%,暂不设置 thresholds 以免 CI 红;
      // 提升到目标值后,把上面 thresholds 对象打开即可生效。
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@platform/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
