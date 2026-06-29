import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

// §4.2.6 + §5.3 tools/code-tools.service.ts 单测(扩展)—— 覆盖 readFile / searchCode / recordVulnerability
// readFile 和 searchCode 走真 fs(用 mkdtempSync 在 tmp),recordVulnerability 走 fake db

vi.mock('../../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));

vi.mock('../../db/schema.js', () => {
  const makeTable = (tableName: string): Record<string, unknown> => {
    const tbl: Record<string, unknown> = {};
    Object.defineProperty(tbl, '__tableName', { value: tableName, enumerable: true });
    return new Proxy(tbl, {
      get: (target, prop: string) => {
        if (prop === '__tableName') return (target as Record<string, unknown>)['__tableName'];
        return { __table: tableName, __col: prop };
      },
    });
  };
  return {
    scanRuns: makeTable('scan_runs'),
    vulnerabilities: makeTable('vulnerabilities'),
    vulnLibraryEntries: makeTable('vuln_library_entries'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  and: (...conds: unknown[]) => ({ __and: conds }),
}));

describe('CodeFileSystem.readFile (§5.3)', () => {
  it('读小文件 → 返回完整内容', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-tools-read-'));
    const fp = join(dir, 'a.txt');
    writeFileSync(fp, 'hello world', 'utf8');

    const { CodeFileSystem } = await import('./code-tools.service.js');
    const fs = new CodeFileSystem(dir, {} as never);
    const out = await fs.readFile('a.txt');
    expect(out).toBe('hello world');
    rmSync(dir, { recursive: true, force: true });
  });

  it('读大文件(>100KB)→ 截断 + [truncated] 后缀', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-tools-read-'));
    const fp = join(dir, 'big.txt');
    const big = 'x'.repeat(200 * 1024);
    writeFileSync(fp, big, 'utf8');

    const { CodeFileSystem } = await import('./code-tools.service.js');
    const fs = new CodeFileSystem(dir, {} as never);
    const out = await fs.readFile('big.txt');
    expect(out).toContain('[truncated]');
    expect(out.length).toBeLessThan(big.length);
    rmSync(dir, { recursive: true, force: true });
  });

  it('越界路径 → throw escapes sandbox', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-tools-read-'));
    const { CodeFileSystem } = await import('./code-tools.service.js');
    const fs = new CodeFileSystem(dir, {} as never);
    await expect(fs.readFile('../../../etc/passwd')).rejects.toThrow(/escapes sandbox/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('CodeFileSystem.searchCode (§5.3) — 返回结构', () => {
  it('hits 数组:rg 命中或无命中都返回合法形状', async () => {
    // 不强制命中数量(rg/walk 路径都覆盖,不强依赖哪条)
    // 只验证返回数组 + 元素形状 + 不抛错
    const dir = mkdtempSync(join(tmpdir(), 'code-tools-search-'));
    writeFileSync(join(dir, 'a.cs'), 'class A {}\n', 'utf8');
    const { CodeFileSystem } = await import('./code-tools.service.js');
    const fs = new CodeFileSystem(dir, {} as never);
    const hits = await fs.searchCode('class A', '**/*.cs');
    expect(Array.isArray(hits)).toBe(true);
    for (const h of hits) {
      expect(h).toHaveProperty('file');
      expect(h).toHaveProperty('line');
      expect(h).toHaveProperty('text');
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('不传 fileGlob → 不报错,正常返回', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-tools-search-'));
    writeFileSync(join(dir, 'a.cs'), 'class A {}\n', 'utf8');
    const { CodeFileSystem } = await import('./code-tools.service.js');
    const fs = new CodeFileSystem(dir, {} as never);
    const hits = await fs.searchCode('class A');
    expect(Array.isArray(hits)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('无匹配 pattern → 返回 []', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-tools-search-'));
    writeFileSync(join(dir, 'a.cs'), 'class A {}\n', 'utf8');
    const { CodeFileSystem } = await import('./code-tools.service.js');
    const fs = new CodeFileSystem(dir, {} as never);
    const hits = await fs.searchCode('__no_match_pattern_zzz_xxx__');
    expect(hits).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('CodeFileSystem.recordVulnerability (§5.5)', () => {
  interface VleRow {
    id: string;
    projectId: string;
    vulnType: string;
    fingerprint: string;
    severityMax: 'C' | 'H' | 'M' | 'L';
    occurrenceCount: number;
  }
  interface FakeDb {
    runs: { id: string; projectId: string; codeVersionId: string }[];
    vles: VleRow[];
    vulns: { id: string; libraryId: string }[];
    select: () => {
      from: (t: unknown) => {
        where: (c: { __eq?: { col: string; val: unknown }; __and?: unknown[] }) => {
          get: () => unknown;
        };
      };
    };
    insert: (target: { __table: string }) => {
      values: (v: Record<string, unknown>) => { run: () => void };
    };
    update: (target: { __table: string }) => {
      set: (v: Record<string, unknown>) => {
        where: (c: { __eq?: { col: string; val: unknown } }) => { run: () => void };
      };
    };
  }

  function makeDb(): FakeDb {
    const db: FakeDb = {
      runs: [],
      vles: [],
      vulns: [],
      select: () => ({
        from: () => ({
          where: () => ({ get: () => undefined }),
        }),
      }),
      insert: () => ({
        values: () => ({ run: () => {} }),
      }),
      update: () => ({
        set: () => ({ where: () => ({ run: () => {} }) }),
      }),
    };
    db.select = () => ({
      from: (t: { __tableName?: string }) => ({
        where: (c: {
          __eq?: { col: string; val: unknown };
          __and?: Array<{ __eq?: { col: string; val: unknown } }>;
        }) => ({
          get: () => {
            const table = t.__tableName;
            const matchesRow = (r: Record<string, unknown>): boolean => {
              if (c.__eq) return r[c.__eq.col] === c.__eq.val;
              if (c.__and)
                return c.__and.every((sub) => {
                  if (sub.__eq) return r[sub.__eq.col] === sub.__eq.val;
                  return true;
                });
              return true;
            };
            if (table === 'scan_runs')
              return db.runs.find((r) => matchesRow(r as unknown as Record<string, unknown>));
            if (table === 'vuln_library_entries')
              return db.vles.find((r) => matchesRow(r as unknown as Record<string, unknown>));
            return undefined;
          },
        }),
      }),
    });
    db.insert = (t: { __tableName?: string }) => ({
      values: (v: Record<string, unknown>) => ({
        run: () => {
          if (t.__tableName === 'vuln_library_entries') {
            db.vles.push(v as unknown as VleRow);
          } else if (t.__tableName === 'vulnerabilities') {
            db.vulns.push({ id: String(v['id']), libraryId: String(v['libraryId']) });
          }
        },
      }),
    });
    db.update = (t: { __tableName?: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: (c: { __eq?: { col: string; val: unknown } }) => ({
          run: () => {
            if (t.__tableName === 'vuln_library_entries') {
              const target = db.vles.find(
                (r) => r[(c.__eq?.col ?? 'id') as keyof typeof r] === c.__eq?.val,
              );
              if (target) Object.assign(target, v);
            }
          },
        }),
      }),
    });
    return db;
  }

  it('scanRun 不存在 → throw', async () => {
    const db = makeDb();
    const { CodeFileSystem } = await import('./code-tools.service.js');
    const fs = new CodeFileSystem('/tmp/sb', db as never);
    await expect(
      fs.recordVulnerability('scan-no-such', {
        vulnType: 'sqli',
        severity: 'H',
        title: 't',
        filePath: 'a.cs',
        lineStart: 1,
        lineEnd: 2,
        codeSnippet: 'x',
        fixSuggestion: 'fix',
      }),
    ).rejects.toThrow(/scanRun .* not found/);
  });

  it('新发现 → 插 VulnLibraryEntry + Vulnerability', async () => {
    const db = makeDb();
    db.runs.push({ id: 's1', projectId: 'p1', codeVersionId: 'cv-1' });
    const { CodeFileSystem } = await import('./code-tools.service.js');
    const fs = new CodeFileSystem('/tmp/sb', db as never);
    const r = await fs.recordVulnerability('s1', {
      vulnType: 'sqli',
      severity: 'H',
      title: 'SQL Injection',
      filePath: 'UserController.cs',
      lineStart: 10,
      lineEnd: 12,
      codeSnippet: 'var x = "SELECT * FROM users WHERE id = " + id;',
      fixSuggestion: 'use parameterized query',
      evidenceRefs: ['POINT_AUTH_001'],
    });
    expect(r.vulnId).toMatch(/^vul-/);
    expect(r.libraryId).toMatch(/^vle-/);
    expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(db.vles).toHaveLength(1);
    expect(db.vulns).toHaveLength(1);
    expect(db.vulns[0]?.libraryId).toBe(r.libraryId);
  });

  it('已存在 library entry → 更新 occurrenceCount / severityMax, 不插新 entry', async () => {
    const db = makeDb();
    db.runs.push({ id: 's1', projectId: 'p1', codeVersionId: 'cv-1' });
    const { CodeFileSystem, computeFingerprint } = await import('./code-tools.service.js');
    const fs = new CodeFileSystem('/tmp/sb', db as never);
    // 预填一个低 severity 的 library entry
    const fp = computeFingerprint(
      'UserController.cs',
      'sqli',
      'var x = "SELECT * FROM users WHERE id = " + id;',
    );
    db.vles.push({
      id: 'vle-existing',
      projectId: 'p1',
      vulnType: 'sqli',
      fingerprint: fp,
      severityMax: 'L',
      occurrenceCount: 1,
    });
    const r = await fs.recordVulnerability('s1', {
      vulnType: 'sqli',
      severity: 'C', // 严重度更高
      title: 't',
      filePath: 'UserController.cs',
      lineStart: 1,
      lineEnd: 2,
      codeSnippet: 'var x = "SELECT * FROM users WHERE id = " + id;',
      fixSuggestion: 'fix',
    });
    expect(r.libraryId).toBe('vle-existing');
    expect(db.vles).toHaveLength(1); // 没新增
    expect(db.vles[0]?.occurrenceCount).toBe(2);
    expect(db.vles[0]?.severityMax).toBe('C');
  });

  it('severityMax: 已存在 severity 更高 → 保持原值', async () => {
    const db = makeDb();
    db.runs.push({ id: 's1', projectId: 'p1', codeVersionId: 'cv-1' });
    const { CodeFileSystem, computeFingerprint } = await import('./code-tools.service.js');
    const fs = new CodeFileSystem('/tmp/sb', db as never);
    const fp = computeFingerprint('a.cs', 'sqli', 'x');
    db.vles.push({
      id: 'vle-1',
      projectId: 'p1',
      vulnType: 'sqli',
      fingerprint: fp,
      severityMax: 'C',
      occurrenceCount: 5,
    });
    await fs.recordVulnerability('s1', {
      vulnType: 'sqli',
      severity: 'L', // 低于已有
      title: 't',
      filePath: 'a.cs',
      lineStart: 1,
      lineEnd: 1,
      codeSnippet: 'x',
      fixSuggestion: 'f',
    });
    expect(db.vles[0]?.severityMax).toBe('C'); // 保持 C
    expect(db.vles[0]?.occurrenceCount).toBe(6);
  });

  void vi;
});
