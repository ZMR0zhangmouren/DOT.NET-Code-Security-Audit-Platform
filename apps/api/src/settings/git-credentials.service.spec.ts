import { describe, it, expect, vi } from 'vitest';

// 跟 auth/health spec 同套路:mock 掉 drizzle 真实 ESM(避开循环依赖)。
// 关键是:drizzle-orm 这个包是 ESM 且内部存在循环 require,在 vitest CJS
// 路径下会爆 ERR_REQUIRE_CYCLE_MODULE。这里把 drizzle-orm 整体 mock 掉,
// 让 eq/and/isNull 变成纯 stub,service 调用 fakeDb 时 fakeDb 解析 stub 来定位行。
// 同时把 schema 模块 mock 掉,不让 drizzle-orm 的真实 column builder 解析触发。
vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {} as never,
}));

vi.mock('../db/schema.js', () => {
  // 让 service 内部 `gitCredentials.id` / `gitCredentials.scope` 这样的字段访问
  // 走到 Proxy 上,Proxy 返回的 col 对象带 __table + __col,这样 mock 的 eq() 能解析。
  const makeTable = (tableName: string): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) => ({ __table: tableName, __col: prop }),
      },
    );
  return {
    gitCredentials: makeTable('git_credentials'),
    projects: makeTable('projects'),
  };
});

// drizzle-orm stub:每个 column 用 { table, col } 二元组标记,fakeDb 用它来过滤。
vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  and: (...conds: unknown[]) => ({ __and: conds }),
  isNull: (col: { __table: string; __col: string }) => ({
    __isNull: { table: col.__table, col: col.__col },
  }),
}));

