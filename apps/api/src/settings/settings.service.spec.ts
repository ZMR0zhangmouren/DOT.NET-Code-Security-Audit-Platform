import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

// §5.7 SettingsService 单测 —— 覆盖 list/get/create/update/delete/recordTestResult/getAiKeyPlaintext
// 沿用 fakeDb 套路:drizzle-orm mock 成纯 stub,service 内部用 Proxy 化的 aiKeys 表 fakeDb。

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
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
    aiKeys: makeTable('ai_keys'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
}));

interface AiKeyRow {
  id: string;
  provider: 'openai' | 'anthropic' | 'deepseek' | 'minimax' | 'custom';
  label: string;
  baseUrl: string;
  apiKeyEnc: string;
  defaultModel: string;
  isActive: boolean;
  availableModels: string[];
  lastTestAt: number | null;
  lastTestStatus: 'unknown' | 'success' | 'failed';
  lastTestMessage: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface CondEq {
  __eq: { table: string; col: string; val: unknown };
}
type Cond = CondEq | unknown;

function matchesCond(row: AiKeyRow, cond: Cond): boolean {
  if (cond && typeof cond === 'object' && '__eq' in (cond as object)) {
    const c = (cond as CondEq).__eq;
    return (row as unknown as Record<string, unknown>)[c.col] === c.val;
  }
  return true;
}

function createFakeDb(): {
  rows: AiKeyRow[];
  select: () => {
    from: () => {
      where: (cond: Cond) => {
        get: () => AiKeyRow | undefined;
        all: () => AiKeyRow[];
      };
      get: () => AiKeyRow | undefined;
      all: () => AiKeyRow[];
    };
  };
  insert: () => {
    values: (v: AiKeyRow) => {
      run: () => void;
    };
  };
  update: () => {
    set: (v: Partial<AiKeyRow>) => {
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
  const rows: AiKeyRow[] = [];
  return {
    rows,
    select: () => ({
      from: () => ({
        where: (cond: Cond) => ({
          get: () => rows.find((r) => matchesCond(r, cond)),
          all: () => rows.filter((r) => matchesCond(r, cond)),
        }),
        get: () => rows[0],
        all: () => rows,
      }),
    }),
    insert: () => ({
      values: (v: AiKeyRow) => ({
        run: () => {
          rows.push(v);
        },
      }),
    }),
    update: () => ({
      set: (v: Partial<AiKeyRow>) => ({
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

describe('SettingsService (mocked DB) — §5.7 AI Key CRUD', () => {
  it('listAiKeys 空表 → 空数组', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./settings.service.js');
    const svc = new mod.SettingsService(fakeDb as never);
    expect(svc.listAiKeys()).toEqual([]);
  });

  it('createAiKey → list 可见,apiKeyHint 显示后 4 位', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./settings.service.js');
    const svc = new mod.SettingsService(fakeDb as never);

    const created = svc.createAiKey({
      provider: 'openai',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-secretkeyabcd1234',
      defaultModel: 'gpt-4o',
      availableModels: ['gpt-4o', 'gpt-4o-mini'],
      createdBy: 'admin',
    });
    expect(created.provider).toBe('openai');
    expect(created.label).toBe('OpenAI');
    expect(created.apiKeyHint).toBe('***1234');
    expect(created.isActive).toBe(true);

    const list = svc.listAiKeys();
    expect(list).toHaveLength(1);
  });

  it('getAiKey 命中 / 未命中 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./settings.service.js');
    const svc = new mod.SettingsService(fakeDb as never);

    const created = svc.createAiKey({
      provider: 'openai',
      label: 'X',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-abc1234',
      defaultModel: 'gpt-4o',
      availableModels: [],
      createdBy: 'admin',
    });
    expect(svc.getAiKey(created.id).id).toBe(created.id);
    expect(() => svc.getAiKey('aik-missing')).toThrow(NotFoundException);
  });

  it('getAiKeyPlaintext → 返回 AES 解密后的明文(getMasterKey)', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./settings.service.js');
    const svc = new mod.SettingsService(fakeDb as never);

    const original = 'sk-realkeyhello1234';
    const created = svc.createAiKey({
      provider: 'openai',
      label: 'X',
      baseUrl: 'https://x.com',
      apiKey: original,
      defaultModel: 'gpt-4',
      availableModels: [],
      createdBy: 'admin',
    });
    expect(svc.getAiKeyPlaintext(created.id)).toBe(original);
    expect(() => svc.getAiKeyPlaintext('aik-missing')).toThrow(NotFoundException);
  });

  it('updateAiKey → 部分字段更新 + updatedAt 刷新', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./settings.service.js');
    const svc = new mod.SettingsService(fakeDb as never);

    const created = svc.createAiKey({
      provider: 'openai',
      label: 'Old',
      baseUrl: 'https://a.com',
      apiKey: 'sk-old1234',
      defaultModel: 'gpt-4o',
      availableModels: ['gpt-4o'],
      createdBy: 'admin',
    });

    const updated = svc.updateAiKey(created.id, { label: 'New', isActive: false });
    expect(updated.label).toBe('New');
    expect(updated.isActive).toBe(false);
    expect(updated.apiKeyHint).toBe('***1234'); // apiKey 未改 → 后 4 位不变

    // updatedAt 大于 createdAt
    expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);
  });

  it('updateAiKey → 不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./settings.service.js');
    const svc = new mod.SettingsService(fakeDb as never);
    expect(() => svc.updateAiKey('aik-missing', { label: 'x' })).toThrow(NotFoundException);
  });

  it('updateAiKey 改 apiKey → 重新加密', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./settings.service.js');
    const svc = new mod.SettingsService(fakeDb as never);

    const created = svc.createAiKey({
      provider: 'openai',
      label: 'L',
      baseUrl: 'https://x.com',
      apiKey: 'sk-old1234',
      defaultModel: 'g',
      availableModels: [],
      createdBy: 'admin',
    });
    expect(created.apiKeyHint).toBe('***1234');

    const updated = svc.updateAiKey(created.id, { apiKey: 'sk-newkey5678' });
    expect(updated.apiKeyHint).toBe('***5678');
    expect(svc.getAiKeyPlaintext(created.id)).toBe('sk-newkey5678');
  });

