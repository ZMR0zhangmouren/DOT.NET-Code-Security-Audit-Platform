import { UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// 覆盖 §6.2 登录 + §6.2 getMe 流程:
// - DATABASE:用 in-memory fake(同时替身 select/update/insert 的链式 + .get/.run() 端)
// - JwtService:stub signAsync / verifyAsync,断言 payload 形态
// - argon2:替身 hash/verify 走同步字符串比较
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
  insertChanges: number;
}

function makeStore(): Store {
  return { users: new Map(), updateChanges: 0, insertChanges: 0 };
}

function makeSelectChainable(table: UserRow[]) {
  return {
    from: () => ({
      where: (cond: { _col: keyof UserRow; _val: unknown }) => ({
        all: () => table.filter((r) => r[cond._col] === cond._val),
        get: () => table.find((r) => r[cond._col] === cond._val),
      }),
    }),
  };
}

function makeUpdateChainable(store: Store) {
  return {
    set: (patch: Partial<UserRow>) => ({
      where: (cond: { _col: keyof UserRow; _val: unknown }) => {
        return {
          run: () => {
            const row = Array.from(store.users.values()).find((r) => r[cond._col] === cond._val);
            if (row) {
              Object.assign(row, patch);
              store.updateChanges += 1;
              return { changes: 1 };
            }
            return { changes: 0 };
          },
        };
      },
    }),
  };
}

