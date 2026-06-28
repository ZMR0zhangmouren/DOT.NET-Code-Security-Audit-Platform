import { describe, it, expect, vi } from 'vitest';

// §5.4 ScanDiffService 单测 —— fakeDb + stub scan/library 路线
// service 通过 type-only import ScanService / VulnLibraryService,直接 stub 它们

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
    vulnerabilities: makeTable('vulnerabilities'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
}));

// ──────────────────────────────────────────────────────────────────────
// fakeDb
// ──────────────────────────────────────────────────────────────────────

interface FakeDb {
  rows: Record<string, Record<string, unknown>[]>;
  select: () => {
    from: (t: unknown) => {
      where: (cond: unknown) => {
        all: () => Record<string, unknown>[];
        get: () => Record<string, unknown> | undefined;
      };
      all: () => Record<string, unknown>[];
      get: () => Record<string, unknown> | undefined;
    };
  };
  selectDistinct: () => {
    from: (t: unknown) => {
      where: (cond: unknown) => {
        all: () => Record<string, unknown>[];
      };
    };
  };
  insert: (t: unknown) => {
    values: (v: Record<string, unknown>) => {
      run: () => void;
    };
  };
}

interface CondEq {
  __eq: { table: string; col: string; val: unknown };
}
type Cond = CondEq | unknown;

