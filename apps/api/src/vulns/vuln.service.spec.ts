import { describe, it, expect, vi } from 'vitest';

// §5.5 VulnService 单测 —— fakeDb + stub library 路线
// service 接受 VulnLibraryService 依赖,通过 stub 化 syncFromVulnerability 来验证联动

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
        get: () => Record<string, unknown> | undefined;
        all: () => Record<string, unknown>[];
      };
      get: () => Record<string, unknown> | undefined;
      all: () => Record<string, unknown>[];
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
            get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
            all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
          }),
          get: () => rows[tableName]![0],
          all: () => rows[tableName]!,
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

function seedVuln(
  db: FakeDb,
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  db.rows['vulnerabilities'] = db.rows['vulnerabilities'] ?? [];
  const row = {
    id: 'v-1',
    scanRunId: 'scan-1',
    projectId: 'prj-1',
    codeVersionId: 'cv-1',
    libraryId: 'lib-1',
    vulnType: 'sql',
    severity: 'H' as 'C' | 'H' | 'M' | 'L',
    cvssScore: 80,
    fingerprint: 'fp-1',
    filePath: 'A.cs',
    lineStart: 10,
    lineEnd: 20,
    codeSnippet: 'cmd',
    exploitPayload: null,
    fixSuggestion: 'fix',
    evidenceRefs: [] as string[],
    status: 'open' as 'open' | 'fixing' | 'fixed' | 'wontfix' | 'ignored',
    assigneeId: null,
    fixedInVersionId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
  db.rows['vulnerabilities']!.push(row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────

describe('VulnService (mocked DB) — §5.5', () => {
  it('VulnService 类与 §5.5 方法导出存在', async () => {
    const fakeDb = createFakeDb();
    const libStub = { syncFromVulnerability: vi.fn() };
    const mod = await import('./vuln.service.js');
    const inst = new mod.VulnService(fakeDb as never, libStub as never);
    expect(typeof inst.get).toBe('function');
    expect(typeof inst.setStatus).toBe('function');
  });

  it('get:不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    const libStub = { syncFromVulnerability: vi.fn() };
    const mod = await import('./vuln.service.js');
    const inst = new mod.VulnService(fakeDb as never, libStub as never);
    expect(() => inst.get('v-missing')).toThrow(/vulnerability v-missing not found/);
  });

  it('get:返回完整 VulnerabilityPublic', async () => {
    const fakeDb = createFakeDb();
    seedVuln(fakeDb);
    const libStub = { syncFromVulnerability: vi.fn() };
    const mod = await import('./vuln.service.js');
    const inst = new mod.VulnService(fakeDb as never, libStub as never);
    const r = inst.get('v-1');
    expect(r.id).toBe('v-1');
    expect(r.fingerprint).toBe('fp-1');
    expect(r.filePath).toBe('A.cs');
    expect(r.severity).toBe('H');
    expect(r.libraryId).toBe('lib-1');
    expect(r.status).toBe('open');
    expect(r.cvssScore).toBe(80);
  });

  it('setStatus:open → fixing → 不调 library.sync(因为不是 closed 状态)', async () => {
    const fakeDb = createFakeDb();
    seedVuln(fakeDb, { status: 'open' });
    const libStub = { syncFromVulnerability: vi.fn() };
    const mod = await import('./vuln.service.js');
    const inst = new mod.VulnService(fakeDb as never, libStub as never);

    const r = inst.setStatus('v-1', 'fixing');
    expect(r.status).toBe('fixing');
    expect(fakeDb.rows['vulnerabilities']![0]?.['status']).toBe('fixing');
    expect(libStub.syncFromVulnerability).not.toHaveBeenCalled();
  });

  it('setStatus:→ fixed → 调 library.syncFromVulnerability(id, "fixed")', async () => {
    const fakeDb = createFakeDb();
    seedVuln(fakeDb, { status: 'open' });
    const libStub = { syncFromVulnerability: vi.fn() };
    const mod = await import('./vuln.service.js');
    const inst = new mod.VulnService(fakeDb as never, libStub as never);

    const r = inst.setStatus('v-1', 'fixed');
    expect(r.status).toBe('fixed');
    expect(libStub.syncFromVulnerability).toHaveBeenCalledWith('v-1', 'fixed');
  });

  it('setStatus:→ ignored → 调 library.syncFromVulnerability(id, "ignored")', async () => {
    const fakeDb = createFakeDb();
    seedVuln(fakeDb, { status: 'open' });
    const libStub = { syncFromVulnerability: vi.fn() };
    const mod = await import('./vuln.service.js');
    const inst = new mod.VulnService(fakeDb as never, libStub as never);

    const r = inst.setStatus('v-1', 'ignored');
    expect(r.status).toBe('ignored');
    expect(libStub.syncFromVulnerability).toHaveBeenCalledWith('v-1', 'ignored');
  });

  it('setStatus:→ wontfix → 调 library.syncFromVulnerability(id, "ignored")', async () => {
    const fakeDb = createFakeDb();
    seedVuln(fakeDb, { status: 'open' });
    const libStub = { syncFromVulnerability: vi.fn() };
    const mod = await import('./vuln.service.js');
    const inst = new mod.VulnService(fakeDb as never, libStub as never);

    const r = inst.setStatus('v-1', 'wontfix');
    expect(r.status).toBe('wontfix');
    expect(libStub.syncFromVulnerability).toHaveBeenCalledWith('v-1', 'ignored');
  });

  it('setStatus:不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    const libStub = { syncFromVulnerability: vi.fn() };
    const mod = await import('./vuln.service.js');
    const inst = new mod.VulnService(fakeDb as never, libStub as never);
    expect(() => inst.setStatus('v-missing', 'fixed')).toThrow(/vulnerability v-missing not found/);
    expect(libStub.syncFromVulnerability).not.toHaveBeenCalled();
  });
});
