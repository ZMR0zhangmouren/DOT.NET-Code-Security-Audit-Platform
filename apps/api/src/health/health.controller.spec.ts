import { describe, it, expect } from 'vitest';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  const controller = new HealthController();

  it('check() 返回 ok 状态', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
  });

  it('check() 暴露 coverage_mode 默认值 FULL', () => {
    const result = controller.check();
    expect(result.coverageModeDefault).toBe('FULL');
  });

  it('check() 暴露 Node.js 版本', () => {
    const result = controller.check();
    expect(result.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
  });
});
