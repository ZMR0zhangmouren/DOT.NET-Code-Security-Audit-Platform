import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { GitCloneError } from './git-clone.service.js';
import {
  buildTarballUrl,
  mapHttpStatus,
  parseName,
  parseOctal,
  stripTopLevel,
} from './github.service.js';

// mock drizzle(避免 vitest CJS 下 ERR_REQUIRE_CYCLE_MODULE)
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
    gitCredentials: makeTable('git_credentials'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
}));

interface CredRow {
  id: string;
  scope: 'system' | 'project';
  projectId: string | null;
  kind: 'ssh_key' | 'https_token';
  hostPattern: string;
  username: string | null;
  secretEnc: string;
  isActive: boolean;
}

interface FakeDb {
  rows: CredRow[];
  select: () => { from: () => { all: () => CredRow[] } };
}

function createFakeDb(rows: CredRow[] = []): FakeDb {
  return {
    rows,
    select: () => ({
      from: () => ({
        all: () => rows,
      }),
    }),
  };
}

function makeTarBlock(name: string, size: number, content: Buffer = Buffer.alloc(0)): Buffer {
  // 写一个完整的 USTAR header(简化版;保证 name / size + 5% padding)
  const header = Buffer.alloc(512);
  header.write(name);
  // size 字段(123..136),octal,空格补
  const sizeOct = size.toString(8).padStart(11, '0') + ' ';
  header.write(sizeOct, 124, 11);
  // typeflag: 0x30 = 普通文件
  header[156] = 0x30;
  // ustar magic at offset 257
  header.write('ustar', 257, 5);
  header[262] = 0x00; // version
  // checksum field 全部先填空格,后面再算
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  // chksum:sum of all bytes (treat chksum field as 8 spaces)
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i]!;
  const chkOct = sum.toString(8).padStart(6, '0') + '\0 ';
  header.write(chkOct, 148, 8);

  const padding = (512 - (size % 512)) % 512;
  const paddingBuf = Buffer.alloc(padding);

  if (content.length === 0 && size === 0) {
    return Buffer.concat([header, paddingBuf]);
  }
  return Buffer.concat([header, content, paddingBuf]);
}

function makeTarGz(entries: Array<{ name: string; content: string }>): Buffer {
  // 顺序:顶层 dir/entries + 末尾两个全零 block
  const parts: Buffer[] = [];
  parts.push(makeTarBlock('owner-repo-sha/', 0, Buffer.alloc(0)));
  for (const e of entries) {
    const contentBuf = Buffer.from(e.content, 'utf8');
    parts.push(makeTarBlock(`owner-repo-sha/${e.name}`, contentBuf.length, contentBuf));
  }
  parts.push(Buffer.alloc(1024)); // 两个结束块
  const tarBuf = Buffer.concat(parts);
  return gzipSync(tarBuf);
}

// ===========================================================================
// 工具函数单元测试
// ===========================================================================

describe('buildTarballUrl', () => {
  it('encodes owner / repo / ref', () => {
    expect(buildTarballUrl('owner', 'repo', 'main')).toBe(
      'https://api.github.com/repos/owner/repo/tarball/main',
    );
  });

  it('URL-encodes owner with slash', () => {
    expect(buildTarballUrl('a/b', 'repo', 'main')).toBe(
      'https://api.github.com/repos/a%2Fb/repo/tarball/main',
    );
  });

  it('URL-encodes ref with special chars', () => {
    expect(buildTarballUrl('o', 'r', 'feat/x')).toBe(
      'https://api.github.com/repos/o/r/tarball/feat%2Fx',
    );
  });
});

describe('mapHttpStatus', () => {
  it('401 → AUTH_FAILED', () => {
    const e = mapHttpStatus(401, 'https://x');
    expect(e.code).toBe('AUTH_FAILED');
  });

  it('403 → AUTH_FORBIDDEN', () => {
    const e = mapHttpStatus(403, 'https://x');
    expect(e.code).toBe('AUTH_FORBIDDEN');
  });

  it('404 → NOT_FOUND', () => {
    const e = mapHttpStatus(404, 'https://x');
    expect(e.code).toBe('NOT_FOUND');
  });

  it('429 → RATE_LIMITED', () => {
    const e = mapHttpStatus(429, 'https://x');
    expect(e.code).toBe('RATE_LIMITED');
  });

  it('5xx → SERVER_ERROR', () => {
    const e = mapHttpStatus(503, 'https://x');
    expect(e.code).toBe('SERVER_ERROR');
  });

  it('non-2xx non-5xx → UNKNOWN', () => {
    const e = mapHttpStatus(418, 'https://x');
    expect(e.code).toBe('UNKNOWN');
  });
});

