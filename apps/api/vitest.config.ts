import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    name: 'api',
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
        // 纯装饰器模块 —— 无运行时逻辑,加 spec 价值低:
        'src/app.module.ts',
        'src/**/*.module.ts',
        // Drizzle schema 声明 —— 15 张表的列定义,560 行纯表描述,无业务逻辑
        // (Phase 2 真实 e2e 才能验证 SQL 形态)
        'src/db/schema.ts',
        // Seed 脚本 —— 一次性写默认 admin,跑测试时无意义
        'src/db/seed.ts',
      ],
      // MVP coverage 门禁 —— 2026-06-29 启用,要求 ≥70%
      //   - lines: 70, functions: 70, branches: 60, statements: 70
      // 提升路径见 git log:从 25.45% → 57.6% → ≥70%(把高价值 .service/.controller
      // 加上 spec,装饰器和 schema 排除在门禁外)。
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@platform/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
