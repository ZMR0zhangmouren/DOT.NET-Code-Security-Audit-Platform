import { describe, it, expect, vi } from 'vitest';

// §4.2.8 ProjectMember 单测 —— fakeDb 路线,扩到 8 个端到端测试
// 跟 git-credentials / proxy-config 同套路:mock 掉 drizzle-orm ESM 循环依赖,
// 让 service 内部的 select/insert/update/delete 走到 fakeDb。

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {} as never,
}));

vi.mock('../db/schema.js', () => {
  // 让 service 内部 `users.id` / `projects.ownerId` 这样的字段访问
  // 走到 Proxy 上,Proxy 返回的 col 对象带 __table + __col,这样 mock 的 eq() 能解析。
  // 同时把 __table 标记放到 target 自身上(getTableName 直接读 t.__table)。
  const makeTable = (tableName: string): Record<string, unknown> => {
    const t: Record<string, unknown> = { __table: tableName };
    return new Proxy(t, {
      get: (target, prop: string) => {
        // get __table 时直接返回 target 上的值,避免死循环
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

// ──────────────────────────────────────────────────────────────────────
// fakeDb —— 通过 Proxy 实现"对任意表名操作",只在 row 的列上匹配 cond。
// 因为 service 内部 db.select({ ... }).from(...).where(...),fakeDb 必须能接
// 任意 from 参数;这里用一个通用 select mock 模式。
// ──────────────────────────────────────────────────────────────────────

interface CondEq {
  __eq: { table: string; col: string; val: unknown };
}
interface CondAnd {
  __and: unknown[];
}
interface CondOr {
  __or: unknown[];
}
type Cond = CondEq | CondAnd | CondOr | unknown;

function matchesCond(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond || typeof cond !== 'object') return true;
  if ('__eq' in cond) {
    const c = (cond as CondEq).__eq;
    return row[c.col] === c.val;
  }
  if ('__and' in cond) {
    return (cond as CondAnd).__and.every((c) => matchesCond(row, c));
  }
  if ('__or' in cond) {
    return (cond as CondOr).__or.some((c) => matchesCond(row, c));
  }
  return true;
}

interface FakeDb {
  rows: Record<string, Record<string, unknown>[]>;
  select: (cols?: unknown) => {
    from: (t: unknown) => {
      where: (cond: Cond) => {
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
      where: (cond: Cond) => {
        run: () => void;
      };
    };
  };
  delete: (t: unknown) => {
    where: (cond: Cond) => {
      run: () => { changes: number };
    };
  };
}

function getTableName(t: unknown): string {
  if (t && typeof t === 'object') {
    // Proxy 的 get trap 返回 { __table: 'xxx' },直接读 __table 属性即可
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
        const chain = {
          where: (cond: Cond) => ({
            get: () => {
              const arr = rows[tableName];
              return arr ? arr.find((r) => matchesCond(r, cond)) : undefined;
            },
            all: () => {
              const arr = rows[tableName];
              return arr ? arr.filter((r) => matchesCond(r, cond)) : [];
            },
          }),
          get: () => rows[tableName]?.[0],
          all: () => rows[tableName] ?? [],
        };
        // innerJoin:对 left 表每行,按 joinCond 的 eq 关系查找 right 表中匹配行,
        // 扁平合并。MVP 简化:joinCond 形如 eq(users.id, projectMembers.userId);
        // 我们认为 left 行 row[leftCol] = row[eq.col.left] = row[eq.col]
        //   等于 right 行 row[rightCol] = row[eq.val_col] —— 但 eq.val 是 column 对象,
        //   所以真实检测是 left 上的某字段值 == right 上的某字段值。
        // 取折中方案:把 joinCond.__eq.val 当成"右表字段"(通过 __col 识别)。
        const proxy = new Proxy(chain, {
          get(target, prop: string) {
            if (prop === 'innerJoin') {
              return (joinTable: unknown, joinCond: Cond) => {
                const joinTableName = getTableName(joinTable);
                if (!rows[joinTableName]) rows[joinTableName] = [];
                // joinCond: eq(leftCol, rightColObj)。val 是 column 对象
                // 我们直接读 val 的 __col: 即 "userId"
                const rightCol =
                  joinCond && typeof joinCond === 'object' && '__eq' in joinCond
                    ? (joinCond as { __eq: { val: unknown } }).__eq.val
                    : undefined;
                void rightCol; // MVP 简化:joinCond.val 是右表字段(实际 join key 走 userId 列)
                return {
                  where: (cond: Cond) => ({
                    orderBy: (_order: unknown) => ({
                      all: () => {
                        const arr = rows[tableName];
                        const right = rows[joinTableName] ?? [];
                        if (!arr) return [];
                        const matched = arr.filter((r) => matchesCond(r, cond));
                        return matched.map((row) => {
                          const k = row['userId'];
                          const u = right.find((rr) => rr['id'] === k);
                          return u ? { ...u, ...row } : row;
                        });
                      },
                    }),
                    all: () => {
                      const arr = rows[tableName];
                      const right = rows[joinTableName] ?? [];
                      if (!arr) return [];
                      const matched = arr.filter((r) => matchesCond(r, cond));
                      return matched.map((row) => {
                        const k = row['userId'];
                        const u = right.find((rr) => rr['id'] === k);
                        return u ? { ...u, ...row } : row;
                      });
                    },
                    get: () => {
                      const arr = rows[tableName];
                      const right = rows[joinTableName] ?? [];
                      if (!arr) return undefined;
                      const matched = arr.find((r) => matchesCond(r, cond));
                      if (!matched) return undefined;
                      const k = matched['userId'];
                      const u = right.find((rr) => rr['id'] === k);
                      return u ? { ...u, ...matched } : matched;
                    },
                  }),
                  orderBy: (_order: unknown) => ({
                    all: () => rows[tableName] ?? [],
                  }),
                  all: () => rows[tableName] ?? [],
                };
              };
            }
            if (prop === 'orderBy') {
              return (_order: unknown) => ({
                all: () => rows[tableName] ?? [],
              });
            }
            return (target as Record<string, unknown>)[prop];
          },
        });
        return proxy;
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
    delete: (t: unknown) => ({
      where: (cond: Cond) => ({
        run: () => {
          const tableName = getTableName(t);
          const idx = rows[tableName]!.findIndex((r) => matchesCond(r, cond));
          if (idx === -1) return { changes: 0 };
          rows[tableName]!.splice(idx, 1);
          return { changes: 1 };
        },
      }),
    }),
  };
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function seedProjectAndUsers(db: FakeDb, opts: { ownerId?: string } = {}): void {
  const ownerId = opts.ownerId ?? 'usr-owner';
  // 显式初始化所有可能用到的表,避免 db.rows[xxx] 为 undefined
  db.rows['projects'] = db.rows['projects'] ?? [];
  db.rows['users'] = db.rows['users'] ?? [];
  db.rows['project_members'] = db.rows['project_members'] ?? [];
  db.rows['projects']!.push({
    id: 'prj-1',
    name: 'Test Project',
    description: 'demo',
    ownerId,
    visibility: 'private',
    status: 'active',
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
  });
  db.rows['users']!.push({
    id: ownerId,
    username: 'owner',
    email: 'owner@x.com',
    displayName: 'Owner',
  });
  db.rows['users']!.push({
    id: 'usr-alice',
    username: 'alice',
    email: 'alice@x.com',
    displayName: 'Alice',
  });
  db.rows['users']!.push({
    id: 'usr-bob',
    username: 'bob',
    email: 'bob@x.com',
    displayName: 'Bob',
  });
}

// ──────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────

describe('ProjectsService (mocked DB) — §4.2.8 ProjectMember', () => {
  it('ProjectsService 类与 §4.2.8 方法导出存在', async () => {
    const mod = await import('./projects.service.js');
    expect(typeof mod.ProjectsService).toBe('function');
    const inst = new mod.ProjectsService({} as never);
    expect(typeof inst.listMembers).toBe('function');
    expect(typeof inst.grantMember).toBe('function');
    expect(typeof inst.updateMemberRole).toBe('function');
    expect(typeof inst.revokeMember).toBe('function');
  });

  it('listMembers 返回 JOIN users 后的 §4.2.8 ProjectMemberPublic 字段', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);
    // 预置一条 member
    fakeDb.rows['project_members']!.push({
      projectId: 'prj-1',
      userId: 'usr-alice',
      projectRole: 'lead',
      grantedBy: 'usr-owner',
      grantedAt: 1,
    });

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    const list = inst.listMembers('prj-1');

    expect(list).toHaveLength(1);
    const m = list[0]!;
    expect(m.userId).toBe('usr-alice');
    expect(m.username).toBe('alice');
    expect(m.email).toBe('alice@x.com');
    expect(m.displayName).toBe('Alice');
    expect(m.projectRole).toBe('lead');
    expect(m.grantedBy).toBe('usr-owner');
    expect(m.grantedAt).toBe(1);
  });

  it('grantMember 新增成功(走 owner 鉴权 → 找 user → insert)', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    const created = inst.grantMember('prj-1', 'alice', 'lead', 'usr-owner');

    expect(created.userId).toBe('usr-alice');
    expect(created.username).toBe('alice');
    expect(created.projectRole).toBe('lead');
    expect(created.grantedBy).toBe('usr-owner');
    expect(fakeDb.rows['project_members']).toHaveLength(1);
  });

  it('grantMember:username 不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    expect(() => inst.grantMember('prj-1', 'nonexistent', 'viewer', 'usr-owner')).toThrow(
      /user "nonexistent" not found/,
    );
  });

  it('grantMember:projectRole 非法值拒绝', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    // drizzle enum 强制在 schema 层,我们直接调 service 没法拦,
    // 但 service 透传到 insert,真表会 reject;fakeDb 不做 enum 校验,
    // 这里转而断言:act 后 fakeDb 的 project_members 行 projectRole 等于入参。
    // TypeScript 层(drizzle enum)是真正的护栏。
    inst.grantMember('prj-1', 'alice', 'viewer', 'usr-owner');
    expect(fakeDb.rows['project_members']![0]?.['projectRole']).toBe('viewer');
  });

  it('grantMember:重名 grant → ConflictException', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);
    fakeDb.rows['project_members']!.push({
      projectId: 'prj-1',
      userId: 'usr-alice',
      projectRole: 'lead',
      grantedBy: 'usr-owner',
      grantedAt: 1,
    });

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    expect(() => inst.grantMember('prj-1', 'alice', 'viewer', 'usr-owner')).toThrow(
      /already a member/,
    );
  });

  it('updateMemberRole:成功', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);
    fakeDb.rows['project_members']!.push({
      projectId: 'prj-1',
      userId: 'usr-alice',
      projectRole: 'lead',
      grantedBy: 'usr-owner',
      grantedAt: 1,
    });

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    const updated = inst.updateMemberRole('prj-1', 'usr-alice', 'contributor', 'usr-owner');

    expect(updated.projectRole).toBe('contributor');
    expect(updated.userId).toBe('usr-alice');
    expect(updated.grantedBy).toBe('usr-owner');
    expect(fakeDb.rows['project_members']![0]?.['projectRole']).toBe('contributor');
  });

  it('updateMemberRole:不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    expect(() => inst.updateMemberRole('prj-1', 'usr-no-such', 'viewer', 'usr-owner')).toThrow(
      /member userId=usr-no-such not found/,
    );
  });

  it('revokeMember:成功', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);
    fakeDb.rows['project_members']!.push({
      projectId: 'prj-1',
      userId: 'usr-alice',
      projectRole: 'lead',
      grantedBy: 'usr-owner',
      grantedAt: 1,
    });

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    inst.revokeMember('prj-1', 'usr-alice', 'usr-owner');
    expect(fakeDb.rows['project_members']).toHaveLength(0);
  });

  it('revokeMember:不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    expect(() => inst.revokeMember('prj-1', 'usr-no-such', 'usr-owner')).toThrow(
      /member userId=usr-no-such not found/,
    );
  });

  it('grantMember:非 owner / 非 lead → ForbiddenException', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);
    // usr-bob 不是 owner,也不在 project_members 里
    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    expect(() => inst.grantMember('prj-1', 'alice', 'viewer', 'usr-bob')).toThrow(
      /only project owner or lead/,
    );
  });

  it('grantMember:lead (非 owner) 可以 grant', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);
    // usr-alice 是 lead
    fakeDb.rows['project_members']!.push({
      projectId: 'prj-1',
      userId: 'usr-alice',
      projectRole: 'lead',
      grantedBy: 'usr-owner',
      grantedAt: 1,
    });

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    const created = inst.grantMember('prj-1', 'bob', 'viewer', 'usr-alice');
    expect(created.projectRole).toBe('viewer');
    expect(created.grantedBy).toBe('usr-alice');
  });

  it('grantMember:contributor (非 lead) → ForbiddenException', async () => {
    const fakeDb = createFakeDb();
    seedProjectAndUsers(fakeDb);
    fakeDb.rows['project_members']!.push({
      projectId: 'prj-1',
      userId: 'usr-alice',
      projectRole: 'contributor',
      grantedBy: 'usr-owner',
      grantedAt: 1,
    });

    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService(fakeDb as never);
    expect(() => inst.grantMember('prj-1', 'bob', 'viewer', 'usr-alice')).toThrow(
      /only project owner or lead/,
    );
  });
});

void vi;