describe('parseName + parseOctal + stripTopLevel', () => {
  it('parseName 不用 prefix 时只取 name', () => {
    const h = Buffer.alloc(512);
    h.write('hello.txt');
    expect(parseName(h)).toBe('hello.txt');
  });

  it('parseName 有 prefix 时拼 prefix/name', () => {
    const h = Buffer.alloc(512);
    h.write('world.txt');
    h.write('foo', 345, 3);
    expect(parseName(h)).toBe('foo/world.txt');
  });

  it('parseOctal 把 8 进制字符串转成 number', () => {
    const buf = Buffer.from('0001234\0', 'utf8');
    expect(parseOctal(buf)).toBe(0o1234);
  });

  it('parseOctal 接受空格填充', () => {
    const buf = Buffer.from('0001234 ', 'utf8');
    expect(parseOctal(buf)).toBe(0o1234);
  });

  it('stripTopLevel 没有 prefix 时返回原 name', () => {
    expect(stripTopLevel('hello/world.txt', null)).toBe('hello/world.txt');
  });

  it('stripTopLevel 去掉顶层目录', () => {
    expect(stripTopLevel('owner-repo-sha/path/file.txt', 'owner-repo-sha')).toBe('path/file.txt');
  });
});

// ===========================================================================
// GitHubService.resolveToken 凭证优先级测试
// ===========================================================================

describe('GitHubService.resolveToken', () => {
  beforeEach(() => {
    delete process.env['GITHUB_TOKEN'];
    delete process.env['APP_MASTER_KEY'];
  });
  afterEach(() => {
    delete process.env['GITHUB_TOKEN'];
    delete process.env['APP_MASTER_KEY'];
  });

  it('env GITHUB_TOKEN 优先:直接用 env 不查 db', async () => {
    process.env['GITHUB_TOKEN'] = 'ghp_env_token';
    process.env['APP_MASTER_KEY'] = 'test-master-key';
    const fakeDb = createFakeDb(); // 无凭证
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    const r = svc.resolveToken({});
    expect(r?.source).toBe('env');
    expect(r?.token).toBe('ghp_env_token');
  });

  it('env 缺失时 fallback 到 db 精确 hostPattern', async () => {
    process.env['APP_MASTER_KEY'] = 'test-master-key';
    const cryptoMod = await import('../common/crypto.util.js');
    const enc = cryptoMod.encryptSecret('ghp_db_exact', cryptoMod.getMasterKey());
    const fakeDb = createFakeDb([
      {
        id: 'gc-1',
        scope: 'system',
        projectId: null,
        kind: 'https_token',
        hostPattern: 'github.com',
        username: 'octocat',
        secretEnc: enc,
        isActive: true,
      },
    ]);
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    const r = svc.resolveToken({ hostPattern: 'github.com' });
    expect(r?.source).toBe('db_exact');
    expect(r?.token).toBe('ghp_db_exact');
  });

  it('精确 host 找不到时 fallback 通配符 *', async () => {
    process.env['APP_MASTER_KEY'] = 'test-master-key';
    const cryptoMod = await import('../common/crypto.util.js');
    const enc = cryptoMod.encryptSecret('ghp_wild', cryptoMod.getMasterKey());
    const fakeDb = createFakeDb([
      {
        id: 'gc-wild',
        scope: 'system',
        projectId: null,
        kind: 'https_token',
        hostPattern: '*',
        username: null,
        secretEnc: enc,
        isActive: true,
      },
    ]);
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    const r = svc.resolveToken({ hostPattern: 'github.com' });
    expect(r?.source).toBe('db_wild');
    expect(r?.token).toBe('ghp_wild');
  });

  it('project scope 命中 projectId 时优先 system scope', async () => {
    process.env['APP_MASTER_KEY'] = 'test-master-key';
    const cryptoMod = await import('../common/crypto.util.js');
    const encSys = cryptoMod.encryptSecret('sys-tok', cryptoMod.getMasterKey());
    const encProj = cryptoMod.encryptSecret('proj-tok', cryptoMod.getMasterKey());
    const fakeDb = createFakeDb([
      {
        id: 'gc-sys',
        scope: 'system',
        projectId: null,
        kind: 'https_token',
        hostPattern: 'github.com',
        username: 'sys',
        secretEnc: encSys,
        isActive: true,
      },
      {
        id: 'gc-proj',
        scope: 'project',
        projectId: 'p1',
        kind: 'https_token',
        hostPattern: 'github.com',
        username: 'proj',
        secretEnc: encProj,
        isActive: true,
      },
    ]);
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    const r = svc.resolveToken({ hostPattern: 'github.com', projectId: 'p1' });
    expect(r?.token).toBe('proj-tok');
  });

  it('凭证完全没找到 → null', async () => {
    process.env['APP_MASTER_KEY'] = 'test-master-key';
    const fakeDb = createFakeDb();
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    expect(svc.resolveToken({ hostPattern: 'github.com' })).toBeNull();
  });
});

// ===========================================================================
// GitHubService.downloadTarball —— HTTP 错误映射测试
// ===========================================================================

