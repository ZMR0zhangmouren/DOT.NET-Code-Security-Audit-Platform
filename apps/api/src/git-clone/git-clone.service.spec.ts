import { describe, it, expect, vi } from 'vitest';

// 跟 git-credentials.service.spec 同套路:mock drizzle(避免 vitest CJS 下
// 的 ERR_REQUIRE_CYCLE_MODULE),service 看到的 schema 是 Proxy,column 是 stub。
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
  and: (...conds: unknown[]) => ({ __and: conds }),
  like: (col: { __table: string; __col: string }, val: unknown) => ({
    __like: { table: col.__table, col: col.__col, val },
  }),
  or: (...conds: unknown[]) => ({ __or: conds }),
}));

interface Row {
  id: string;
  scope: 'system' | 'project';
  projectId: string | null;
  kind: 'ssh_key' | 'https_token';
  hostPattern: string;
  username: string | null;
  secretEnc: string;
  isActive: boolean;
}

interface CondEq {
  __eq: { table: string; col: string; val: unknown };
}
interface CondAnd {
  __and: Array<CondEq | unknown>;
}
type Cond = CondEq | CondAnd | unknown;

function matchesCond(row: Row, cond: Cond): boolean {
  if (cond && typeof cond === 'object' && '__eq' in (cond as object)) {
    const c = (cond as CondEq).__eq;
    return (row as unknown as Record<string, unknown>)[c.col] === c.val;
  }
  if (cond && typeof cond === 'object' && '__and' in (cond as object)) {
    return (cond as CondAnd).__and.every((c) => matchesCond(row, c));
  }
  return true;
}

function createFakeDb(rows: Row[] = []): {
  rows: Row[];
  select: () => {
    from: (t: unknown) => {
      where: (cond: Cond) => {
        all: () => Row[];
        get: () => Row | undefined;
      };
      all: () => Row[];
    };
  };
} {
  return {
    rows,
    select: () => ({
      from: () => ({
        where: (cond: Cond) => ({
          all: () => rows.filter((r) => matchesCond(r, cond)),
          get: () => rows.find((r) => matchesCond(r, cond)),
        }),
        all: () => rows,
      }),
    }),
  };
}

describe('parseSourceRef', () => {
  it('parses https URL with branch ref', async () => {
    const mod = await import('./git-clone.service.js');
    const r = mod.parseSourceRef('https://github.com/owner/repo.git#main');
    expect(r.url).toBe('https://github.com/owner/repo.git');
    expect(r.ref).toBe('main');
  });

  it('parses https URL without ref', async () => {
    const mod = await import('./git-clone.service.js');
    const r = mod.parseSourceRef('https://github.com/owner/repo.git');
    expect(r.url).toBe('https://github.com/owner/repo.git');
    expect(r.ref).toBeNull();
  });

  it('parses SSH URL with branch', async () => {
    const mod = await import('./git-clone.service.js');
    const r = mod.parseSourceRef('git@github.com:owner/repo.git#develop');
    expect(r.url).toBe('git@github.com:owner/repo.git');
    expect(r.ref).toBe('develop');
  });

  it('rejects unsupported URL scheme', async () => {
    const mod = await import('./git-clone.service.js');
    expect(() => mod.parseSourceRef('ftp://example.com/repo.git')).toThrow(
      /not a supported git URL/,
    );
  });

  it('trims empty ref to null', async () => {
    const mod = await import('./git-clone.service.js');
    const r = mod.parseSourceRef('https://github.com/owner/repo.git#');
    expect(r.ref).toBeNull();
  });
});

describe('injectHttpsToken', () => {
  it('injects user:token into https URL', async () => {
    const mod = await import('./git-clone.service.js');
    const out = mod.injectHttpsToken('https://github.com/owner/repo.git', 'octocat', 'ghp_secret');
    expect(out).toBe('https://octocat:ghp_secret@github.com/owner/repo.git');
  });

  it('URL-encodes special chars in token', async () => {
    const mod = await import('./git-clone.service.js');
    const out = mod.injectHttpsToken('https://gitlab.com/o/r.git', 'u', 'p@ss:wo/rd?');
    expect(out).toBe('https://u:p%40ss%3Awo%2Frd%3F@gitlab.com/o/r.git');
  });

  it('throws on non-https URL', async () => {
    const mod = await import('./git-clone.service.js');
    expect(() => mod.injectHttpsToken('git@github.com:owner/repo.git', 'u', 't')).toThrow(
      /invalid https url/,
    );
  });
});