interface Row {
  id: string;
  scope: 'system' | 'project';
  projectId: string | null;
  label: string;
  kind: 'ssh_key' | 'https_token';
  hostPattern: string;
  username: string | null;
  secretEnc: string;
  fingerprint: string;
  isActive: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface CondEq {
  __eq: { table: string; col: string; val: unknown };
}
interface CondIsNull {
  __isNull: { table: string; col: string };
}
interface CondAnd {
  __and: Array<CondEq | CondIsNull | unknown>;
}
type Cond = CondEq | CondIsNull | CondAnd | unknown;

function matchesCond(row: Row, cond: Cond): boolean {
  if (cond && typeof cond === 'object' && '__eq' in (cond as object)) {
    const c = (cond as CondEq).__eq;
    return (row as unknown as Record<string, unknown>)[c.col] === c.val;
  }
  if (cond && typeof cond === 'object' && '__isNull' in (cond as object)) {
    const c = (cond as CondIsNull).__isNull;
    return (row as unknown as Record<string, unknown>)[c.col] === null;
  }
  if (cond && typeof cond === 'object' && '__and' in (cond as object)) {
    return (cond as CondAnd).__and.every((c) => matchesCond(row, c));
  }
  return true;
}

// 因为 service import 时 schema 是 mock 对象,col 是 { __table, __col },需要
// 让 fakeDb 也"假装"接受 column —— 实际 service 不会传 col 给 fakeDb,只传 cond。
function createFakeDb(): {
  rows: Row[];
  select: () => {
    from: (t: unknown) => {
      where: (cond: Cond) => {
        get: () => Row | undefined;
        all: () => Row[];
      };
      get: () => Row | undefined;
      all: () => Row[];
    };
  };
  insert: () => {
    values: (v: Row) => {
      run: () => void;
    };
  };
  update: () => {
    set: (v: Partial<Row>) => {
      where: (cond: Cond) => {
        run: () => void;
      };
    };
  };
  delete: () => {
    where: (cond: Cond) => {
      run: () => { changes: number };
    };
  };
} {
  const rows: Row[] = [];
  return {
    rows,
    select: () => ({
      from: () => ({
        where: (cond) => ({
          get: () => rows.find((r) => matchesCond(r, cond)),
          all: () => rows.filter((r) => matchesCond(r, cond)),
        }),
        get: () => rows[0],
        all: () => rows,
      }),
    }),
    insert: () => ({
      values: (v: Row) => ({
        run: () => {
          rows.push(v);
        },
      }),
    }),
    update: () => ({
      set: (v: Partial<Row>) => ({
        where: (cond) => ({
          run: () => {
            const target = rows.find((r) => matchesCond(r, cond));
            if (target) Object.assign(target, v);
          },
        }),
      }),
    }),
    delete: () => ({
      where: (cond) => ({
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

describe('GitCredentialsService (mocked DB)', () => {
  it('create → list → getById → update label → revoke 全流程', async () => {
    const fakeDb = createFakeDb();
    fakeDb.rows.push({
      id: 'p1',
      scope: 'project',
      projectId: null,
      label: 'fake',
      kind: 'https_token',
      hostPattern: '*',
      username: 'u',
      secretEnc: 'x',
      fingerprint: '***',
      isActive: true,
      createdBy: 'admin',
      createdAt: 0,
      updatedAt: 0,
    });

    const mod = await import('./git-credentials.service.js');
    const svc = new mod.GitCredentialsService(fakeDb as never);

    const created = svc.create({
      scope: 'system',
      label: 'GitHub Token',
      kind: 'https_token',
      hostPattern: 'github.com',
      username: 'octocat',
      secret: 'ghp_secretvalueabcd1234',
      createdBy: 'admin',
    });
    expect(created.scope).toBe('system');
    expect(created.fingerprint).toBe('***1234'); // https_token 显示末 4 位
    expect(created.username).toBe('octocat');
    expect(created.isActive).toBe(true);

    const all = svc.list();
    expect(all).toHaveLength(2); // project fake + system token

    const fetched = svc.get(created.id);
    expect(fetched.id).toBe(created.id);

    const updated = svc.update(created.id, { label: 'GitHub Token (rotated)' });
    expect(updated.label).toBe('GitHub Token (rotated)');

    // update 不传 secret 时保持原 fingerprint
    expect(updated.fingerprint).toBe('***1234');

    svc.revoke(created.id);
    expect(svc.list()).toHaveLength(1);
  });

  it('secret 经 AES-256-GCM 落盘后能 roundtrip 解密', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-credentials.service.js');
    const svc = new mod.GitCredentialsService(fakeDb as never);

    const original = '-----BEGIN OPENSSH PRIVATE KEY-----\nfakeKey\n-----END-----';
    const created = svc.create({
      scope: 'system',
      label: 'SSH',
      kind: 'ssh_key',
      hostPattern: 'github.com',
      secret: original,
      createdBy: 'admin',
    });

    // ssh_key fingerprint 用 sha256 短摘要
    expect(created.fingerprint).toMatch(/^sha256:[0-9a-f]{16}$/);

    const decrypted = svc.getPlaintext(created.id);
    expect(decrypted).toBe(original);
  });

  it('更新 secret 时重新计算 fingerprint', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-credentials.service.js');
    const svc = new mod.GitCredentialsService(fakeDb as never);

    const created = svc.create({
      scope: 'system',
      label: 'Token',
      kind: 'https_token',
      hostPattern: 'github.com',
      username: 'me',
      secret: 'ghp_aaaaaaaa1234',
      createdBy: 'admin',
    });
    expect(created.fingerprint).toBe('***1234');

    const updated = svc.update(created.id, { secret: 'ghp_bbbbbbbb5678' });
    expect(updated.fingerprint).toBe('***5678');
  });

  it('scope=project 时 projectId 必填', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-credentials.service.js');
    const svc = new mod.GitCredentialsService(fakeDb as never);

    expect(() =>
      svc.create({
        scope: 'project',
        label: 'X',
        kind: 'https_token',
        hostPattern: 'github.com',
        username: 'me',
        secret: 's',
        createdBy: 'admin',
      }),
    ).toThrow(/projectId is required/);
  });
});
