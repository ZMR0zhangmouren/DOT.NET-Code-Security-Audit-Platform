import { describe, it, expect, vi } from 'vitest';

// §4.2.6 + §5.3 tools/code-tools.service.ts 单测:
// - computeFingerprint:相同输入 → 相同 hash
// - normalizeSnippet / normalizeFilePath:纯函数
// - SandboxPath.resolve:合法 → 返回 abs;越界 → throw
// - SandboxPath.toRelative:转回 sandbox 相对路径
// - CodeFileSystem 类只测不依赖 fs 的方法(resolveSafety / guard)

vi.mock('../../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({
  eq: () => ({ __eq: true }),
  and: () => ({ __and: true }),
}));

describe('computeFingerprint (§4.2.6)', () => {
  it('相同输入 → 相同 hash', async () => {
    const { computeFingerprint } = await import('./code-tools.service.js');
    const a = computeFingerprint('Controllers/UserController.cs', 'sqli', 'var x = 1;');
    const b = computeFingerprint('Controllers/UserController.cs', 'sqli', 'var x = 1;');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('不同 filePath → 不同 hash', async () => {
    const { computeFingerprint } = await import('./code-tools.service.js');
    const a = computeFingerprint('a.cs', 'sqli', 'x');
    const b = computeFingerprint('b.cs', 'sqli', 'x');
    expect(a).not.toBe(b);
  });

  it('不同 vulnType → 不同 hash', async () => {
    const { computeFingerprint } = await import('./code-tools.service.js');
    const a = computeFingerprint('a.cs', 'sqli', 'x');
    const b = computeFingerprint('a.cs', 'xss', 'x');
    expect(a).not.toBe(b);
  });

  it('不同 snippet → 不同 hash', async () => {
    const { computeFingerprint } = await import('./code-tools.service.js');
    const a = computeFingerprint('a.cs', 'sqli', 'x');
    const b = computeFingerprint('a.cs', 'sqli', 'y');
    expect(a).not.toBe(b);
  });

  it('normalize snippet 去 // 注释 + 压空白', async () => {
    const { computeFingerprint } = await import('./code-tools.service.js');
    // 含 // 行尾注释 → 注释被剥离
    const a = computeFingerprint('a.cs', 'sqli', 'var x = 1; // comment');
    const b = computeFingerprint('a.cs', 'sqli', 'var x = 1;');
    expect(a).toBe(b);
  });

  it('normalize snippet 去 /* */ 块注释 + 压空白', async () => {
    const { computeFingerprint } = await import('./code-tools.service.js');
    const a = computeFingerprint('a.cs', 'sqli', 'var /* block */ x = 1;');
    const b = computeFingerprint('a.cs', 'sqli', 'var x = 1;');
    expect(a).toBe(b);
  });

  it('normalize 不区分大小写', async () => {
    const { computeFingerprint } = await import('./code-tools.service.js');
    const a = computeFingerprint('A.cs', 'sqli', 'X = 1');
    const b = computeFingerprint('a.cs', 'sqli', 'x = 1');
    expect(a).toBe(b);
  });
});

describe('SandboxPath', () => {
  it('resolve 合法相对路径 → 绝对路径', async () => {
    const { SandboxPath } = await import('./code-tools.service.js');
    const sb = new SandboxPath('/tmp/sandbox');
    const out = sb.resolve('foo/bar.cs');
    expect(out).toContain('foo');
    expect(out).toContain('bar.cs');
  });

  it('resolve 越界 → throw', async () => {
    const { SandboxPath } = await import('./code-tools.service.js');
    const sb = new SandboxPath('/tmp/sandbox');
    expect(() => sb.resolve('../../etc/passwd')).toThrow(/escapes sandbox/);
  });

  it('toRelative → 把 abs 转回 sandbox 相对', async () => {
    const { SandboxPath } = await import('./code-tools.service.js');
    const sb = new SandboxPath('/tmp/sandbox');
    const abs = sb.resolve('foo/bar.cs');
    const rel = sb.toRelative(abs);
    expect(rel).toBe('foo/bar.cs');
  });
});
