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
      ],
      // MVP coverage 目标(后续按需调严并启用):
      //   lines: 70, functions: 70, branches: 60, statements: 70
      //
      // 2026-06-28 状态:从 25.45% 提升到 57.6%(lines),但仍未到 70%。
      // 阻塞项:
      //   - db/schema.ts(560 行,纯 drizzle table 定义,几乎无逻辑)
      //   - scan/scan-runner.service.ts(620 行,依赖真 OpenAI SDK,跑不动单测)
      //   - scan/tools/code-tools.service.ts(316 行,文件 IO + git 操作)
      //   - report.service.ts(8 段 markdown 生成,边界多)
      //   - 各 *module.ts(8-50 行,纯 NestJS 装饰器元数据)
      // 这些靠 e2e(Playwright/Supertest)+ 真实 SQLite 才有意义,
      // 暂留阈值注释,Phase 2 接 e2e 后再启用 thresholds。
    },
  },
  resolve: {
    alias: {
      '@platform/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
