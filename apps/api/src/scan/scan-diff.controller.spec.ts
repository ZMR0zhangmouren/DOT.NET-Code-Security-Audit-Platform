import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

import type { ScanDiffController } from './scan-diff.controller.js';

// scan-diff.controller 端点覆盖

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({}));

async function makeController(): Promise<{
  controller: ScanDiffController;
  diff: {
    diff: ReturnType<typeof vi.fn>;
  };
}> {
  const mod = await import('./scan-diff.controller.js');
  const diff = {
    diff: vi.fn(() => ({
      summary: { added: 1, removed: 0, severityChanged: 0 },
    })),
  };
  const controller = new mod.ScanDiffController(diff as never);
  return { controller, diff };
}

describe('ScanDiffController (§5.4)', () => {
  it('diff(projectId, a, b) → 调 svc.diff(projectId, a, b)', async () => {
    const { controller, diff } = await makeController();
    const out = controller.diff('p1', 'scan-a', 'scan-b');
    expect(out.summary.added).toBe(1);
    expect(diff.diff).toHaveBeenCalledWith('p1', 'scan-a', 'scan-b');
  });

  it('a 缺失 → BadRequestException', async () => {
    const { controller } = await makeController();
    expect(() => controller.diff('p1', undefined, 'scan-b')).toThrow(BadRequestException);
  });

  it('b 缺失 → BadRequestException', async () => {
    const { controller } = await makeController();
    expect(() => controller.diff('p1', 'scan-a', undefined)).toThrow(BadRequestException);
  });

  it('a/b 都缺失 → BadRequestException', async () => {
    const { controller } = await makeController();
    expect(() => controller.diff('p1', undefined, undefined)).toThrow(BadRequestException);
  });
});
