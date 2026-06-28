import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

// §4.2.7 UsersService 单测 —— list / get / getWithHash / getByUsernameWithHash /
// create / update / updatePassword

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));

vi.mock('argon2', () => {
  const obj = {
    hash: async (pw: string) => `$argon2id$stub$${pw}$`,
    verify: async (hash: string, pw: string) => hash === `$argon2id$stub$${pw}$`,
    argon2id: 2,
  };
  return { ...obj, default: obj };
});

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
    users: makeTable('users'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  desc: (col: { __table: string; __col: string }) => ({
    __desc: { table: col.__table, col: col.__col },
  }),
}));

interface UserRow {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  role: 'admin' | 'auditor' | 'developer' | 'viewer';
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

interface CondEq {
  __eq: { table: string; col: string; val: unknown };
}
type Cond = CondEq | unknown;

function matchesCond(row: UserRow, cond: Cond): boolean {
  if (cond && typeof cond === 'object' && '__eq' in (cond as object)) {
    const c = (cond as CondEq).__eq;
    return (row as unknown as Record<string, unknown>)[c.col] === c.val;
  }
  return true;
}

function createFakeDb(): {
  rows: UserRow[];
  select: () => {
    from: () => {
      where: (cond: Cond) => {
        get: () => UserRow | undefined;
        all: () => UserRow[];
      };
      orderBy: (ord: unknown) => {
        all: () => UserRow[];
      };
      get: () => UserRow | undefined;
      all: () => UserRow[];
    };
  };
  insert: () => {
    values: (v: UserRow) => {
      run: () => void;
    };
  };
  update: () => {
    set: (v: Partial<UserRow>) => {
      where: (cond: Cond) => {
        run: () => { changes: number };
      };
    };
  };
} {
  const rows: UserRow[] = [];
  return {
    rows,
    select: () => ({
      from: () => {
        const chain = {
          where: (cond: Cond) => ({
            get: () => rows.find((r) => matchesCond(r, cond)),
            all: () => rows.filter((r) => matchesCond(r, cond)),
          }),
          get: () => rows[0],
          all: () => rows,
        };
        return new Proxy(chain, {
          get(target, prop: string) {
            if (prop === 'orderBy') {
              return (_ord: unknown) => ({
                all: () => rows,
              });
            }
            return (target as Record<string, unknown>)[prop];
          },
        });
      },
    }),
    insert: () => ({
      values: (v: UserRow) => ({
        run: () => {
          rows.push(v);
        },
      }),
    }),
    update: () => ({
      set: (v: Partial<UserRow>) => ({
        where: (cond: Cond) => ({
          run: () => {
            const target = rows.find((r) => matchesCond(r, cond));
            if (target) {
              Object.assign(target, v);
              return { changes: 1 };
            }
            return { changes: 0 };
          },
        }),
      }),
    }),
  };
}

describe('UsersService (mocked DB) — §4.2.7', () => {
  it('list → 空表 → []', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./users.service.js');
    const svc = new mod.UsersService(fakeDb as never);
    expect(svc.list()).toEqual([]);
  });

  it('list → 返回按 createdAt DESC 排序的公开字段(无 passwordHash)', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'usr-1',
      username: 'alice',
      email: 'a@x.com',
      displayName: 'Alice',
      passwordHash: '$argon2id$stub$pw$',
      role: 'admin',
      isActive: true,
      createdAt: 1_000,
      lastLoginAt: null,
    });
    const mod = await import('./users.service.js');
    const svc = new mod.UsersService(fakeDb as never);
    const list = svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('usr-1');
    expect((list[0]! as Record<string, unknown>)['passwordHash']).toBeUndefined();
  });

  it('get 命中 / 未命中', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'usr-1',
      username: 'alice',
      email: 'a@x.com',
      displayName: null,
      passwordHash: 'x',
      role: 'auditor',
      isActive: true,
      createdAt: 0,
      lastLoginAt: null,
    });
    const mod = await import('./users.service.js');
    const svc = new mod.UsersService(fakeDb as never);
    expect(svc.get('usr-1').id).toBe('usr-1');
    expect(() => svc.get('usr-missing')).toThrow(NotFoundException);
  });

  it('getWithHash → 返回带 passwordHash 的 row(内部 helper)', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'usr-1',
      username: 'alice',
      email: 'a@x.com',
      displayName: null,
      passwordHash: 'secret-hash',
      role: 'admin',
      isActive: true,
      createdAt: 0,
      lastLoginAt: null,
    });
    const mod = await import('./users.service.js');
    const svc = new mod.UsersService(fakeDb as never);
    const row = svc.getWithHash('usr-1');
    expect(row?.passwordHash).toBe('secret-hash');
    expect(svc.getWithHash('usr-missing')).toBeUndefined();
  });

  it('getByUsernameWithHash → 按 username 查找', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'usr-1',
      username: 'alice',
      email: 'a@x.com',
      displayName: null,
      passwordHash: 'secret-hash',
      role: 'admin',
      isActive: true,
      createdAt: 0,
      lastLoginAt: null,
    });
    const mod = await import('./users.service.js');
    const svc = new mod.UsersService(fakeDb as never);
    expect(svc.getByUsernameWithHash('alice')?.id).toBe('usr-1');
    expect(svc.getByUsernameWithHash('ghost')).toBeUndefined();
  });

  it('create → 写入 passwordHash(走 argon2id)', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./users.service.js');
    const svc = new mod.UsersService(fakeDb as never);
    const u = await svc.create({
      username: 'newuser',
      email: 'new@x.com',
      password: 'NewPassword1',
      displayName: 'New',
      role: 'developer',
    });
    expect(u.username).toBe('newuser');
    expect(u.role).toBe('developer');
    expect(u.isActive).toBe(true);
    expect(fakeDb.rows).toHaveLength(1);
    expect(fakeDb.rows[0]!.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('create → username 已存在 → NotFoundException(命名怪但保持产品代码行为)', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'usr-1',
      username: 'alice',
      email: 'a@x.com',
      displayName: null,
      passwordHash: 'x',
      role: 'admin',
      isActive: true,
      createdAt: 0,
      lastLoginAt: null,
    });
    const mod = await import('./users.service.js');
    const svc = new mod.UsersService(fakeDb as never);
    await expect(
      svc.create({
        username: 'alice',
        email: 'a2@x.com',
        password: 'NewPass1',
        role: 'viewer',
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('update → 部分字段更新', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'usr-1',
      username: 'alice',
      email: 'a@x.com',
      displayName: null,
      passwordHash: 'x',
      role: 'viewer',
      isActive: true,
      createdAt: 0,
      lastLoginAt: null,
    });
    const mod = await import('./users.service.js');
    const svc = new mod.UsersService(fakeDb as never);
    const updated = svc.update('usr-1', {
      role: 'admin',
      displayName: 'Alice Admin',
      isActive: false,
    });
    expect(updated.role).toBe('admin');
    expect(updated.displayName).toBe('Alice Admin');
    expect(updated.isActive).toBe(false);
  });

  it('updatePassword → 写新 hash,changes=0 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'usr-1',
      username: 'alice',
      email: 'a@x.com',
      displayName: null,
      passwordHash: '$argon2id$stub$old$',
      role: 'admin',
      isActive: true,
      createdAt: 0,
      lastLoginAt: null,
    });
    const mod = await import('./users.service.js');
    const svc = new mod.UsersService(fakeDb as never);
    await svc.updatePassword('usr-1', 'NewPass1');
    expect(fakeDb.rows[0]!.passwordHash).toBe('$argon2id$stub$NewPass1$');

    await expect(svc.updatePassword('usr-missing', 'NewPass1')).rejects.toThrow(NotFoundException);
  });

  void vi;
});