function makeInsertChainable(store: Store) {
  return {
    values: (_v: Record<string, unknown>) => ({
      run: () => {
        store.insertChanges += 1;
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
  const obj = {
    hash: async (pw: string) => `$argon2id$stub$${pw}$`,
    verify: async (hash: string, pw: string) => hash === `$argon2id$stub$${pw}$`,
    argon2id: 2,
  };
  return { ...obj, default: obj };
});

vi.mock('../db/schema.js', () => ({
  users: {
    id: { _col: 'id' },
    username: { _col: 'username' },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ _col: col._col, _val: val }),
}));

interface DbFake {
  select: (...args: unknown[]) => ReturnType<typeof makeSelectChainable>;
  update: (...args: unknown[]) => ReturnType<typeof makeUpdateChainable>;
  insert: (...args: unknown[]) => ReturnType<typeof makeInsertChainable>;
}

function buildDb(store: Store): DbFake {
  return {
    select: () => makeSelectChainable(Array.from(store.users.values())),
    update: () => makeUpdateChainable(store),
    insert: () => makeInsertChainable(store),
  } as unknown as DbFake;
}

import { AuthService } from './auth.service.js';

interface JwtStub {
  signAsync: ReturnType<typeof vi.fn>;
  verifyAsync: ReturnType<typeof vi.fn>;
}

function makeJwtStub(): JwtStub {
  return {
    signAsync: vi.fn(async (payload: Record<string, unknown>) => {
      return `jwt.${JSON.stringify(payload)}`;
    }),
    verifyAsync: vi.fn(async (token: string) => {
      // 简易解析:支持 happy + 抛错
      if (!token.startsWith('jwt.')) throw new Error('malformed');
      if (token === 'jwt.EXPIRED') throw new Error('jwt expired');
      const payload = JSON.parse(token.slice(4));
      return payload;
    }),
  };
}

describe('AuthService (mock smoke + login + getMe)', () => {
  it('hashPassword 走 argon2id 算法(MVP 锁定)', async () => {
    const mod = await import('./auth.service.js');
    const h = await mod.AuthService.hashPassword('topsecret');
    expect(h).toMatch(/^\$argon2id\$/);
  });
});

describe('AuthService.login (§6.2)', () => {
  let store: Store;
  let db: DbFake;
  let jwt: JwtStub;
  let svc: AuthService;

  beforeEach(() => {
    store = makeStore();
    db = buildDb(store);
    jwt = makeJwtStub();
    svc = new AuthService(db as never, jwt as never);
    store.users.set('usr-1', {
      id: 'usr-1',
      username: 'alice',
      email: 'a@example.com',
      displayName: 'Alice',
      passwordHash: '$argon2id$stub$pw123$',
      role: 'admin',
      isActive: true,
      createdAt: 0,
      lastLoginAt: null,
    });
  });

  it('happy path: 正确密码 → 返回 accessToken + user(无 passwordHash)', async () => {
    const r = await svc.login('alice', 'pw123');
    expect(r.accessToken).toMatch(/^jwt\./);
    expect(r.user.id).toBe('usr-1');
    expect(r.user.username).toBe('alice');
    expect(r.user.role).toBe('admin');
    // 不应泄露 passwordHash
    expect((r.user as Record<string, unknown>)['passwordHash']).toBeUndefined();

    // jwt payload 包含 sub / username / role(Q15/Q17 锁定的 4 角色枚举)
    const signCall = jwt.signAsync.mock.calls[0]!;
    expect(signCall[0]).toEqual({ sub: 'usr-1', username: 'alice', role: 'admin' });
    expect(signCall[1]).toEqual({ expiresIn: '15m' });
  });

  it('happy path: 更新 lastLoginAt(走 update chain)', async () => {
    await svc.login('alice', 'pw123');
    expect(store.updateChanges).toBe(1);
    const u = store.users.get('usr-1')!;
    expect(u.lastLoginAt).toBeGreaterThan(0);
  });

  it('用户不存在 → UnauthorizedException(不暴露是否存在)', async () => {
    await expect(svc.login('ghost', 'pw123')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('密码错 → UnauthorizedException', async () => {
    await expect(svc.login('alice', 'WRONG')).rejects.toBeInstanceOf(UnauthorizedException);
    // 失败不应更新 lastLoginAt
    expect(store.updateChanges).toBe(0);
  });

  it('用户已停用(isActive=false) → UnauthorizedException', async () => {
    store.users.get('usr-1')!.isActive = false;
    await expect(svc.login('alice', 'pw123')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifyToken: happy → 返回 payload', async () => {
    const p = await svc.verifyToken('jwt.{"sub":"usr-1","role":"admin"}');
    expect(p).toEqual({ sub: 'usr-1', role: 'admin' });
  });

  it('verifyToken: malformed → null(不抛)', async () => {
    const p = await svc.verifyToken('garbage');
    expect(p).toBeNull();
  });

  it('verifyToken: expired → null(不抛,给 controller 转 401)', async () => {
    const p = await svc.verifyToken('jwt.EXPIRED');
    expect(p).toBeNull();
  });
});

describe('AuthService.getMe (§6.2 /auth/me)', () => {
  let store: Store;
  let db: DbFake;
  let jwt: JwtStub;
  let svc: AuthService;

  beforeEach(() => {
    store = makeStore();
    db = buildDb(store);
    jwt = makeJwtStub();
    svc = new AuthService(db as never, jwt as never);
    store.users.set('usr-1', {
      id: 'usr-1',
      username: 'alice',
      email: 'a@example.com',
      displayName: 'Alice',
      passwordHash: '$argon2id$stub$pw123$',
      role: 'auditor',
      isActive: true,
      createdAt: 0,
      lastLoginAt: null,
    });
  });

  it('getMe: 已知 userId → 返回 AuthedUser(无 passwordHash)', async () => {
    const me = await svc.getMe('usr-1');
    expect(me).not.toBeNull();
    expect(me!.id).toBe('usr-1');
    expect(me!.username).toBe('alice');
    expect(me!.email).toBe('a@example.com');
    expect(me!.role).toBe('auditor');
    expect((me as Record<string, unknown>)['passwordHash']).toBeUndefined();
  });

  it('getMe: 未知 userId → null(让 controller 转 404)', async () => {
    const me = await svc.getMe('usr-no-such');
    expect(me).toBeNull();
  });
});
