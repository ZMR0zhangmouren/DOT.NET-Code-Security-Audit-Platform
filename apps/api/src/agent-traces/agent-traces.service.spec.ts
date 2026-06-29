import { describe, it, expect, vi } from 'vitest';

// Phase 3 §1.2/2.7 AgentTracesService 单测 —— fakeDb + fakeTable
// 验证 recordTrace / listByScanRun / getById / summarize 的字段映射与 traceIndex 排序

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
    agentTraces: makeTable('agent_traces'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  asc: (col: { __table: string; __col: string }) => ({
    __asc: { table: col.__table, col: col.__col },
  }),
  and: (...args: unknown[]) => ({ __and: args }),
}));

// ──────────────────────────────────────────────────────────────────────
// fakeDb
// ──────────────────────────────────────────────────────────────────────

interface FakeDb {
  rows: Record<string, Record<string, unknown>[]>;
  nextId: number;
  select: () => {
    from: (t: unknown) => {
      where: (cond: unknown) => {
        orderBy: (col: unknown) => {
          get: () => Record<string, unknown> | undefined;
          all: () => Record<string, unknown>[];
        };
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
}

interface CondEq {
  __eq: { table: string; col: string; val: unknown };
}
interface CondAsc {
  __asc: { table: string; col: string };
}
type Cond = CondEq | CondAsc | { __and: unknown[] } | unknown;

function matchesCond(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond || typeof cond !== 'object') return true;
  if ('__eq' in (cond as object)) {
    const c = (cond as CondEq).__eq;
    return row[c.col] === c.val;
  }
  return true;
}

function ascCol(ord: unknown): string | null {
  if (ord && typeof ord === 'object' && '__asc' in (ord as object)) {
    return (ord as CondAsc).__asc.col;
  }
  return null;
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
    nextId: 0,
    select: () => ({
      from: (t: unknown) => {
        const tableName = getTableName(t);
        if (!rows[tableName]) rows[tableName] = [];
        return {
          where: (cond: Cond) => ({
            orderBy: (ord: unknown) => {
              const col = ascCol(ord);
              const filtered = rows[tableName]!.filter((r) => matchesCond(r, cond));
              const sorted = col
                ? filtered.sort((a, b) => {
                    const av = a[col];
                    const bv = b[col];
                    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
                    return String(av ?? '').localeCompare(String(bv ?? ''));
                  })
                : filtered;
              return {
                get: () => sorted[0],
                all: () => sorted,
              };
            },
            get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
            all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
          }),
          get: () => rows[tableName]![0],
          all: () => rows[tableName]!,
        };
      },
    }),
    insert: (t: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        run: () => {
          const tableName = getTableName(t);
          if (!rows[tableName]) rows[tableName] = [];
          rows[tableName]!.push(v);
        },
      }),
    }),
  };
}

// ──────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────

describe('AgentTracesService (mocked DB) — Phase 3 §1.2/2.7', () => {
  it('AgentTracesService 类与导出存在', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./agent-traces.service.js');
    const inst = new mod.AgentTracesService(fakeDb as never);
    expect(typeof inst.recordTrace).toBe('function');
    expect(typeof inst.listByScanRun).toBe('function');
    expect(typeof inst.getById).toBe('function');
    expect(typeof inst.summarize).toBe('function');
  });

  it('recordTrace:写入一条 assistant trace,字段全映射', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./agent-traces.service.js');
    const inst = new mod.AgentTracesService(fakeDb as never);
    const r = inst.recordTrace({
      scanRunId: 'scan-1',
      traceIndex: 3,
      role: 'assistant',
      content: 'hello',
      toolCalls: [
        { id: 'tc-1', type: 'function', function: { name: 'readFile', arguments: '{}' } },
      ],
      finishReason: 'tool_calls',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      model: 'gpt-4o',
    });
    expect(r.scanRunId).toBe('scan-1');
    expect(r.traceIndex).toBe(3);
    expect(r.role).toBe('assistant');
    expect(r.content).toBe('hello');
    expect(r.toolCalls?.[0]?.['function']).toMatchObject({ name: 'readFile' });
    expect(r.promptTokens).toBe(100);
    expect(r.completionTokens).toBe(50);
    expect(r.totalTokens).toBe(150);
    expect(r.model).toBe('gpt-4o');
    expect(fakeDb.rows['agent_traces']?.length).toBe(1);
  });

  it('recordTrace → listByScanRun:多 trace 按 traceIndex 单调升序', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./agent-traces.service.js');
    const inst = new mod.AgentTracesService(fakeDb as never);
    inst.recordTrace({ scanRunId: 'scan-1', traceIndex: 5, role: 'assistant' });
    inst.recordTrace({ scanRunId: 'scan-1', traceIndex: 2, role: 'user' });
    inst.recordTrace({ scanRunId: 'scan-1', traceIndex: 8, role: 'tool' });
    inst.recordTrace({ scanRunId: 'scan-2', traceIndex: 1, role: 'user' }); // 其它 run,不应出现
    const list = inst.listByScanRun('scan-1');
    expect(list.length).toBe(3);
    expect(list.map((r) => r.traceIndex)).toEqual([2, 5, 8]);
    expect(list.every((r) => r.scanRunId === 'scan-1')).toBe(true);
  });

  it('getById:存在 → 返回;不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./agent-traces.service.js');
    const inst = new mod.AgentTracesService(fakeDb as never);
    const r = inst.recordTrace({ scanRunId: 'scan-1', traceIndex: 1, role: 'system' });
    expect(inst.getById(r.id).id).toBe(r.id);
    expect(() => inst.getById('missing')).toThrow(/agent trace missing not found/);
  });

  it('summarize:聚合 token + total + model', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./agent-traces.service.js');
    const inst = new mod.AgentTracesService(fakeDb as never);
    inst.recordTrace({
      scanRunId: 'scan-1',
      traceIndex: 1,
      role: 'system',
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1000,
      model: 'gpt-4o',
    });
    inst.recordTrace({
      scanRunId: 'scan-1',
      traceIndex: 2,
      role: 'user',
      promptTokens: 50,
      completionTokens: 0,
      totalTokens: 50,
    });
    inst.recordTrace({
      scanRunId: 'scan-1',
      traceIndex: 3,
      role: 'assistant',
      promptTokens: 0,
      completionTokens: 200,
      totalTokens: 200,
    });
    const sum = inst.summarize('scan-1');
    expect(sum.total).toBe(3);
    expect(sum.totalPromptTokens).toBe(1050);
    expect(sum.totalCompletionTokens).toBe(200);
    expect(sum.totalTokens).toBe(1250);
    expect(sum.model).toBe('gpt-4o');
  });

  it('summarize:无 trace → total=0 / token 0 / model null', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./agent-traces.service.js');
    const inst = new mod.AgentTracesService(fakeDb as never);
    const sum = inst.summarize('scan-empty');
    expect(sum.total).toBe(0);
    expect(sum.totalPromptTokens).toBe(0);
    expect(sum.totalCompletionTokens).toBe(0);
    expect(sum.totalTokens).toBe(0);
    expect(sum.model).toBeNull();
  });
});

// suppress unused import warning
void vi;
