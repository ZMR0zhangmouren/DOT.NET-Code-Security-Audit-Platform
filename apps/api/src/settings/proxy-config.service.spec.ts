import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {} as never,
}));

vi.mock('../db/schema.js', () => {
  const makeTable = (tableName: string): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) => ({ __table: tableName, __col: prop }),
      },
    );
  return {
    proxyConfigs: makeTable('proxy_configs'),
  };
});

// drizzle-orm stub:列对象是 Proxy 返回的 { __table, __col },cond 解析走 __eq。
vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
}));

interface ProxyRow {
  id: string;
  protocol: 'http' | 'https' | 'socks5' | null;
  host: string | null;
  port: number | null;
  username: string | null;
  passwordEnc: string | null;
  applyTo: 'all' | 'http_only' | 'all_outbound';
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: number;
  testStatus: 'unknown' | 'success' | 'failed';
  testMessage: string | null;
}

function createFakeDb(): {
  rows: ProxyRow[];
  select: () => {
    from: () => {
      get: () => ProxyRow | undefined;
      all: () => ProxyRow[];
    };
  };
  insert: () => {
    values: (v: ProxyRow) => {
      run: () => void;
    };
  };
  update: () => {
    set: (v: Partial<ProxyRow>) => {
      where: (cond: unknown) => {
        run: () => void;
      };
    };
  };
  delete: () => {
    where: (cond: unknown) => {
      run: () => { changes: number };
    };
  };
} {
  const rows: ProxyRow[] = [];
  return {
    rows,
    select: () => ({
      from: () => ({
        get: () => rows[0],
        all: () => rows,
      }),
    }),
    insert: () => ({
      values: (v: ProxyRow) => ({
        run: () => {
          rows.push(v);
        },
      }),
    }),
    update: () => ({
      set: (v: Partial<ProxyRow>) => ({
        where: () => ({
          run: () => {
            if (rows[0]) Object.assign(rows[0], v);
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        run: () => {
          if (rows.length === 0) return { changes: 0 };
          rows.pop();
          return { changes: 1 };
        },
      }),
    }),
  };
}

describe('ProxyConfigService (mocked DB)', () => {
  it('upsert 单条配置 → read 回来字段一致', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./proxy-config.service.js');
    const svc = new mod.ProxyConfigService(fakeDb as never);

    expect(svc.getCurrent()).toBeNull();

    const upserted = svc.upsert({
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: 'user',
      password: 'secretpw',
      applyTo: 'all_outbound',
      isActive: true,
      updatedBy: 'admin',
    });
    expect(upserted.protocol).toBe('http');
    expect(upserted.host).toBe('127.0.0.1');
    expect(upserted.port).toBe(7890);
    expect(upserted.username).toBe('user');
    expect(upserted.passwordHint).toBe('***etpw'); // 末 4 位
    expect(upserted.applyTo).toBe('all_outbound');
    expect(upserted.isActive).toBe(true);
    expect(upserted.testStatus).toBe('unknown');

    const readBack = svc.getCurrent();
    expect(readBack).not.toBeNull();
    expect(readBack?.host).toBe('127.0.0.1');
    expect(readBack?.port).toBe(7890);
  });

  it('二次 upsert 覆盖同一行(单例语义),testStatus 被重置为 unknown', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./proxy-config.service.js');
    const svc = new mod.ProxyConfigService(fakeDb as never);

    svc.upsert({
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
      applyTo: 'all_outbound',
      isActive: true,
      updatedBy: 'admin',
    });
    // 手动模拟一次探测结果
    svc.recordTestResult('success', 'connected in 10ms');
    expect(svc.getCurrent()?.testStatus).toBe('success');

    svc.upsert({
      protocol: 'http',
      host: '127.0.0.1',
      port: 8080,
      applyTo: 'http_only',
      isActive: false,
      updatedBy: 'admin2',
    });
    const after = svc.getCurrent();
    expect(after?.port).toBe(8080);
    expect(after?.applyTo).toBe('http_only');
    expect(after?.isActive).toBe(false);
    expect(after?.updatedBy).toBe('admin2');
    expect(after?.testStatus).toBe('unknown');
    expect(fakeDb.rows).toHaveLength(1);
  });

  it('直连模式(protocol=null)必须清空 host/port/username/password', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./proxy-config.service.js');
    const svc = new mod.ProxyConfigService(fakeDb as never);

    expect(() =>
      svc.upsert({
        protocol: null,
        host: '127.0.0.1',
        port: 7890,
        applyTo: 'all_outbound',
        isActive: true,
        updatedBy: 'admin',
      }),
    ).toThrow(/Direct mode/);
  });

  it('设置 protocol 但 host/port 缺失则 400', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./proxy-config.service.js');
    const svc = new mod.ProxyConfigService(fakeDb as never);

    expect(() =>
      svc.upsert({
        protocol: 'socks5',
        host: null,
        port: null,
        applyTo: 'all_outbound',
        isActive: true,
        updatedBy: 'admin',
      }),
    ).toThrow(/host and port are required/);
  });

  it('测试连通性:无配置 → failed, 直连 → success', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./proxy-config.service.js');
    const svc = new mod.ProxyConfigService(fakeDb as never);

    const empty = await svc.testConnection();
    expect(empty.ok).toBe(false);

    svc.upsert({
      protocol: null,
      host: null,
      port: null,
      applyTo: 'all_outbound',
      isActive: true,
      updatedBy: 'admin',
    });
    const direct = await svc.testConnection();
    expect(direct.ok).toBe(true);
    expect(direct.message).toContain('direct mode');
  });

  it('测试连通性:无效 host:port → failed + testStatus=failed', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./proxy-config.service.js');
    const svc = new mod.ProxyConfigService(fakeDb as never);

    svc.upsert({
      protocol: 'http',
      host: '127.0.0.1',
      port: 1, // 几乎肯定连不上(无 root 监听)
      applyTo: 'all_outbound',
      isActive: true,
      updatedBy: 'admin',
    });
    const result = await svc.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('failed to connect');
    expect(svc.getCurrent()?.testStatus).toBe('failed');
    expect(svc.getCurrent()?.testMessage).toBeTruthy();
  });
});