function matchesCond(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond || typeof cond !== 'object') return true;
  if ('__eq' in (cond as object)) {
    const c = (cond as CondEq).__eq;
    return row[c.col] === c.val;
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
    select: () => ({
      from: (t: unknown) => {
        const tableName = getTableName(t);
        if (!rows[tableName]) rows[tableName] = [];
        return {
          where: (cond: Cond) => ({
            all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
            get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
          }),
          all: () => rows[tableName]!,
          get: () => rows[tableName]![0],
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
    selectDistinct: () => ({
      from: (t: unknown) => {
        const tableName = getTableName(t);
        if (!rows[tableName]) rows[tableName] = [];
        return {
          where: (cond: Cond) => ({
            all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
          }),
        };
      },
    }),
  };
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function makeScanRun(id: string, projectId: string): Record<string, unknown> {
  return {
    id,
    projectId,
    codeVersionId: 'cv-1',
    skillBundleId: 'sb-1',
    status: 'succeeded',
    triggeredBy: 'admin',
    triggerType: 'manual',
    queuedAt: 1_700_000_000_000,
    startedAt: 1_700_000_001_000,
    finishedAt: 1_700_000_115_000,
    durationSec: 114,
    errorMessage: null,
    retryCount: 0,
    coverageMode: 'FULL',
    auditSurfaceStatus: 'COMPLETED',
    apiCoverageStatus: 'COMPLETE',
    pipelineExecution: 'COMPLETED',
    gateDecision: 'PASS',
    controllerCoveragePercent: 8000,
    authCoveragePercent: 7500,
    outputRoot: `/tmp/${id}`,
  };
}

function makeVuln(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: over.id ?? `v-${Math.random()}`,
    scanRunId: over.scanRunId ?? 'scan-A',
    projectId: 'prj-1',
    codeVersionId: 'cv-1',
    libraryId: null,
    vulnType: 'sql',
    severity: 'M',
    cvssScore: 50,
    fingerprint: 'fp-default',
    filePath: 'A.cs',
    lineStart: 10,
    lineEnd: 20,
    codeSnippet: 'cmd',
    exploitPayload: null,
    fixSuggestion: 'fix',
    evidenceRefs: [],
    status: 'open',
    assigneeId: null,
    fixedInVersionId: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function makeLibEntry(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: over.id ?? `lib-${Math.random()}`,
    projectId: 'prj-1',
    fingerprint: over.fingerprint ?? 'fp-default',
    vulnType: over.vulnType ?? 'sql',
    severityMax: over.severityMax ?? 'M',
    status: over.status ?? 'open',
    title: 't',
    description: null,
    tags: [],
    occurrenceCount: 1,
    firstSeenAt: 1,
    firstSeenVersionId: 'cv-1',
    lastSeenAt: 1,
    lastSeenVersionId: 'cv-1',
    fixedInVersionId: null,
    fixedAt: null,
    assigneeId: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

// ──────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────

describe('ScanDiffService (mocked DB)', () => {
  it('a === b → BadRequestException', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows['vulnerabilities'] = [];

    const scanStub = { get: vi.fn() };
    const libStub = { list: vi.fn(() => []) };

    const mod = await import('./scan-diff.service.js');
    const svc = new mod.ScanDiffService(fakeDb as never, scanStub as never, libStub as never);

    expect(() => svc.diff('prj-1', 'scan-A', 'scan-A')).toThrow(
      /a and b must be different scanRun ids/,
    );
    expect(scanStub.get).not.toHaveBeenCalled();
  });

  it('a 不属于 project → BadRequestException', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows['vulnerabilities'] = [];

    const scanStub = {
      get: vi.fn((id: string) =>
        id === 'scan-A' ? makeScanRun('scan-A', 'prj-OTHER') : makeScanRun('scan-B', 'prj-1'),
      ),
    };
    const libStub = { list: vi.fn(() => []) };

    const mod = await import('./scan-diff.service.js');
    const svc = new mod.ScanDiffService(fakeDb as never, scanStub as never, libStub as never);

    expect(() => svc.diff('prj-1', 'scan-A', 'scan-B')).toThrow(
      /scanRuns must belong to project prj-1/,
    );
  });

  it('b 不属于 project → BadRequestException', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows['vulnerabilities'] = [];

    const scanStub = {
      get: vi.fn((id: string) =>
        id === 'scan-A' ? makeScanRun('scan-A', 'prj-1') : makeScanRun('scan-B', 'prj-OTHER'),
      ),
    };
    const libStub = { list: vi.fn(() => []) };

    const mod = await import('./scan-diff.service.js');
    const svc = new mod.ScanDiffService(fakeDb as never, scanStub as never, libStub as never);

    expect(() => svc.diff('prj-1', 'scan-A', 'scan-B')).toThrow(
      /scanRuns must belong to project prj-1/,
    );
  });

  it('正常路径:返回 ScanDiff 含 vulns 三类 + library 三类 + coverage delta', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows['vulnerabilities'] = [];

    const runA = makeScanRun('scan-A', 'prj-1');
    const runB = makeScanRun('scan-B', 'prj-1');
    // 给 runB 不同的 coveragePercent,以便看 delta
    (runB as Record<string, unknown>)['controllerCoveragePercent'] = 9500;

    const scanStub = {
      get: vi.fn((id: string) => (id === 'scan-A' ? runA : runB)),
    };
    const libStub = {
      list: vi.fn(() => [
        makeLibEntry({ fingerprint: 'fp-A', severityMax: 'L', status: 'open' }),
        makeLibEntry({ fingerprint: 'fp-B', severityMax: 'M', status: 'open' }),
      ]),
    };

    const mod = await import('./scan-diff.service.js');
    const svc = new mod.ScanDiffService(fakeDb as never, scanStub as never, libStub as never);

    const diff = svc.diff('prj-1', 'scan-A', 'scan-B');
    expect(diff.projectId).toBe('prj-1');
    expect(diff.runA.id).toBe('scan-A');
    expect(diff.runB.id).toBe('scan-B');
    expect(diff.vulnerabilities).toBeDefined();
    expect(diff.vulnLibrary).toBeDefined();
    expect(diff.coverage.aPercent).toBe(80);
    expect(diff.coverage.bPercent).toBe(95);
    expect(diff.coverage.delta).toBe(15);
  });

  it('vuln 反推:runA 有 SQL,runB 没有 → onlyInA', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows['vulnerabilities'] = [
      makeVuln({ scanRunId: 'scan-A', fingerprint: 'fp-sql', vulnType: 'sql', severity: 'H' }),
    ];

    const runA = makeScanRun('scan-A', 'prj-1');
    const runB = makeScanRun('scan-B', 'prj-1');
    const scanStub = {
      get: vi.fn((id: string) => (id === 'scan-A' ? runA : runB)),
    };
    const libStub = { list: vi.fn(() => []) };

    const mod = await import('./scan-diff.service.js');
    const svc = new mod.ScanDiffService(fakeDb as never, scanStub as never, libStub as never);

    const diff = svc.diff('prj-1', 'scan-A', 'scan-B');
    expect(diff.vulnerabilities.onlyInA.map((v) => v.fingerprint)).toEqual(['fp-sql']);
    expect(diff.vulnerabilities.onlyInB).toEqual([]);
    expect(diff.vulnerabilities.inBoth).toEqual([]);
  });

  it('vuln 反推:runB 有 XSS,runA 没有 → onlyInB', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows['vulnerabilities'] = [
      makeVuln({ scanRunId: 'scan-B', fingerprint: 'fp-xss', vulnType: 'xss', severity: 'L' }),
    ];

    const runA = makeScanRun('scan-A', 'prj-1');
    const runB = makeScanRun('scan-B', 'prj-1');
    const scanStub = {
      get: vi.fn((id: string) => (id === 'scan-A' ? runA : runB)),
    };
    const libStub = { list: vi.fn(() => []) };

    const mod = await import('./scan-diff.service.js');
    const svc = new mod.ScanDiffService(fakeDb as never, scanStub as never, libStub as never);

    const diff = svc.diff('prj-1', 'scan-A', 'scan-B');
    expect(diff.vulnerabilities.onlyInA).toEqual([]);
    expect(diff.vulnerabilities.onlyInB.map((v) => v.fingerprint)).toEqual(['fp-xss']);
    expect(diff.vulnerabilities.inBoth).toEqual([]);
  });

  it('vuln 反推:共有 fingerprint,B severity 升 → upgraded', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows['vulnerabilities'] = [
      makeVuln({ scanRunId: 'scan-A', fingerprint: 'fp-shared', severity: 'L' }),
      makeVuln({ scanRunId: 'scan-B', fingerprint: 'fp-shared', severity: 'H' }),
    ];

    const runA = makeScanRun('scan-A', 'prj-1');
    const runB = makeScanRun('scan-B', 'prj-1');
    const scanStub = {
      get: vi.fn((id: string) => (id === 'scan-A' ? runA : runB)),
    };
    const libStub = { list: vi.fn(() => []) };

    const mod = await import('./scan-diff.service.js');
    const svc = new mod.ScanDiffService(fakeDb as never, scanStub as never, libStub as never);

    const diff = svc.diff('prj-1', 'scan-A', 'scan-B');
    expect(diff.vulnerabilities.inBoth).toHaveLength(1);
    expect(diff.vulnerabilities.inBoth[0]?.fingerprint).toBe('fp-shared');
    expect(diff.vulnerabilities.inBoth[0]?.severityChanged).toBe('upgraded');
  });

  it('vuln 反推:共有 fingerprint,B severity 降 → downgraded', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows['vulnerabilities'] = [
      makeVuln({ scanRunId: 'scan-A', fingerprint: 'fp-shared', severity: 'C' }),
      makeVuln({ scanRunId: 'scan-B', fingerprint: 'fp-shared', severity: 'M' }),
    ];

    const runA = makeScanRun('scan-A', 'prj-1');
    const runB = makeScanRun('scan-B', 'prj-1');
    const scanStub = {
      get: vi.fn((id: string) => (id === 'scan-A' ? runA : runB)),
    };
    const libStub = { list: vi.fn(() => []) };

    const mod = await import('./scan-diff.service.js');
    const svc = new mod.ScanDiffService(fakeDb as never, scanStub as never, libStub as never);

    const diff = svc.diff('prj-1', 'scan-A', 'scan-B');
    expect(diff.vulnerabilities.inBoth[0]?.severityChanged).toBe('downgraded');
  });

  it('vuln 反推:共有 fingerprint,severity 不变 → unchanged', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows['vulnerabilities'] = [
      makeVuln({ scanRunId: 'scan-A', fingerprint: 'fp-shared', severity: 'H' }),
      makeVuln({ scanRunId: 'scan-B', fingerprint: 'fp-shared', severity: 'H' }),
    ];

    const runA = makeScanRun('scan-A', 'prj-1');
    const runB = makeScanRun('scan-B', 'prj-1');
    const scanStub = {
      get: vi.fn((id: string) => (id === 'scan-A' ? runA : runB)),
    };
    const libStub = { list: vi.fn(() => []) };

    const mod = await import('./scan-diff.service.js');
    const svc = new mod.ScanDiffService(fakeDb as never, scanStub as never, libStub as never);

    const diff = svc.diff('prj-1', 'scan-A', 'scan-B');
    expect(diff.vulnerabilities.inBoth[0]?.severityChanged).toBe('unchanged');
  });
});
