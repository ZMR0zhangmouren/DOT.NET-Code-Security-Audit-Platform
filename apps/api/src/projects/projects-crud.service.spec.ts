import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

// §5.1 / §4.2.8 ProjectsService CRUD 部分 —— 已有 projects.service.spec.ts 覆盖 members;
// 这里补 list / get / create / update / remove 主表 CRUD + 多种 filter 路径。

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
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
    users: makeTable('users'),
    projectMembers: makeTable('project_members'),
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
  like: (col: { __table: string; __col: string }, val: unknown) => ({
    __like: { table: col.__table, col: col.__col, val },
  }),
  or: (...conds: unknown[]) => ({ __or: conds }),
}));

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  visibility: 'public' | 'private';
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
}

interface Cond {
  __eq?: { col: string; val: unknown };
  __and?: unknown[];
  __or?: unknown[];
  __like?: { col: string; val: unknown };
}

function matchesCond(row: ProjectRow, cond: unknown): boolean {
  if (!cond || typeof cond !== 'object') return true;
  const c = cond as Cond;
  if (c.__eq) {
    // source 用 eq(col, col) 当 "no filter" 占位(where = projects.id === projects.id)
    if (c.__eq.val && typeof c.__eq.val === 'object' && '__col' in (c.__eq.val as object)) {
      return true;
    }
    return (row as unknown as Record<string, unknown>)[c.__eq.col] === c.__eq.val;
  }
  if (c.__and) return c.__and.every((sub) => matchesCond(row, sub));
  if (c.__or) return c.__or.some((sub) => matchesCond(row, sub));
  if (c.__like)
    return String((row as unknown as Record<string, unknown>)[c.__like.col] ?? '').includes(
      String(c.__like.val).replace(/%/g, ''),
    );
  return true;
}

function createFakeDb(): {
  rows: ProjectRow[];
  select: () => {
    from: () => {
      where: (cond: Cond) => {
        get: () => ProjectRow | undefined;
        all: () => ProjectRow[];
        orderBy: (ord: unknown) => { all: () => ProjectRow[] };
      };
      get: () => ProjectRow | undefined;
      all: () => ProjectRow[];
      orderBy: (ord: unknown) => { all: () => ProjectRow[] };
    };
  };
  insert: () => { values: (v: ProjectRow) => { run: () => void } };
  update: () => { set: (v: Partial<ProjectRow>) => { where: (cond: Cond) => { run: () => void } } };
  delete: () => { where: (cond: Cond) => { run: () => { changes: number } } };
} {
  const rows: ProjectRow[] = [];
  return {
    rows,
    select: () => ({
      from: () => {
        const whereResult = (cond: Cond) => ({
          get: () => rows.find((r) => matchesCond(r, cond)),
          all: () => rows.filter((r) => matchesCond(r, cond)),
          orderBy: (_ord: unknown) => ({
            all: () => rows.filter((r) => matchesCond(r, cond)),
          }),
        });
        const chain = {
          where: whereResult,
          get: () => rows[0],
          all: () => rows,
          orderBy: (_ord: unknown) => ({ all: () => rows }),
          innerJoin: (_joinTable: unknown, _joinCond: unknown) => ({
            where: whereResult,
            orderBy: (_ord: unknown) => ({ all: () => rows }),
            all: () => rows,
          }),
        };
        return new Proxy(chain, {
          get(target, prop: string) {
            return (target as Record<string, unknown>)[prop];
          },
        });
      },
    }),
    insert: () => ({
      values: (v: ProjectRow) => ({
        run: () => {
          rows.push(v);
        },
      }),
    }),
    update: () => ({
      set: (v: Partial<ProjectRow>) => ({
        where: (cond: Cond) => ({
          run: () => {
            const target = rows.find((r) => matchesCond(r, cond));
            if (target) Object.assign(target, v);
          },
        }),
      }),
    }),
    delete: () => ({
      where: (cond: Cond) => ({
        run: () => {
          const idx = rows.findIndex((r) => matchesCond(r, cond));
          if (idx === -1) return { changes: 0 };
          rows.splice(idx, 1);
          return { changes: 1 };
        },
      }),
    }),
  };
}

