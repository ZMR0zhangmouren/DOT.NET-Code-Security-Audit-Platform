import { describe, it, expect, vi, beforeEach } from 'vitest';

// §5.3 ScanService 端到端单测 —— fakeDb + stub queue/runner/storage 路线
// 绕开 drizzle ESM 循环依赖,通过 mock 把 ScanService 的所有依赖接入 fakeDb。

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {} as never,
}));

vi.mock('../db/schema.js', () => {
  const makeTable = (tableName: string): Record<string, unknown> => {
    const t: Record<string, unknown> = { __table: tableName };
    return new Proxy(t, {
      get: (target, prop: string) => {
        if (prop === '__table') return target['__table'];
        return { __table: target['__table'], __col: prop };
      },
    });
  };
  return {
    projects: makeTable('projects'),
    codeVersions: makeTable('code_versions'),
    scanRuns: makeTable('scan_runs'),
    skillBundleVersions: makeTable('skill_bundle_versions'),
    vulnerabilities: makeTable('vulnerabilities'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  and: (...conds: unknown[]) => ({ __and: conds }),
  desc: (col: { __table: string; __col: string }) => ({
    __desc: { table: col.__table, col: col.__col },
  }),
}));

// scan-queue + scan-runner 通过 type-only import,不会被加载;
// 这里 stub 出 ScanQueueService / ScanRunnerService / StorageService

interface FakeDb {
  rows: Record<string, Record<string, unknown>[]>;
  select: () => {
    from: (t: unknown) => {
      where: (cond: unknown) => {
        get: () => Record<string, unknown> | undefined;
        all: () => Record<string, unknown>[];
      };
      get: () => Record<string, unknown> | undefined;
      all: () => Record<string, unknown>[];
    };
  };
  insert: (t: unknown) => {
    values: (v: Record<string, unknown>) => {
      run: () => void;
    };
  };
  update: (t: unknown) => {
    set: (v: Record<string, unknown>) => {
      where: (cond: unknown) => {
        run: () => void;
      };
    };
  };
}

interface CondEq {
  __eq: { table: string; col: string; val: unknown };
}
interface CondAnd {
  __and: unknown[];
}
type Cond = CondEq | CondAnd | unknown;

function matchesCond(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond || typeof cond !== 'object') return true;
  if ('__eq' in (cond as object)) {
    const c = (cond as CondEq).__eq;
    return row[c.col] === c.val;
  }
  if ('__and' in (cond as object)) {
    return (cond as CondAnd).__and.every((c) => matchesCond(row, c));
  }
  return true;
}

function getTableName(t: unknown): string {
  if (t && typeof t === 'object') {
    const v = (t as Record<string, unknown>)['__table'];
    if (typeof v === 'string') return v;
  }
  return 'unknown';
}

function createFakeDb(): FakeDb {
  const rows: Record<string, Record<string, unknown>[]> = {};
  return {
    rows,
    select: (_cols?: unknown) => ({
      from: (t: unknown) => {
        const tableName = getTableName(t);
        if (!rows[tableName]) rows[tableName] = [];
        return {
          where: (cond: Cond) => ({
            get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
            all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
          }),
          get: () => rows[tableName]![0],
          all: () => rows[tableName]!,
        };
      },
    }),
    insert: (t: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const tableName = getTableName(t);
        if (!rows[tableName]) rows[tableName] = [];
        return {
          run: () => {
            rows[tableName]!.push(v);
          },
        };
      },
    }),
    update: (t: unknown) => ({
      set: (v: Record<string, unknown>) => ({
        where: (cond: Cond) => ({
          run: () => {
            const tableName = getTableName(t);
            const target = rows[tableName]!.find((r) => matchesCond(r, cond));
            if (target) Object.assign(target, v);
          },
        }),
      }),
    }),
  };
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

interface SeedOpts {
  withProject?: boolean;
  withCodeVersion?: boolean;
  withBundle?: boolean;
  withRun?: boolean;
  bundleActive?: boolean;
}