describe('GitCloneService.findCredentialByHostPattern', () => {
  it('matches exact host_pattern', async () => {
    const fakeDb = createFakeDb([
      {
        id: 'gc1',
        scope: 'system',
        projectId: null,
        kind: 'https_token',
        hostPattern: 'github.com',
        username: 'octocat',
        secretEnc: 'enc-1',
        isActive: true,
      },
    ]);
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);
    // encrypt -> decrypt roundtrip via real crypto util
    const cryptoMod = await import('../common/crypto.util.js');
    process.env['APP_MASTER_KEY'] = 'test-master-key-for-spec';
    const enc = cryptoMod.encryptSecret('ghp_token_value', cryptoMod.getMasterKey());
    fakeDb.rows[0]!.secretEnc = enc;
    fakeDb.rows[0]!.secretEnc = enc;

    const found = svc.findCredentialByHostPattern('github.com');
    expect(found).not.toBeNull();
    expect(found!.kind).toBe('https_token');
    expect(found!.secret).toBe('ghp_token_value');
  });

  it('falls back to wildcard "*" when no exact match', async () => {
    const fakeDb = createFakeDb([
      {
        id: 'gc-wild',
        scope: 'system',
        projectId: null,
        kind: 'https_token',
        hostPattern: '*',
        username: 'fallback',
        secretEnc: 'x',
        isActive: true,
      },
    ]);
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);
    const cryptoMod = await import('../common/crypto.util.js');
    process.env['APP_MASTER_KEY'] = 'test-master-key-for-spec';
    fakeDb.rows[0]!.secretEnc = cryptoMod.encryptSecret('wild-token', cryptoMod.getMasterKey());

    const found = svc.findCredentialByHostPattern('gitlab.example.com');
    expect(found).not.toBeNull();
    expect(found!.secret).toBe('wild-token');
  });

  it('returns null when no credential matches', async () => {
    const fakeDb = createFakeDb([]);
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);
    expect(svc.findCredentialByHostPattern('github.com')).toBeNull();
  });

  it('prefers project-scope over system-scope when projectId matches', async () => {
    const fakeDb = createFakeDb([
      {
        id: 'gc-sys',
        scope: 'system',
        projectId: null,
        kind: 'https_token',
        hostPattern: 'github.com',
        username: 'sys',
        secretEnc: 'sys-enc',
        isActive: true,
      },
      {
        id: 'gc-proj',
        scope: 'project',
        projectId: 'p1',
        kind: 'https_token',
        hostPattern: 'github.com',
        username: 'proj',
        secretEnc: 'proj-enc',
        isActive: true,
      },
    ]);
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);
    const cryptoMod = await import('../common/crypto.util.js');
    process.env['APP_MASTER_KEY'] = 'test-master-key-for-spec';
    fakeDb.rows[0]!.secretEnc = cryptoMod.encryptSecret('sys-token', cryptoMod.getMasterKey());
    fakeDb.rows[1]!.secretEnc = cryptoMod.encryptSecret('proj-token', cryptoMod.getMasterKey());

    const found = svc.findCredentialByHostPattern('github.com', 'p1');
    expect(found!.id).toBe('gc-proj');
    expect(found!.secret).toBe('proj-token');
  });
});