describe('ProjectsService (mocked DB) — §5.1 CRUD', () => {
  it('list 空表 → []', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./projects.service.js');
    const svc = new mod.ProjectsService(fakeDb as never);
    expect(svc.list()).toEqual([]);
  });

  it('list → 单条命中', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'prj-1',
      name: 'Test',
      description: null,
      ownerId: 'usr-1',
      visibility: 'private',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    const mod = await import('./projects.service.js');
    const svc = new mod.ProjectsService(fakeDb as never);
    const list = svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('prj-1');
  });

  it('list → q 模糊匹配 name/description', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'p1',
      name: 'audit-platform',
      description: null,
      ownerId: 'u1',
      visibility: 'private',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    fakeDb.rows.push({
      id: 'p2',
      name: 'other',
      description: 'audit',
      ownerId: 'u1',
      visibility: 'private',
      status: 'active',
      createdAt: 2,
      updatedAt: 2,
    });
    fakeDb.rows.push({
      id: 'p3',
      name: 'noise',
      description: null,
      ownerId: 'u1',
      visibility: 'private',
      status: 'active',
      createdAt: 3,
      updatedAt: 3,
    });
    const mod = await import('./projects.service.js');
    const svc = new mod.ProjectsService(fakeDb as never);
    const result = svc.list({ q: 'audit' });
    expect(result.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
  });

  it('list → status filter', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'p1',
      name: 'A',
      description: null,
      ownerId: 'u',
      visibility: 'private',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    fakeDb.rows.push({
      id: 'p2',
      name: 'B',
      description: null,
      ownerId: 'u',
      visibility: 'private',
      status: 'archived',
      createdAt: 2,
      updatedAt: 2,
    });
    const mod = await import('./projects.service.js');
    const svc = new mod.ProjectsService(fakeDb as never);
    const result = svc.list({ status: 'archived' });
    expect(result.map((r) => r.id)).toEqual(['p2']);
  });

  it('get 命中 / 未命中', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'p1',
      name: 'A',
      description: null,
      ownerId: 'u',
      visibility: 'private',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    const mod = await import('./projects.service.js');
    const svc = new mod.ProjectsService(fakeDb as never);
    expect(svc.get('p1').id).toBe('p1');
    expect(() => svc.get('p-missing')).toThrow(NotFoundException);
  });

  it('create → 默认 visibility=private, status=active', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./projects.service.js');
    const svc = new mod.ProjectsService(fakeDb as never);
    const p = svc.create({ name: 'New', ownerId: 'u-1', description: 'desc' });
    expect(p.name).toBe('New');
    expect(p.description).toBe('desc');
    expect(p.visibility).toBe('private');
    expect(p.status).toBe('active');
    expect(p.id).toMatch(/^prj-/);
  });

  it('update → 部分字段更新', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'p1',
      name: 'A',
      description: null,
      ownerId: 'u',
      visibility: 'private',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    const mod = await import('./projects.service.js');
    const svc = new mod.ProjectsService(fakeDb as never);
    const updated = svc.update('p1', { name: 'B', status: 'archived' });
    expect(updated.name).toBe('B');
    expect(updated.status).toBe('archived');
  });

  it('update → 不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./projects.service.js');
    const svc = new mod.ProjectsService(fakeDb as never);
    expect(() => svc.update('p-missing', { name: 'X' })).toThrow(NotFoundException);
  });

  it('remove → 成功 / 不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'p1',
      name: 'A',
      description: null,
      ownerId: 'u',
      visibility: 'private',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    const mod = await import('./projects.service.js');
    const svc = new mod.ProjectsService(fakeDb as never);
    svc.remove('p1');
    expect(fakeDb.rows).toHaveLength(0);
    expect(() => svc.remove('p-missing')).toThrow(NotFoundException);
  });

  void vi;
});