describe('GitHubService.downloadTarball — error mapping', () => {
  beforeEach(() => {
    process.env['GITHUB_TOKEN'] = 'ghp_test';
    process.env['APP_MASTER_KEY'] = 'test-master-key';
  });
  afterEach(() => {
    delete process.env['GITHUB_TOKEN'];
  });

  function makeStatusResponse(statusCode: number): PassThrough {
    const p = new PassThrough();
    // 必须把 statusCode 在响应被消费者读到之前同步设定——
    // GitHubService.downloadTarball 在 fetchImpl resolve 后立即读 statusCode
    // 模拟一个 HTTP 错误响应:set 状态码 + empty body + 立刻 end
    Object.assign(p, { statusCode });
    setImmediate(() => p.end());
    return p;
  }

  it('401 → AUTH_FAILED', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    const fetchImpl = vi.fn(async () => makeStatusResponse(401) as never);

    await expect(
      svc.downloadTarball({
        owner: 'o',
        repo: 'r',
        ref: 'main',
        destDir: './tmp-test-github-401',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('403 → AUTH_FORBIDDEN', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    const fetchImpl = vi.fn(async () => makeStatusResponse(403) as never);
    await expect(
      svc.downloadTarball({
        owner: 'o',
        repo: 'r',
        ref: 'main',
        destDir: './tmp-test-github-403',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });

  it('404 → NOT_FOUND', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    const fetchImpl = vi.fn(async () => makeStatusResponse(404) as never);
    await expect(
      svc.downloadTarball({
        owner: 'o',
        repo: 'r',
        ref: 'main',
        destDir: './tmp-test-github-404',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('429 → RATE_LIMITED', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    const fetchImpl = vi.fn(async () => makeStatusResponse(429) as never);
    await expect(
      svc.downloadTarball({
        owner: 'o',
        repo: 'r',
        ref: 'main',
        destDir: './tmp-test-github-429',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('5xx → SERVER_ERROR', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    const fetchImpl = vi.fn(async () => makeStatusResponse(503) as never);
    await expect(
      svc.downloadTarball({
        owner: 'o',
        repo: 'r',
        ref: 'main',
        destDir: './tmp-test-github-503',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('owner / repo 缺失 → INVALID_URL', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    await expect(
      svc.downloadTarball({
        owner: '',
        repo: 'r',
        destDir: './tmp-test-github-empty',
      }),
    ).rejects.toBeInstanceOf(GitCloneError);
  });

  it('没有 GITHUB_TOKEN + 没 db 凭证 → NO_CREDENTIAL', async () => {
    delete process.env['GITHUB_TOKEN'];
    process.env['APP_MASTER_KEY'] = 'test-master-key';
    const fakeDb = createFakeDb();
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    await expect(
      svc.downloadTarball({
        owner: 'o',
        repo: 'r',
        destDir: './tmp-test-github-no-cred',
      }),
    ).rejects.toMatchObject({ code: 'NO_CREDENTIAL' });
  });
});

// ===========================================================================
// GitHubService.downloadTarball —— happy path(mock fetchImpl + real tar.gz)
// ===========================================================================

describe('GitHubService.downloadTarball — happy path', () => {
  it('stream 一个真实 tar.gz,解压落盘 + 返回 metrics', async () => {
    process.env['GITHUB_TOKEN'] = 'ghp_test';
    process.env['APP_MASTER_KEY'] = 'test-master-key';
    const fakeDb = createFakeDb();
    const mod = await import('./github.service.js');
    const svc = new mod.GitHubService(fakeDb as never);
    const tgz = makeTarGz([
      { name: 'README.md', content: '# Hello\nWorld\n' },
      { name: 'src/Program.cs', content: 'class A {}\nclass B {}\n' },
    ]);

    const stream = new PassThrough();
    Object.assign(stream, { statusCode: 200 });
    setImmediate(() => stream.end(tgz));
    const fetchImpl = vi.fn(async () => stream as never);

    const out = await svc.downloadTarball({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      destDir: './tmp-test-github-happy',
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // URL 拼上了 owner/repo/ref + Bearer token
    const [calledUrl, calledOpts] = fetchImpl.mock.calls[0]!;
    expect(calledUrl).toContain('/repos/o/r/tarball/main');
    expect(calledOpts.headers['Authorization']).toBe('Bearer ghp_test');
    expect(calledOpts.headers['User-Agent']).toBe('dotnet-audit-platform/1.0');
    expect(calledOpts.headers['Accept']).toBe('application/vnd.github+json');

    // 至少 2 个文件(LOC 计算只数 .cs / .cshtml / 等)
    expect(out.fileCount).toBeGreaterThanOrEqual(2);
    expect(out.sizeBytes).toBeGreaterThan(0);
    expect(out.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(out.downloadTimeMs).toBeGreaterThanOrEqual(0);

    // 行尾检查
    const { existsSync, rmSync } = await import('node:fs');
    expect(existsSync('./tmp-test-github-happy/src/Program.cs')).toBe(true);
    rmSync('./tmp-test-github-happy', { recursive: true, force: true });
  });
});

// 抑制 unused-warning
void beforeEach;