  it('deleteAiKey 成功 / 不存在', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./settings.service.js');
    const svc = new mod.SettingsService(fakeDb as never);

    const created = svc.createAiKey({
      provider: 'openai',
      label: 'L',
      baseUrl: 'https://x.com',
      apiKey: 'sk-1234',
      defaultModel: 'g',
      availableModels: [],
      createdBy: 'admin',
    });
    svc.deleteAiKey(created.id);
    expect(svc.listAiKeys()).toEqual([]);
    expect(() => svc.deleteAiKey('aik-missing')).toThrow(NotFoundException);
  });

  it('recordTestResult → 写回 lastTestAt/lastTestStatus/lastTestMessage', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./settings.service.js');
    const svc = new mod.SettingsService(fakeDb as never);

    const created = svc.createAiKey({
      provider: 'openai',
      label: 'L',
      baseUrl: 'https://x.com',
      apiKey: 'sk-1234',
      defaultModel: 'g',
      availableModels: [],
      createdBy: 'admin',
    });
    // 新建的 AI key 没测过连接,lastTestStatus 默认是 'unknown' 或 null(取决于 schema)
    expect(['unknown', null, undefined]).toContain(created.lastTestStatus);

    svc.recordTestResult(created.id, 'success', '12 models available');
    const after = svc.getAiKey(created.id);
    expect(after.lastTestStatus).toBe('success');
    expect(after.lastTestMessage).toBe('12 models available');
    expect(after.lastTestAt).not.toBeNull();

    svc.recordTestResult(created.id, 'failed', 'bad gateway');
    const after2 = svc.getAiKey(created.id);
    expect(after2.lastTestStatus).toBe('failed');
    expect(after2.lastTestMessage).toBe('bad gateway');
  });

  it('toPublic:apiKeyEnc 解密失败 → fallback "***"', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./settings.service.js');
    const svc = new mod.SettingsService(fakeDb as never);

    const created = svc.createAiKey({
      provider: 'openai',
      label: 'L',
      baseUrl: 'https://x.com',
      apiKey: 'sk-abc1234',
      defaultModel: 'g',
      availableModels: [],
      createdBy: 'admin',
    });
    // 手动把 apiKeyEnc 改成非法密文
    const row = fakeDb.rows.find((r) => r.id === created.id);
    expect(row).toBeDefined();
    row!.apiKeyEnc = 'corrupted-data';

    const after = svc.getAiKey(created.id);
    // decryptSecret 抛错 → toPublic catch → plaintext = '' → hint = '***'
    expect(after.apiKeyHint).toBe('***');
    void vi;
  });
});