function seed(db: FakeDb, opts: SeedOpts = {}): void {
  db.rows['projects'] = db.rows['projects'] ?? [];
  db.rows['code_versions'] = db.rows['code_versions'] ?? [];
  db.rows['skill_bundle_versions'] = db.rows['skill_bundle_versions'] ?? [];
  db.rows['scan_runs'] = db.rows['scan_runs'] ?? [];
  db.rows['vulnerabilities'] = db.rows['vulnerabilities'] ?? [];

  if (opts.withProject !== false) {
    db.rows['projects']!.push({
      id: 'prj-1',
      name: 'demo',
      description: null,
      ownerId: 'usr-owner',
      visibility: 'private',
      status: 'active',
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    });
  }
  if (opts.withCodeVersion !== false) {
    db.rows['code_versions']!.push({
      id: 'cv-1',
      projectId: 'prj-1',
      versionLabel: 'v1',
      sourceType: 'zip',
      sourceRef: 'local',
      uploadedBy: 'usr-owner',
      uploadedAt: 1,
      checksum: 'sha256:abc',
      fileCount: 10,
      locCount: 100,
      sizeBytes: 1000,
      parentVersionId: null,
    });
  }
  if (opts.withBundle !== false) {
    db.rows['skill_bundle_versions']!.push({
      id: 'sb-1',
      version: 'v1.0.0',
      gitCommit: 'abc123',
      snapshotPath: '/tmp/bundle',
      isActive: opts.bundleActive !== false,
      note: null,
      createdAt: 1,
    });
  }
  if (opts.withRun) {
    db.rows['scan_runs']!.push({
      id: 'scan-1',
      projectId: 'prj-1',
      codeVersionId: 'cv-1',
      skillBundleId: 'sb-1',
      status: 'queued',
      triggeredBy: 'admin',
      triggerType: 'manual',
      queuedAt: 1_700_000_000_000,
      startedAt: null,
      finishedAt: null,
      durationSec: null,
      logPath: null,
      reportPath: null,
      errorMessage: null,
      retryCount: 0,
      coverageMode: 'FULL',
      auditSurfaceStatus: 'NOT_RUN',
      apiCoverageStatus: 'NOT_RUN',
      pipelineExecution: 'NOT_RUN',
      gateDecision: 'PENDING',
      controllerCoveragePercent: null,
      authCoveragePercent: null,
      outputRoot: '/tmp/scan-1',
    });
  }
}

// ──────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────