describe('GitCloneService.cloneRepo', () => {
  it('happy path: invokes git with --depth=1, ref, and destDir', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);

    const calls: Array<{
      file: string;
      args: string[];
      opts: { env: NodeJS.ProcessEnv; timeout: number };
    }> = [];
    const execImpl = vi.fn(
      async (file: string, args: string[], opts: { timeout: number; env: NodeJS.ProcessEnv }) => {
        calls.push({ file, args, opts });
        // 模拟"git clone 成功"——创建 destDir 加一个空文件
        const dest = args[args.length - 1] as string;
        const { mkdirSync, writeFileSync } = await import('node:fs');
        mkdirSync(dest, { recursive: true });
        writeFileSync(`${dest}/README.md`, '# hello\nworld\n', 'utf8');
        return { stdout: '', stderr: '' };
      },
    );

    const result = await svc.cloneRepo({
      sourceType: 'git',
      sourceRef: 'https://github.com/owner/repo.git#main',
      destDir: './tmp-test-dest-happy',
      execImpl,
    });

    expect(execImpl).toHaveBeenCalledTimes(1);
    const call = calls[0]!;
    expect(call.file).toBe('git');
    expect(call.args).toContain('clone');
    expect(call.args).toContain('--depth=1');
    expect(call.args).toContain('--branch');
    expect(call.args).toContain('main');
    expect(call.args[call.args.length - 1]).toBe('./tmp-test-dest-happy');
    // ref 已经解析出来
    expect(result.ref).toBe('main');
    expect(result.fileCount).toBeGreaterThanOrEqual(1);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('HTTPS token: injects user:token@ into URL', async () => {
    const fakeDb = createFakeDb([
      {
        id: 'gc-https',
        scope: 'system',
        projectId: null,
        kind: 'https_token',
        hostPattern: 'github.com',
        username: 'octocat',
        secretEnc: 'x',
        isActive: true,
      },
    ]);
    const cryptoMod = await import('../common/crypto.util.js');
    process.env['APP_MASTER_KEY'] = 'test-master-key-for-spec';
    fakeDb.rows[0]!.secretEnc = cryptoMod.encryptSecret(
      'ghp_secret_token',
      cryptoMod.getMasterKey(),
    );

    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);

    const calls: Array<{ args: string[] }> = [];
    const execImpl = vi.fn(async (_file: string, args: string[]) => {
      calls.push({ args });
      const dest = args[args.length - 1] as string;
      const { mkdirSync } = await import('node:fs');
      mkdirSync(dest, { recursive: true });
      return { stdout: '', stderr: '' };
    });

    await svc.cloneRepo({
      sourceType: 'git',
      sourceRef: 'https://github.com/owner/repo.git',
      destDir: './tmp-test-dest-https',
      execImpl,
    });

    // URL 应该是注入后的形式
    const urlArg = calls[0]!.args.find((a) => a.startsWith('https://'));
    expect(urlArg).toBe('https://octocat:ghp_secret_token@github.com/owner/repo.git');
  });

  it('SSH key: writes to temp file and sets GIT_SSH_COMMAND', async () => {
    const fakeDb = createFakeDb([
      {
        id: 'gc-ssh',
        scope: 'system',
        projectId: null,
        kind: 'ssh_key',
        hostPattern: 'github.com',
        username: null,
        secretEnc: 'x',
        isActive: true,
      },
    ]);
    const cryptoMod = await import('../common/crypto.util.js');
    process.env['APP_MASTER_KEY'] = 'test-master-key-for-spec';
    const fakeKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END-----';
    fakeDb.rows[0]!.secretEnc = cryptoMod.encryptSecret(fakeKey, cryptoMod.getMasterKey());

    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);

    let writtenKeyPath: string | null = null;
    let writtenKeyContent: string | null = null;
    const writeFileImpl = vi.fn((p: string, content: string) => {
      writtenKeyPath = p;
      writtenKeyContent = content;
    });
    const chmodImpl = vi.fn();
    const execImpl = vi.fn(
      async (_file: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
        // 不实际 clone,只看 GIT_SSH_COMMAND
        expect(opts.env['GIT_SSH_COMMAND']).toContain('-i');
        expect(opts.env['GIT_SSH_COMMAND']).toContain(writtenKeyPath!);
        const dest = args[args.length - 1] as string;
        const { mkdirSync } = await import('node:fs');
        mkdirSync(dest, { recursive: true });
        return { stdout: '', stderr: '' };
      },
    );
    // 注入稳定的 SSH key path
    const fakeKeyPath = '/tmp/audit-git-key-test';
    const sshKeyPathImpl = () => fakeKeyPath;

    await svc.cloneRepo({
      sourceType: 'git',
      sourceRef: 'git@github.com:owner/repo.git',
      destDir: './tmp-test-dest-ssh',
      execImpl,
      writeFileImpl,
      chmodImpl,
      sshKeyPathImpl,
    });

    expect(writtenKeyPath).toBe(fakeKeyPath);
    expect(writtenKeyContent).toBe(fakeKey);
    expect(chmodImpl).toHaveBeenCalledWith(fakeKeyPath, 0o600);
  });

  it('NO_CREDENTIAL: throws when hostPattern has no matching credential', async () => {
    const fakeDb = createFakeDb([]);
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);

    await expect(
      svc.cloneRepo({
        sourceType: 'git',
        sourceRef: 'https://github.com/owner/repo.git',
        destDir: './tmp-test-dest-no-cred',
        hostPattern: 'github.com',
        execImpl: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'NO_CREDENTIAL' });
  });

  it('AUTH_FAILED: maps 401 stderr to AUTH_FAILED', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);

    const execImpl = vi.fn(async () => {
      const err: NodeJS.ErrnoException = new Error('Command failed: git clone');
      err.code = 'ERR_PROCESS_EXEC';
      err.stderr =
        "remote: Invalid username or password.\nfatal: Authentication failed for 'https://x'";
      throw err;
    });

    await expect(
      svc.cloneRepo({
        sourceType: 'git',
        sourceRef: 'https://github.com/owner/repo.git',
        destDir: './tmp-test-dest-401',
        execImpl,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('AUTH_FORBIDDEN: maps 403 to AUTH_FORBIDDEN', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);

    const execImpl = vi.fn(async () => {
      const err: NodeJS.ErrnoException = new Error('Command failed: git clone');
      err.stderr = 'remote: Forbidden\nfatal: unable to access';
      throw err;
    });

    await expect(
      svc.cloneRepo({
        sourceType: 'git',
        sourceRef: 'https://github.com/owner/repo.git',
        destDir: './tmp-test-dest-403',
        execImpl,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });

  it('NETWORK_UNREACHABLE: maps ENOTFOUND-like stderr', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);

    const execImpl = vi.fn(async () => {
      const err: NodeJS.ErrnoException = new Error('Command failed: git clone');
      err.stderr = 'fatal: unable to access: Could not resolve host github.example.com';
      throw err;
    });

    await expect(
      svc.cloneRepo({
        sourceType: 'git',
        sourceRef: 'https://github.example.com/owner/repo.git',
        destDir: './tmp-test-dest-net',
        execImpl,
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_UNREACHABLE' });
  });

  it('TIMEOUT: maps ETIMEDOUT to TIMEOUT', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);

    const execImpl = vi.fn(async () => {
      const err: NodeJS.ErrnoException = new Error('Command failed: git clone');
      err.code = 'ETIMEDOUT';
      err.signal = 'SIGTERM';
      err.stderr = '';
      throw err;
    });

    await expect(
      svc.cloneRepo({
        sourceType: 'git',
        sourceRef: 'https://github.com/owner/repo.git',
        destDir: './tmp-test-dest-timeout',
        execImpl,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('TIMEOUT: 5 分钟 (300_000ms) is passed to exec', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);

    let observedTimeout: number | null = null;
    const execImpl = vi.fn(async (_f, _a, opts) => {
      observedTimeout = opts.timeout;
      const dest = _a[_a.length - 1] as string;
      const { mkdirSync } = await import('node:fs');
      mkdirSync(dest, { recursive: true });
      return { stdout: '', stderr: '' };
    });

    await svc.cloneRepo({
      sourceType: 'git',
      sourceRef: 'https://github.com/owner/repo.git',
      destDir: './tmp-test-dest-timeout-2',
      execImpl,
    });
    expect(observedTimeout).toBe(5 * 60 * 1000);
  });

  it('GIT_NOT_FOUND: maps ENOENT to GIT_NOT_FOUND', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);

    const execImpl = vi.fn(async () => {
      const err: NodeJS.ErrnoException = new Error('spawn git ENOENT');
      err.code = 'ENOENT';
      err.stderr = '';
      throw err;
    });

    await expect(
      svc.cloneRepo({
        sourceType: 'git',
        sourceRef: 'https://github.com/owner/repo.git',
        destDir: './tmp-test-dest-enoent',
        execImpl,
      }),
    ).rejects.toMatchObject({ code: 'GIT_NOT_FOUND' });
  });
});

describe('GitCloneService.pullRepo', () => {
  it('throws UNKNOWN (Phase 2 placeholder)', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./git-clone.service.js');
    const svc = new mod.GitCloneService(fakeDb as never);
    await expect(svc.pullRepo({ sourceRef: 'x', destDir: 'y' })).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
  });
});
