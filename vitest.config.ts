import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 单包模式:vitest workspace 模式在 pnpm monorepo + Windows 长路径下兼容性差
    // 改为 `pnpm -r test` 触发每个子包独立跑测试,各包自带 vitest.config.ts
    passWithNoTests: true,
  },
});