describe('ScanService (mocked DB)', () => {
  beforeEach(() => {
    // 每个测试间 reset 临时目录构造(fakeDb 是新建的)
  });

  it('create:project 不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb, { withProject: false });
    const enqueue = vi.fn();
    const cancel = vi.fn();
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };

    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue } as never,
      { cancel } as never,
      storage as never,
    );
    expect(() =>
      svc.create({
        projectId: 'prj-missing',
        codeVersionId: 'cv-1',
        skillBundleId: 'sb-1',
        triggerType: 'manual',
        triggeredBy: 'admin',
      }),
    ).toThrow(/project prj-missing not found/);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('create:codeVersion 不在 project 下 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb, { withCodeVersion: false });
    const enqueue = vi.fn();
    const cancel = vi.fn();
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };

    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue } as never,
      { cancel } as never,
      storage as never,
    );
    expect(() =>
      svc.create({
        projectId: 'prj-1',
        codeVersionId: 'cv-missing',
        skillBundleId: 'sb-1',
        triggerType: 'manual',
        triggeredBy: 'admin',
      }),
    ).toThrow(/codeVersion cv-missing not found in project prj-1/);
  });

  it('create:skillBundle 不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb, { withBundle: false });
    const enqueue = vi.fn();
    const cancel = vi.fn();
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };

    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue } as never,
      { cancel } as never,
      storage as never,
    );
    expect(() =>
      svc.create({
        projectId: 'prj-1',
        codeVersionId: 'cv-1',
        skillBundleId: 'sb-missing',
        triggerType: 'manual',
        triggeredBy: 'admin',
      }),
    ).toThrow(/skillBundle sb-missing not found/);
  });

  it('create:skillBundle 不 active → BadRequestException', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb, { bundleActive: false });
    const enqueue = vi.fn();
    const cancel = vi.fn();
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };

    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue } as never,
      { cancel } as never,
      storage as never,
    );
    expect(() =>
      svc.create({
        projectId: 'prj-1',
        codeVersionId: 'cv-1',
        skillBundleId: 'sb-1',
        triggerType: 'manual',
        triggeredBy: 'admin',
      }),
    ).toThrow(/skillBundle is not active/);
  });

  it('create:成功路径 → ScanRunPublic status=queued,入队', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb);
    const enqueue = vi.fn(() => ({ position: 0, running: 1, maxConcurrent: 2 }));
    const cancel = vi.fn();
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };

    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue } as never,
      { cancel } as never,
      storage as never,
    );
    const result = svc.create({
      projectId: 'prj-1',
      codeVersionId: 'cv-1',
      skillBundleId: 'sb-1',
      triggerType: 'manual',
      triggeredBy: 'admin',
    });
    expect(result.status).toBe('queued');
    expect(result.projectId).toBe('prj-1');
    expect(result.codeVersionId).toBe('cv-1');
    expect(result.skillBundleId).toBe('sb-1');
    expect(result.triggerType).toBe('manual');
    expect(result.triggeredBy).toBe('admin');
    expect(result.coverageMode).toBe('FULL');
    expect(result.id).toMatch(/^scan-/);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(result.id);
    expect(fakeDb.rows['scan_runs']).toHaveLength(1);
  });

  it('get:不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb);
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };
    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue: vi.fn() } as never,
      { cancel: vi.fn() } as never,
      storage as never,
    );
    expect(() => svc.get('scan-missing')).toThrow(/scanRun scan-missing not found/);
  });

  it('cancel:queued → 调 runner.cancel,返回 canceled=true', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb, { withRun: true });
    fakeDb.rows['scan_runs']![0]!['status'] = 'queued';
    const cancel = vi.fn(() => true);
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };

    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue: vi.fn() } as never,
      { cancel } as never,
      storage as never,
    );
    const r = svc.cancel('scan-1');
    expect(r.ok).toBe(true);
    expect(r.canceled).toBe(true);
    expect(cancel).toHaveBeenCalledWith('scan-1');
  });

  it('cancel:running → 调 runner.cancel', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb, { withRun: true });
    fakeDb.rows['scan_runs']![0]!['status'] = 'running';
    const cancel = vi.fn(() => true);
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };

    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue: vi.fn() } as never,
      { cancel } as never,
      storage as never,
    );
    const r = svc.cancel('scan-1');
    expect(r.canceled).toBe(true);
    expect(cancel).toHaveBeenCalledWith('scan-1');
  });

  it('cancel:succeeded → ok=true 但 canceled=false,不调 runner', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb, { withRun: true });
    fakeDb.rows['scan_runs']![0]!['status'] = 'succeeded';
    const cancel = vi.fn();
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };

    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue: vi.fn() } as never,
      { cancel } as never,
      storage as never,
    );
    const r = svc.cancel('scan-1');
    expect(r.ok).toBe(true);
    expect(r.canceled).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancel:failed / canceled → canceled=false', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb, { withRun: true });
    const cancel = vi.fn();
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };

    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue: vi.fn() } as never,
      { cancel } as never,
      storage as never,
    );
    fakeDb.rows['scan_runs']![0]!['status'] = 'failed';
    expect(svc.cancel('scan-1').canceled).toBe(false);
    fakeDb.rows['scan_runs']![0]!['status'] = 'canceled';
    expect(svc.cancel('scan-1').canceled).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('replay:创建新 run + triggerType=replay', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb, { withRun: true });
    const enqueue = vi.fn(() => ({ position: 0, running: 1, maxConcurrent: 2 }));
    const cancel = vi.fn();
    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };

    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue } as never,
      { cancel } as never,
      storage as never,
    );
    const replayed = svc.replay('scan-1');
    expect(replayed.triggerType).toBe('replay');
    expect(replayed.id).not.toBe('scan-1');
    expect(replayed.projectId).toBe('prj-1');
    expect(replayed.codeVersionId).toBe('cv-1');
    expect(replayed.skillBundleId).toBe('sb-1');
    expect(fakeDb.rows['scan_runs']).toHaveLength(2);
  });

  it('recomputeCoverage:写回 scanRuns 三个覆盖字段', async () => {
    const fakeDb = createFakeDb();
    seed(fakeDb, { withRun: true });
    // 准备一个 outputRoot 路径,让 computeApiCoverage 能跑(NOT_RUN 状态,totalRoutes=0)
    // fakeDb 不需要真目录;computeApiCoverage 会读 fs,fs 不存在的目录 → totalRoutes=0
    fakeDb.rows['scan_runs']![0]!['outputRoot'] = '/nonexistent-path-no-such-dir';
    fakeDb.rows['scan_runs']![0]!['apiCoverageStatus'] = 'NOT_RUN';
    fakeDb.rows['scan_runs']![0]!['controllerCoveragePercent'] = null;
    fakeDb.rows['scan_runs']![0]!['authCoveragePercent'] = null;

    const storage = { scanRunOutputRoot: (id: string) => `/tmp/${id}` };
    const mod = await import('./scan.service.js');
    const svc = new mod.ScanService(
      fakeDb as never,
      { enqueue: vi.fn() } as never,
      { cancel: vi.fn() } as never,
      storage as never,
    );

    const result = svc.recomputeCoverage('scan-1');
    // 空目录 → NOT_RUN
    expect(result.apiCoverageStatus).toBe('NOT_RUN');
    expect(result.controllerCoveragePercent).toBeNull();
    expect(result.authCoveragePercent).toBeNull();
    // DB 行确实被更新
    const row = fakeDb.rows['scan_runs']![0]!;
    expect(row['apiCoverageStatus']).toBe('NOT_RUN');
  });
});
