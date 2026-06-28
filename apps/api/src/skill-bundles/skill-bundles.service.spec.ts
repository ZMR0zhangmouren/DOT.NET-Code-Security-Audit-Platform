import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillBundlesService } from './skill-bundles.service.js';

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
    skillBundleVersions: makeTable('skill_bundle_versions'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  desc: (col: { __table: string; __col: string }) => ({
    __desc: { table: col.__table, col: col.__col },
  }),
  sql: (strings: TemplateStringsArray) => ({ __raw: strings.join('') }),
}));

// ──────────────────────────────────────────────────────────────────────
// fakeDb —— 同 scan.service.spec 风格(Proxy + 内存表)
// ──────────────────────────────────────────────────────────────────────

interface FakeDb {
  rows: Record<string, Record<string, unknown>[]>;
  select: () => {
    from: (t: unknown) => {
      where: (cond: unknown) => {
        orderBy: (...args: unknown[]) => {
          get: () => Record<string, unknown> | undefined;
          all: () => Record<string, unknown>[];
        };
        get: () => Record<string, unknown> | undefined;
        all: () => Record<string, unknown>[];
      };
      orderBy: (...args: unknown[]) => {
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
      run: () => void;
    };
  };
  transaction: (fn: (tx: FakeDb) => void) => void;
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
    select: (_cols?: unknown) => ({
      from: (t: unknown) => {
        const tableName = getTableName(t);
        if (!rows[tableName]) rows[tableName] = [];
        return {
          where: (cond: Cond) => ({
            orderBy: (..._args: unknown[]) => ({
              get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
              all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
            }),
            get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
            all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
          }),
          orderBy: (..._args: unknown[]) => ({
            get: () => rows[tableName]![0],
            all: () => rows[tableName]!,
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
        run: () => {
          const tableName = getTableName(t);
          for (const r of rows[tableName]!) Object.assign(r, v);
        },
      }),
    }),
    transaction: (fn: (tx: FakeDb) => void) => {
      // 简单 mock:在 transaction 内共用同一份 rows 引用(满足原子性行为)
      const tx: FakeDb = createFakeDb();
      // 把 tx 的 rows 引用换成外层 rows(模拟"同一事务"语义)
      tx.rows = rows;
      tx.update = (t: unknown) => ({
        set: (v: Record<string, unknown>) => ({
          where: (cond: Cond) => ({
            run: () => {
              const tableName = getTableName(t);
              const target = rows[tableName]!.find((r) => matchesCond(r, cond));
              if (target) Object.assign(target, v);
            },
          }),
          run: () => {
            const tableName = getTableName(t);
            for (const r of rows[tableName]!) Object.assign(r, v);
          },
        }),
      });
      fn(tx);
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// seed helpers
// ──────────────────────────────────────────────────────────────────────

function seed(db: FakeDb, bundles: Array<Record<string, unknown>>): void {
  db.rows['skill_bundle_versions'] = bundles.map((b) => ({ ...b }));
}

const FIXTURE_BASE = {
  gitCommit: 'abc123',
  snapshotPath: '/tmp/bundle',
  note: null,
  createdAt: 1_000_000,
};

// ──────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────

describe('SkillBundlesService (mocked DB)', () => {
  let fakeDb: FakeDb;
  let svc: SkillBundlesService;

  beforeEach(async () => {
    fakeDb = createFakeDb();
    const mod = await import('./skill-bundles.service.js');
    svc = new mod.SkillBundlesService(fakeDb as never);
  });

  it('listAll:空表 → 空数组', () => {
    seed(fakeDb, []);
    expect(svc.listAll()).toEqual([]);
  });

  it('listAll:多 bundle → 全部返回,带 isDefault 字段', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: false, ...FIXTURE_BASE },
      { id: 'sb-b', version: 'v2', isActive: true, isDefault: true, ...FIXTURE_BASE },
    ]);
    const all = svc.listAll();
    expect(all).toHaveLength(2);
    expect(all.every((b) => 'isDefault' in b)).toBe(true);
    expect(all.every((b) => 'publishedAt' in b)).toBe(true);
  });

  it('listActive:is_active=false 的被过滤', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: false, ...FIXTURE_BASE },
      { id: 'sb-b', version: 'v2', isActive: false, isDefault: false, ...FIXTURE_BASE },
    ]);
    const active = svc.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe('sb-a');
  });

  it('list({activeOnly:true}) → 等价 listActive', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: false, ...FIXTURE_BASE },
      { id: 'sb-b', version: 'v2', isActive: false, isDefault: false, ...FIXTURE_BASE },
    ]);
    expect(svc.list({ activeOnly: true })).toHaveLength(1);
  });

  it('list({activeOnly:false}) → 等价 listAll', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: false, ...FIXTURE_BASE },
      { id: 'sb-b', version: 'v2', isActive: false, isDefault: false, ...FIXTURE_BASE },
    ]);
    expect(svc.list({ activeOnly: false })).toHaveLength(2);
  });

  it('getById:存在 → 返回对象', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: false, ...FIXTURE_BASE },
    ]);
    const found = svc.getById('sb-a');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('sb-a');
    expect(found!.isDefault).toBe(false);
  });

  it('getById:不存在 → null', () => {
    seed(fakeDb, []);
    expect(svc.getById('sb-missing')).toBeNull();
  });

  it('get / getById:兼容老接口', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: false, ...FIXTURE_BASE },
    ]);
    expect(svc.get('sb-a')?.id).toBe('sb-a');
  });

  it('getDefault:有 isDefault=true → 返回', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: false, ...FIXTURE_BASE },
      { id: 'sb-b', version: 'v2', isActive: true, isDefault: true, ...FIXTURE_BASE },
    ]);
    const def = svc.getDefault();
    expect(def?.id).toBe('sb-b');
  });

  it('getDefault:无 isDefault=true → null', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: false, ...FIXTURE_BASE },
    ]);
    expect(svc.getDefault()).toBeNull();
  });

  it('setDefault:存在 → 返回,DB 标 is_default=true', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: false, ...FIXTURE_BASE },
      { id: 'sb-b', version: 'v2', isActive: true, isDefault: false, ...FIXTURE_BASE },
    ]);
    const after = svc.setDefault('sb-a');
    expect(after.id).toBe('sb-a');
    expect(after.isDefault).toBe(true);
    expect(fakeDb.rows['skill_bundle_versions']![0]!['isDefault']).toBe(true);
  });

  it('setDefault:不存在 → NotFoundException', () => {
    seed(fakeDb, []);
    expect(() => svc.setDefault('sb-missing')).toThrow(/skillBundle sb-missing not found/);
  });

  it('setDefault:原子性 —— 其他 is_default 全清掉', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: false, ...FIXTURE_BASE },
      { id: 'sb-b', version: 'v2', isActive: true, isDefault: true, ...FIXTURE_BASE },
      { id: 'sb-c', version: 'v3', isActive: true, isDefault: false, ...FIXTURE_BASE },
    ]);
    // 当前默认是 sb-b,切到 sb-c
    svc.setDefault('sb-c');
    const rows = fakeDb.rows['skill_bundle_versions']!;
    expect(rows.find((r) => r['id'] === 'sb-a')!['isDefault']).toBe(false);
    expect(rows.find((r) => r['id'] === 'sb-b')!['isDefault']).toBe(false);
    expect(rows.find((r) => r['id'] === 'sb-c')!['isDefault']).toBe(true);
    // 全表只有 1 个 isDefault=true
    const defaults = rows.filter((r) => r['isDefault'] === true);
    expect(defaults).toHaveLength(1);
  });

  it('setDefault:重复 setDefault 同一个 id → 仍只有 1 个默认', () => {
    seed(fakeDb, [
      { id: 'sb-a', version: 'v1', isActive: true, isDefault: true, ...FIXTURE_BASE },
      { id: 'sb-b', version: 'v2', isActive: true, isDefault: false, ...FIXTURE_BASE },
    ]);
    svc.setDefault('sb-a');
    svc.setDefault('sb-a');
    const rows = fakeDb.rows['skill_bundle_versions']!;
    const defaults = rows.filter((r) => r['isDefault'] === true);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!['id']).toBe('sb-a');
  });

  it('publish:存在 → 标 is_active=true + published_at 有值', () => {
    seed(fakeDb, [
      {
        ...FIXTURE_BASE,
        id: 'sb-a',
        version: 'v1',
        isActive: false,
        isDefault: false,
        publishedAt: null,
      },
    ]);
    const before = Date.now();
    const after = svc.publish('sb-a', 'first publish');
    const afterTs = after.publishedAt ?? 0;
    expect(after.isActive).toBe(true);
    expect(after.publishedAt).not.toBeNull();
    expect(afterTs).toBeGreaterThanOrEqual(before);
    expect(afterTs).toBeLessThanOrEqual(Date.now());
    expect(after.note).toBe('first publish');
  });

  it('publish:不存在 → NotFoundException', () => {
    seed(fakeDb, []);
    expect(() => svc.publish('sb-missing')).toThrow(/skillBundle sb-missing not found/);
  });

  it('publish:不传 note → 保留原 note', () => {
    seed(fakeDb, [
      {
        ...FIXTURE_BASE,
        id: 'sb-a',
        version: 'v1',
        isActive: false,
        isDefault: false,
        publishedAt: null,
        note: 'old note',
      },
    ]);
    const after = svc.publish('sb-a');
    expect(after.note).toBe('old note');
  });

  it('publish:不动 is_default(避免 publish 自动改默认)', () => {
    seed(fakeDb, [
      {
        ...FIXTURE_BASE,
        id: 'sb-a',
        version: 'v1',
        isActive: false,
        isDefault: false,
        publishedAt: null,
      },
    ]);
    svc.publish('sb-a');
    expect(fakeDb.rows['skill_bundle_versions']![0]!['isDefault']).toBe(false);
  });
});
