import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared',
    include: ['**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/main.ts',
        'src/**/migrations/**',
      ],
      // MVP coverage 目标 — 2026-06-28 启用阈值(实测 100% 全绿):
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
