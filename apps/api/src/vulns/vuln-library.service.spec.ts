import { describe, it, expect, vi } from 'vitest';

// §5.5 VulnLibraryService 单测 —— fakeDb 路线

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
    vulnLibraryEntries: makeTable('vuln_library_entries'),
    vulnerabilities: makeTable('vulnerabilities'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  and: (...conds: unknown[]) => ({ __and: conds }),
  asc: (col: { __table: string; __col: string }) => ({
    __asc: { table: col.__table, col: col.__col },
  }),
  desc: (col: { __table: string; __col: string }) => ({
    __desc: { table: col.__table, col: col.__col },
  }),
  inArray: (col: { __table: string; __col: string }, vals: unknown[]) => ({
    __in: { table: col.__table, col: col.__col, vals },
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
      orderBy: (...orders: unknown[]) => {
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
            orderBy: (..._orders: unknown[]) => ({
              all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
              get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
            }),
            get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
            all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
          }),
          orderBy: (..._orders: unknown[]) => ({
            all: () => rows[tableName]!,
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

function seedLib(db: FakeDb, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  db.rows['vuln_library_entries'] = db.rows['vuln_library_entries'] ?? [];
  const row = {
    id: 'lib-1',
    projectId: 'prj-1',
    fingerprint: 'fp-1',
    vulnType: 'sql',
    severityMax: 'H' as 'C' | 'H' | 'M' | 'L',
    status: 'open' as 'open' | 'fixing' | 'fixed' | 'wontfix' | 'ignored' | 'suppressed',
    title: 'SQL injection',
    description: null,
    tags: [] as string[],
    occurrenceCount: 1,
    firstSeenAt: 1_700_000_000_000,
    firstSeenVersionId: 'cv-1',
    lastSeenAt: 1_700_000_000_000,
    lastSeenVersionId: 'cv-1',
    fixedInVersionId: null,
    fixedAt: null,
    assigneeId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
  db.rows['vuln_library_entries']!.push(row);
  return row;
}

function seedVuln(
  db: FakeDb,
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  db.rows['vulnerabilities'] = db.rows['vulnerabilities'] ?? [];
  const row = {
    id: `v-${Math.random()}`,
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
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
  db.rows['vulnerabilities']!.push(row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────

describe('VulnLibraryService (mocked DB) — §5.5', () => {
  it('VulnLibraryService 类与 §5.5 方法导出存在', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    expect(typeof inst.list).toBe('function');
    expect(typeof inst.getWithTimeline).toBe('function');
    expect(typeof inst.setStatus).toBe('function');
    expect(typeof inst.syncFromVulnerability).toBe('function');
  });

  it('list:按 projectId 过滤,返回 VulnLibraryPublic 数组', async () => {
    const fakeDb = createFakeDb();
    seedLib(fakeDb, { id: 'lib-1', severityMax: 'H' });
    seedLib(fakeDb, { id: 'lib-2', severityMax: 'L', fingerprint: 'fp-2' });
    seedLib(fakeDb, {
      id: 'lib-other',
      projectId: 'prj-OTHER',
      fingerprint: 'fp-3',
    });

    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    const list = inst.list('prj-1');
    expect(list).toHaveLength(2);
    expect(list.map((l) => l.id).sort()).toEqual(['lib-1', 'lib-2']);
  });

  it('getWithTimeline:拿 root + 关联 vulnerabilities 时间线', async () => {
    const fakeDb = createFakeDb();
    seedLib(fakeDb, { id: 'lib-1' });
    seedVuln(fakeDb, { id: 'v-1', libraryId: 'lib-1', fingerprint: 'fp-1' });
    seedVuln(fakeDb, { id: 'v-2', libraryId: 'lib-1', fingerprint: 'fp-1' });
    seedVuln(fakeDb, { id: 'v-other', libraryId: 'lib-2', fingerprint: 'fp-2' });

    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    const result = inst.getWithTimeline('lib-1');
    expect(result.id).toBe('lib-1');
    expect(result.timeline).toHaveLength(2);
    expect(result.timeline.map((t) => t.vulnerabilityId).sort()).toEqual(['v-1', 'v-2']);
  });

  it('getWithTimeline:不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    expect(() => inst.getWithTimeline('lib-missing')).toThrow(
      /library entry lib-missing not found/,
    );
  });

  it('setStatus:open → fixing', async () => {
    const fakeDb = createFakeDb();
    seedLib(fakeDb, { status: 'open' });
    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    const r = inst.setStatus('lib-1', 'fixing');
    expect(r.status).toBe('fixing');
    expect(fakeDb.rows['vuln_library_entries']![0]?.['status']).toBe('fixing');
  });

  it('setStatus:open → fixed 同时设置 fixedAt', async () => {
    const fakeDb = createFakeDb();
    seedLib(fakeDb, { status: 'open', fixedAt: null });
    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    const r = inst.setStatus('lib-1', 'fixed');
    expect(r.status).toBe('fixed');
    expect(r.fixedAt).not.toBeNull();
  });

  it('setStatus:open → ignored', async () => {
    const fakeDb = createFakeDb();
    seedLib(fakeDb, { status: 'open' });
    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    const r = inst.setStatus('lib-1', 'ignored');
    expect(r.status).toBe('ignored');
  });

  it('syncFromVulnerability:全部 fixed → library = fixed', async () => {
    const fakeDb = createFakeDb();
    seedLib(fakeDb, { status: 'open' });
    seedVuln(fakeDb, { id: 'v-1', libraryId: 'lib-1', status: 'fixed' });
    seedVuln(fakeDb, { id: 'v-2', libraryId: 'lib-1', status: 'wontfix' });

    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    inst.syncFromVulnerability('v-1', 'fixed');
    expect(fakeDb.rows['vuln_library_entries']![0]?.['status']).toBe('fixed');
  });

  it('syncFromVulnerability:全部 closed (fixed/wontfix/ignored) → library = ignored', async () => {
    const fakeDb = createFakeDb();
    seedLib(fakeDb, { status: 'open' });
    seedVuln(fakeDb, { id: 'v-1', libraryId: 'lib-1', status: 'fixed' });
    seedVuln(fakeDb, { id: 'v-2', libraryId: 'lib-1', status: 'ignored' });

    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    inst.syncFromVulnerability('v-1', 'fixed');
    // allFixed=false(有 ignored),allClosed=true → libStatus='ignored'
    expect(fakeDb.rows['vuln_library_entries']![0]?.['status']).toBe('ignored');
  });

  it('syncFromVulnerability:有 fixing → library = fixing', async () => {
    const fakeDb = createFakeDb();
    seedLib(fakeDb, { status: 'open' });
    seedVuln(fakeDb, { id: 'v-1', libraryId: 'lib-1', status: 'open' });
    seedVuln(fakeDb, { id: 'v-2', libraryId: 'lib-1', status: 'fixing' });

    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    inst.syncFromVulnerability('v-1', 'fixed');
    expect(fakeDb.rows['vuln_library_entries']![0]?.['status']).toBe('fixing');
  });

  it('syncFromVulnerability:mixed (open + fixed + ignored) → library = open', async () => {
    const fakeDb = createFakeDb();
    seedLib(fakeDb, { status: 'fixing' });
    seedVuln(fakeDb, { id: 'v-1', libraryId: 'lib-1', status: 'open' });
    seedVuln(fakeDb, { id: 'v-2', libraryId: 'lib-1', status: 'fixed' });
    seedVuln(fakeDb, { id: 'v-3', libraryId: 'lib-1', status: 'ignored' });

    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    inst.syncFromVulnerability('v-2', 'fixed');
    // allFixed=false, allClosed=false, no fixing → libStatus='open'
    expect(fakeDb.rows['vuln_library_entries']![0]?.['status']).toBe('open');
  });

  it('syncFromVulnerability:vuln 不存在 → 不报错,library 状态不变', async () => {
    const fakeDb = createFakeDb();
    seedLib(fakeDb, { status: 'open' });
    const mod = await import('./vuln-library.service.js');
    const inst = new mod.VulnLibraryService(fakeDb as never);
    inst.syncFromVulnerability('v-missing', 'fixed');
    expect(fakeDb.rows['vuln_library_entries']![0]?.['status']).toBe('open');
  });
});

void vi;
