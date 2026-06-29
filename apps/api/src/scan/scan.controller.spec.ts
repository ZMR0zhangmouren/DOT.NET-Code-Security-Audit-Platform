import { describe, it, expect, vi } from 'vitest';

import type { ScanController } from './scan.controller.js';

// §5.3 ScanController 端点覆盖:
// - POST /scan-runs → 调 svc.create + 透传 triggeredBy from JWT
// - GET /scan-runs/:id
// - GET /projects/:id/scan-runs
// - POST /scan-runs/:id/cancel
// - POST /scan-runs/:id/replay
// - POST /scan-runs/:id/recompute-coverage
//
// Controller 只是把 body/param 转交给 service,核心逻辑已被 scan.service.spec.ts 覆盖;
// 这里用 mock service 验证 controller 的 wiring(用户/sub 取值、传参)

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));

vi.mock('../db/schema.js', () => ({}));

vi.mock('drizzle-orm', () => ({}));

interface UserLike {
  sub: string;
  role: 'admin' | 'auditor' | 'developer' | 'viewer';
}

async function makeController(): Promise<{
  controller: ScanController;
  svc: {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    listByProject: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    replay: ReturnType<typeof vi.fn>;
    recomputeCoverage: ReturnType<typeof vi.fn>;
  };
  skillBundles: { listActive: ReturnType<typeof vi.fn> };
  metrics: { incScanTotal: ReturnType<typeof vi.fn> };
}> {
  const mod = await import('./scan.controller.js');
  const svc = {
    create: vi.fn(async () => ({ id: 'scan-1' })),
    get: vi.fn(() => ({ id: 'scan-1' })),
    listByProject: vi.fn(() => [{ id: 'scan-1' }]),
    cancel: vi.fn(() => ({ ok: true, canceled: true })),
    replay: vi.fn(async () => ({ id: 'scan-2' })),
    recomputeCoverage: vi.fn(() => ({ id: 'scan-1' })),
  };
  const skillBundles = { listActive: vi.fn(() => []) };
  // §10.3 —— MetricsService stub(测试里不验 metric,只确保 controller 调用时不 crash)
  const metrics = {
    incScanTotal: vi.fn(),
    incVulnFound: vi.fn(),
    incAgentCall: vi.fn(),
    addAgentTokens: vi.fn(),
    startScanDurationTimer: vi.fn(() => () => 0),
  };
  const controller = new mod.ScanController(svc as never, skillBundles as never, metrics as never);
  return { controller, svc, skillBundles, metrics };
}

describe('ScanController', () => {
  it('POST /scan-runs create → user.sub 作为 triggeredBy', async () => {
    const { controller, svc, metrics } = await makeController();
    const user: UserLike = { sub: 'usr-1', role: 'admin' };
    const out = await controller.create(user, {
      projectId: 'p1',
      codeVersionId: 'cv-1',
      skillBundleId: 'sb-1',
      triggerType: 'manual',
      coverageMode: 'FULL',
    });
    expect(out).toEqual({ id: 'scan-1' });
    expect(svc.create).toHaveBeenCalledWith({
      projectId: 'p1',
      codeVersionId: 'cv-1',
      skillBundleId: 'sb-1',
      triggerType: 'manual',
      triggeredBy: 'usr-1',
      coverageMode: 'FULL',
    });
    // §10.3 —— scan_total{project=p1, status=queued, triggerType=manual}
    expect(metrics.incScanTotal).toHaveBeenCalledWith('p1', 'queued', 'manual');
  });

  it('POST /scan-runs create 无 user → triggeredBy = "unknown"', async () => {
    const { controller, svc, metrics } = await makeController();
    await controller.create(undefined as never, {
      projectId: 'p1',
      codeVersionId: 'cv-1',
      skillBundleId: 'sb-1',
      triggerType: 'scheduled',
    });
    expect(svc.create).toHaveBeenCalledWith({
      projectId: 'p1',
      codeVersionId: 'cv-1',
      skillBundleId: 'sb-1',
      triggerType: 'scheduled',
      triggeredBy: 'unknown',
      coverageMode: undefined,
    });
    // §10.3 —— scan_total{project=p1, status=queued, triggerType=scheduled}
    expect(metrics.incScanTotal).toHaveBeenCalledWith('p1', 'queued', 'scheduled');
  });

  it('POST /scan-runs create 不传 triggerType → 默认 manual', async () => {
    const { controller, svc, metrics } = await makeController();
    const user: UserLike = { sub: 'u', role: 'admin' };
    await controller.create(user, {
      projectId: 'p1',
      codeVersionId: 'cv-1',
      skillBundleId: 'sb-1',
    });
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({ triggerType: 'manual' }));
    // §10.3 —— triggerType 缺省时 incScanTotal 也得用 'manual'
    expect(metrics.incScanTotal).toHaveBeenCalledWith('p1', 'queued', 'manual');
  });

  it('GET /scan-runs/:id get → 调 svc.get(id)', async () => {
    const { controller, svc } = await makeController();
    const out = controller.get('scan-1');
    expect(out).toEqual({ id: 'scan-1' });
    expect(svc.get).toHaveBeenCalledWith('scan-1');
  });

  it('GET /projects/:id/scan-runs list → 调 svc.listByProject(id)', async () => {
    const { controller, svc } = await makeController();
    const out = controller.list('p1');
    expect(out).toEqual([{ id: 'scan-1' }]);
    expect(svc.listByProject).toHaveBeenCalledWith('p1');
  });

  it('POST /scan-runs/:id/cancel → 调 svc.cancel(id)', async () => {
    const { controller, svc } = await makeController();
    const out = controller.cancel('scan-1');
    expect(out).toEqual({ ok: true, canceled: true });
    expect(svc.cancel).toHaveBeenCalledWith('scan-1');
  });

  it('POST /scan-runs/:id/replay → 调 svc.replay(id)', async () => {
    const { controller, svc } = await makeController();
    const out = await controller.replay('scan-1');
    expect(out).toEqual({ id: 'scan-2' });
    expect(svc.replay).toHaveBeenCalledWith('scan-1');
  });

  it('POST /scan-runs/:id/recompute-coverage → 调 svc.recomputeCoverage(id)', async () => {
    const { controller, svc } = await makeController();
    const out = controller.recomputeCoverage('scan-1');
    expect(out).toEqual({ id: 'scan-1' });
    expect(svc.recomputeCoverage).toHaveBeenCalledWith('scan-1');
  });
});
