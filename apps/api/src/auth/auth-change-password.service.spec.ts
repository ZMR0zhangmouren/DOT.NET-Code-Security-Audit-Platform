import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock 策略:
// - DATABASE:用 in-memory fake(同时替身 select/update 的链式 + .get/.run() 端)
// - JwtService:不需要,本测试只调 service
// - argon2:替身 hash/verify 走同步字符串比较
// - 走 fake repo 验证"调用了 update / 旧密码错时未 update"等行为
// ---------------------------------------------------------------------------

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

interface Store {
  users: Map<string, UserRow>;
  updateChanges: number;
}

function makeStore(): Store {
  return { users: new Map(), updateChanges: 0 };
}

function makeChainable(table: UserRow[]) {
  // 模拟 drizzle-orm 的 .select().from(t).where(eq(t.id, x)).get() 链式
  return {
    from: () => ({
      where: (cond: { _col: keyof UserRow; _val: unknown }) => ({
        all: () => table.filter((r) => r[cond._col] === cond._val),
        get: () => table.find((r) => r[cond._col] === cond._val),
      }),
    }),
  };
}

function makeUpdateChainable(store: Store, getChanges: () => number, _table: unknown) {
  return {
    set: (patch: Partial<UserRow>) => ({
      where: (cond: { _col: keyof UserRow; _val: unknown }) => {
        let changes = 0;
        return {
          run: () => {
            const row = Array.from(store.users.values()).find((r) => r[cond._col] === cond._val);
            if (row) {
              Object.assign(row, patch);
              changes = 1;
            }
            getChanges();
            return { changes };
          },
        };
      },
    }),
  };
}

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));

vi.mock('argon2', () => {
  // 同时给命名空间导入与 default 导入提供 hash/verify
  // 源码用 `import * as argon2 from 'argon2'`,需要顶层有这些方法
  const obj = {
    hash: async (pw: string) => `$argon2id$stub$${pw}$`,
    verify: async (hash: string, pw: string) => hash === `$argon2id$stub$${pw}$`,
    argon2id: 2,
  };
  return { ...obj, default: obj };
});

// users schema 替身 —— 暴露主键列名,db.select/where 通过 col 引用
vi.mock('../db/schema.js', () => ({
  users: {
    id: { _col: 'id' },
    username: { _col: 'username' },
  },
}));

// drizzle-orm 替身 —— 只用 eq,转成 { _col, _val }
vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ _col: col._col, _val: val }),
}));

import { AuthService } from './auth.service.js';

interface DbFake {
  select: (...args: unknown[]) => ReturnType<typeof makeChainable>;
  update: (...args: unknown[]) => ReturnType<typeof makeUpdateChainable>;
}

function buildDb(store: Store): DbFake {
  return {
    select: () => makeChainable(Array.from(store.users.values())),
    update: (table: unknown) => makeUpdateChainable(store, () => store.updateChanges++, table),
  } as unknown as DbFake;
}

describe('AuthService.changePassword (§6.2)', () => {
  let store: Store;
  let db: DbFake;
  let svc: AuthService;

  beforeEach(() => {
    store = makeStore();
    db = buildDb(store);
    svc = new AuthService(db as never, { signAsync: vi.fn(), verifyAsync: vi.fn() } as never);
    // 初始用户
    store.users.set('usr-1', {
      id: 'usr-1',
      username: 'alice',
      email: 'a@example.com',
      displayName: null,
      passwordHash: '$argon2id$stub$oldpw$',
      role: 'auditor',
      isActive: true,
      createdAt: 0,
      lastLoginAt: null,
    });
  });

  it('happy path: 旧密码正确 + 新密码强 → update 调用 + 返回 ok', async () => {
    const r = await svc.changePassword('usr-1', 'oldpw', 'NewSecret1');
    expect(r).toEqual({ ok: true });
    expect(store.updateChanges).toBe(1);
    expect(store.users.get('usr-1')?.passwordHash).toBe('$argon2id$stub$NewSecret1$');
  });

  it('旧密码错 → BadRequestException 且不 update', async () => {
    await expect(svc.changePassword('usr-1', 'wrongpw', 'NewSecret1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.updateChanges).toBe(0);
    expect(store.users.get('usr-1')?.passwordHash).toBe('$argon2id$stub$oldpw$');
  });

  it('新密码 < 8 字符 → BadRequestException 且不 update', async () => {
    await expect(svc.changePassword('usr-1', 'oldpw', 'Ab1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.updateChanges).toBe(0);
  });

  it('新密码无数字 → BadRequestException', async () => {
    await expect(svc.changePassword('usr-1', 'oldpw', 'NoDigitsXX')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.updateChanges).toBe(0);
  });

  it('新密码无字母 → BadRequestException', async () => {
    await expect(svc.changePassword('usr-1', 'oldpw', '12345678')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.updateChanges).toBe(0);
  });

  it('newPassword === oldPassword → BadRequestException', async () => {
    await expect(svc.changePassword('usr-1', 'oldpw', 'oldpw')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.updateChanges).toBe(0);
  });

  it('用户不存在 → NotFoundException', async () => {
    await expect(svc.changePassword('usr-404', 'oldpw', 'NewSecret1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(store.updateChanges).toBe(0);
  });

  it('用户已停用 → UnauthorizedException 且不 update', async () => {
    store.users.get('usr-1')!.isActive = false;
    await expect(svc.changePassword('usr-1', 'oldpw', 'NewSecret1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(store.updateChanges).toBe(0);
  });

  it('空字符串 oldPassword / newPassword → BadRequestException', async () => {
    await expect(svc.changePassword('usr-1', '', 'NewSecret1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.changePassword('usr-1', 'oldpw', '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.updateChanges).toBe(0);
  });
});
