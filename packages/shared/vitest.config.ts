import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared',
    include: ['**/*.spec.ts'],
    environment: 'node',
  },
});