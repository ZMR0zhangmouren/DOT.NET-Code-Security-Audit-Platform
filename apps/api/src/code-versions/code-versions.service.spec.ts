import { describe, it, expect, vi } from 'vitest';

// 跟 git-credentials spec 同套路 —— mock drizzle(避开 CJS 循环依赖)
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
    codeVersions: makeTable('code_versions'),
    projects: makeTable('projects'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  and: (...conds: unknown[]) => ({ __and: conds }),
  desc: (col: { __table: string; __col: string }) => ({ __desc: col }),
}));

// 模拟 StorageService(只关心 codeVersionDir 返回什么)
function createFakeStorage(): { codeVersionDir: (id: string) => string } {
  return {
    codeVersionDir: (id: string) => `/tmp/fake-storage/code-versions/${id}`,
  };
}

interface CvRow {
  id: string;
  projectId: string;
  versionLabel: string;
  sourceType: 'zip' | 'git' | 'github';
  sourceRef: string;
  fileCount: number | null;
  locCount: number | null;
  sizeBytes: number | null;
  parentVersionId: string | null;
  uploadedBy: string;
  uploadedAt: number;
  checksum: string;
  clonedAt: number | null;
  cloneErrorMessage: string | null;
}

interface Cond {
  __eq?: { table: string; col: string; val: unknown };
  __and?: Array<Cond>;
}
function matchesCond(row: CvRow, cond: Cond): boolean {
  if (cond?.__eq)
    return (row as unknown as Record<string, unknown>)[cond.__eq.col] === cond.__eq.val;
  if (cond?.__and) return cond.__and.every((c) => matchesCond(row, c));
  return true;
}

function createFakeDb(): {
  rows: CvRow[];
  select: () => {
    from: (t: unknown) => {
      where: (c: Cond) => { get: () => CvRow | undefined; all: () => CvRow[] };
      get: () => CvRow | undefined;
      all: () => CvRow[];
    };
  };
  insert: () => { values: (v: CvRow) => { run: () => void } };
  update: () => { set: (v: Partial<CvRow>) => { where: (c: Cond) => { run: () => void } } };
} {
  return {
    rows: [],
    select: () => ({
      from: () => ({
        where: (c: Cond) => ({
          get: () => (({}) as never).rows?.find?.((r: CvRow) => matchesCond(r, c)),
          all: () => (({}) as never).rows?.filter?.((r: CvRow) => matchesCond(r, c)) ?? [],
        }),
        get: () => undefined,
        all: () => [],
      }),
    }),
    insert: () => ({
      values: (v: CvRow) => ({
        run: () => {
          (({}) as { rows: CvRow[] }).rows = ([] as CvRow[]).concat([v]);
        },
      }),
    }),
    update: () => ({
      set: (v: Partial<CvRow>) => ({
        where: (_c: Cond) => ({
          run: () => {
            void v;
          },
        }),
      }),
    }),
  };
}

describe('CodeVersionsService.createFromGit', () => {
  it('happy path: invokes gitClone, updates row with fileCount/locCount/sizeBytes/checksum', async () => {
    const fakeDb = createFakeDb();
    // 让 insert/update 真的写进 rows 数组
    const rows: CvRow[] = [];
    fakeDb.insert = () => ({
      values: (v: CvRow) => ({
        run: () => {
          rows.push(v);
        },
      }),
    });
    fakeDb.update = () => ({
      set: (v: Partial<CvRow>) => ({
        where: (c: Cond) => ({
          run: () => {
            const target = rows.find((r) => matchesCond(r, c));
            if (target) Object.assign(target, v);
          },
        }),
      }),
    });
    fakeDb.select = () => ({
      from: () => ({
        where: (c: Cond) => ({
          get: () => rows.find((r) => matchesCond(r, c)),
          all: () => rows.filter((r) => matchesCond(r, c)),
        }),
        get: () => rows[0],
        all: () => rows,
      }),
    });

    const fakeStorage = createFakeStorage();
    const fakeGitClone = {
      cloneRepo: vi.fn(async (input: { destDir: string }) => {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        mkdirSync(input.destDir, { recursive: true });
        writeFileSync(`${input.destDir}/file.cs`, 'class A {}\n', 'utf8');
        return {
          clonedAt: 1234,
          fileCount: 1,
          locCount: 1,
          sizeBytes: 12,
          checksum: 'abc123',
          ref: 'main',
        };
      }),
    };

    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      fakeDb as never,
      fakeStorage as never,
      fakeGitClone as never,
    );

    // 先把项目塞进去
    rows.push({
      id: 'p1',
      projectId: 'p1',
      versionLabel: '',
      sourceType: 'zip',
      sourceRef: '',
      fileCount: null,
      locCount: null,
      sizeBytes: null,
      parentVersionId: null,
      uploadedBy: '',
      uploadedAt: 0,
      checksum: '',
      clonedAt: null,
      cloneErrorMessage: null,
    });

    const out = await svc.createFromGit({
      projectId: 'p1',
      label: 'main branch',
      sourceRef: 'https://github.com/owner/repo.git#main',
      uploadedBy: 'user1',
    });

    expect(fakeGitClone.cloneRepo).toHaveBeenCalledTimes(1);
    expect(out.sourceType).toBe('git');
    expect(out.sourceRef).toBe('https://github.com/owner/repo.git#main');
    expect(out.fileCount).toBe(1);
    expect(out.sizeBytes).toBe(12);
    expect(out.checksum).toBe('abc123');
    expect(out.clonedAt).toBe(1234);
    expect(out.cloneErrorMessage).toBeNull();
    // 验证 row 真的被 update 了
    const stored = rows.find((r) => r.id === out.id)!;
    expect(stored.fileCount).toBe(1);
    expect(stored.checksum).toBe('abc123');
  });

  it('凭证错(AUTH_FAILED): cloneErrorMessage 写入,抛 BadRequestException', async () => {
    const fakeDb = createFakeDb();
    const rows: CvRow[] = [];
    fakeDb.insert = () => ({
      values: (v: CvRow) => ({
        run: () => {
          rows.push(v);
        },
      }),
    });
    fakeDb.update = () => ({
      set: (v: Partial<CvRow>) => ({
        where: (c: Cond) => ({
          run: () => {
            const target = rows.find((r) => matchesCond(r, c));
            if (target) Object.assign(target, v);
          },
        }),
      }),
    });
    fakeDb.select = () => ({
      from: () => ({
        where: (c: Cond) => ({
          get: () => rows.find((r) => matchesCond(r, c)),
          all: () => rows.filter((r) => matchesCond(r, c)),
        }),
        get: () => rows[0],
        all: () => rows,
      }),
    });

    const fakeStorage = createFakeStorage();
    const fakeGitClone = {
      cloneRepo: vi.fn(async () => {
        throw new (await import('../git-clone/git-clone.service.js')).GitCloneError(
          'AUTH_FAILED',
          '凭证认证失败(401)',
        );
      }),
    };

    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      fakeDb as never,
      fakeStorage as never,
      fakeGitClone as never,
    );

    // 注入项目
    rows.push({
      id: 'p1',
      projectId: 'p1',
      versionLabel: '',
      sourceType: 'zip',
      sourceRef: '',
      fileCount: null,
      locCount: null,
      sizeBytes: null,
      parentVersionId: null,
      uploadedBy: '',
      uploadedAt: 0,
      checksum: '',
      clonedAt: null,
      cloneErrorMessage: null,
    });

    await expect(
      svc.createFromGit({
        projectId: 'p1',
        label: 'main branch',
        sourceRef: 'https://github.com/owner/repo.git',
        uploadedBy: 'user1',
      }),
    ).rejects.toMatchObject({ status: 400 });

    // 找到刚才的 row(按 sourceType='git' 找唯一的)
    const gitRow = rows.find((r) => r.sourceType === 'git')!;
    expect(gitRow).toBeDefined();
    expect(gitRow.cloneErrorMessage).toMatch(/AUTH_FAILED.*401/);
    expect(gitRow.fileCount).toBeNull();
    expect(gitRow.checksum).toMatch(/^pending-/);
  });

  it('hostPattern 没匹配(NO_CREDENTIAL): BadRequestException,row 写错误', async () => {
    const fakeDb = createFakeDb();
    const rows: CvRow[] = [];
    fakeDb.insert = () => ({
      values: (v: CvRow) => ({
        run: () => {
          rows.push(v);
        },
      }),
    });
    fakeDb.update = () => ({
      set: (v: Partial<CvRow>) => ({
        where: (c: Cond) => ({
          run: () => {
            const target = rows.find((r) => matchesCond(r, c));
            if (target) Object.assign(target, v);
          },
        }),
      }),
    });
    fakeDb.select = () => ({
      from: () => ({
        where: (c: Cond) => ({
          get: () => rows.find((r) => matchesCond(r, c)),
          all: () => rows.filter((r) => matchesCond(r, c)),
        }),
        get: () => rows[0],
        all: () => rows,
      }),
    });

    const fakeStorage = createFakeStorage();
    const fakeGitClone = {
      cloneRepo: vi.fn(async () => {
        throw new (await import('../git-clone/git-clone.service.js')).GitCloneError(
          'NO_CREDENTIAL',
          '未找到 hostPattern="github.com" 的凭证',
        );
      }),
    };

    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      fakeDb as never,
      fakeStorage as never,
      fakeGitClone as never,
    );

    rows.push({
      id: 'p1',
      projectId: 'p1',
      versionLabel: '',
      sourceType: 'zip',
      sourceRef: '',
      fileCount: null,
      locCount: null,
      sizeBytes: null,
      parentVersionId: null,
      uploadedBy: '',
      uploadedAt: 0,
      checksum: '',
      clonedAt: null,
      cloneErrorMessage: null,
    });

    await expect(
      svc.createFromGit({
        projectId: 'p1',
        label: 'main',
        sourceRef: 'https://github.com/owner/repo.git',
        hostPattern: 'github.com',
        uploadedBy: 'user1',
      }),
    ).rejects.toMatchObject({ status: 400 });

    const gitRow = rows.find((r) => r.sourceType === 'git')!;
    expect(gitRow.cloneErrorMessage).toMatch(/NO_CREDENTIAL/);
  });

  it('label 缺失: BadRequestException', async () => {
    const fakeDb = createFakeDb();
    const rows: CvRow[] = [];
    fakeDb.insert = () => ({
      values: (v: CvRow) => ({
        run: () => {
          rows.push(v);
        },
      }),
    });
    fakeDb.select = () => ({
      from: () => ({
        where: (c: Cond) => ({
          get: () => rows.find((r) => matchesCond(r, c)),
          all: () => rows.filter((r) => matchesCond(r, c)),
        }),
        get: () => rows[0],
        all: () => rows,
      }),
    });

    const fakeStorage = createFakeStorage();
    const fakeGitClone = { cloneRepo: vi.fn() };
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      fakeDb as never,
      fakeStorage as never,
      fakeGitClone as never,
    );

    await expect(
      svc.createFromGit({
        projectId: 'p1',
        label: '',
        sourceRef: 'https://github.com/owner/repo.git',
        uploadedBy: 'user1',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fakeGitClone.cloneRepo).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/*          §5.7 createFromGitHub —— happy / AUTH_FAILED / NOT_FOUND / RATE_LIMITED     */
/* -------------------------------------------------------------------------- */

/** 拼一个能写出 .cs 文件的 fake downloadFromGitHub,模拟"克隆成功" */
function happyDownload(reply: {
  fileCount?: number;
  locCount?: number;
  sizeBytes?: number;
  checksum?: string;
}) {
  return {
    fn: async (input: { destDir: string }) => {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(input.destDir, { recursive: true });
      writeFileSync(`${input.destDir}/file.cs`, 'class A {}\n', 'utf8');
      return {
        fileCount: reply.fileCount ?? 1,
        locCount: reply.locCount ?? 1,
        sizeBytes: reply.sizeBytes ?? 12,
        checksum: reply.checksum ?? 'abc123',
        downloadTimeMs: 5,
      };
    },
  };
}

function makeFullFakeDbWithProject(projectId: string): {
  rows: CvRow[];
  insert: () => { values: (v: CvRow) => { run: () => void } };
  update: () => { set: (v: Partial<CvRow>) => { where: (c: Cond) => { run: () => void } } };
  select: () => {
    from: () => {
      where: (c: Cond) => { get: () => CvRow | undefined; all: () => CvRow[] };
      get: () => CvRow | undefined;
      all: () => CvRow[];
    };
  };
} {
  const rows: CvRow[] = [];
  const fakeDb = {
    rows,
    insert: () => ({
      values: (v: CvRow) => ({
        run: () => {
          rows.push(v);
        },
      }),
    }),
    update: () => ({
      set: (v: Partial<CvRow>) => ({
        where: (c: Cond) => ({
          run: () => {
            const target = rows.find((r) => matchesCond(r, c));
            if (target) Object.assign(target, v);
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: (c: Cond) => ({
          get: () => rows.find((r) => matchesCond(r, c)),
          all: () => rows.filter((r) => matchesCond(r, c)),
        }),
        get: () => rows[0],
        all: () => rows,
      }),
    }),
  };
  // 注入项目行,NotFound 校验通过
  rows.push({
    id: projectId,
    projectId,
    versionLabel: '',
    sourceType: 'zip',
    sourceRef: '',
    fileCount: null,
    locCount: null,
    sizeBytes: null,
    parentVersionId: null,
    uploadedBy: '',
    uploadedAt: 0,
    checksum: '',
    clonedAt: null,
    cloneErrorMessage: null,
  });
  return fakeDb;
}

describe('CodeVersionsService.createFromGitHub', () => {
  it('happy path: downloadFromGitHub 成功 → row 写 fileCount/locCount/sizeBytes/checksum', async () => {
    const fakeDb = makeFullFakeDbWithProject('p1');
    const fakeStorage = createFakeStorage();
    const dl = happyDownload({});
    const fakeGitClone = {
      cloneRepo: vi.fn(),
      downloadFromGitHub: vi.fn(dl.fn),
    };
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      fakeDb as never,
      fakeStorage as never,
      fakeGitClone as never,
    );

    const out = await svc.createFromGitHub({
      projectId: 'p1',
      label: 'main',
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      uploadedBy: 'user1',
    });

    expect(fakeGitClone.downloadFromGitHub).toHaveBeenCalledTimes(1);
    // sourceRef 标准化为 owner/repo#ref
    expect(out.sourceType).toBe('github');
    expect(out.sourceRef).toBe('owner/repo#main');
    expect(out.fileCount).toBe(1);
    expect(out.sizeBytes).toBe(12);
    expect(out.checksum).toBe('abc123');
    expect(out.cloneErrorMessage).toBeNull();
    // row 真的被 update 了 fileCount
    const stored = (fakeDb.rows as CvRow[]).find((r) => r.sourceType === 'github')!;
    expect(stored).toBeDefined();
    expect(stored.fileCount).toBe(1);
    expect(stored.checksum).toBe('abc123');
  });

  it('AUTH_FAILED (401): cloneErrorMessage 落 [AUTH_FAILED],抛 BadRequestException', async () => {
    const fakeDb = makeFullFakeDbWithProject('p1');
    const fakeStorage = createFakeStorage();
    const fakeGitClone = {
      cloneRepo: vi.fn(),
      downloadFromGitHub: vi.fn(async () => {
        const { GitCloneError } = await import('../git-clone/git-clone.service.js');
        throw new GitCloneError('AUTH_FAILED', 'GitHub 凭证认证失败(401)');
      }),
    };
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      fakeDb as never,
      fakeStorage as never,
      fakeGitClone as never,
    );

    await expect(
      svc.createFromGitHub({
        projectId: 'p1',
        label: 'main',
        owner: 'owner',
        repo: 'repo',
        uploadedBy: 'user1',
      }),
    ).rejects.toMatchObject({ status: 400 });

    const stored = (fakeDb.rows as CvRow[]).find((r) => r.sourceType === 'github')!;
    expect(stored).toBeDefined();
    expect(stored.cloneErrorMessage).toMatch(/AUTH_FAILED.*401/);
  });

  it('NOT_FOUND (404): cloneErrorMessage 落 [NOT_FOUND],row 保留', async () => {
    const fakeDb = makeFullFakeDbWithProject('p1');
    const fakeStorage = createFakeStorage();
    const fakeGitClone = {
      cloneRepo: vi.fn(),
      downloadFromGitHub: vi.fn(async () => {
        const { GitCloneError } = await import('../git-clone/git-clone.service.js');
        throw new GitCloneError('NOT_FOUND', 'GitHub 仓库不存在或无权访问(404)');
      }),
    };
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      fakeDb as never,
      fakeStorage as never,
      fakeGitClone as never,
    );

    await expect(
      svc.createFromGitHub({
        projectId: 'p1',
        label: 'main',
        owner: 'no-such-owner',
        repo: 'no-such-repo',
        uploadedBy: 'user1',
      }),
    ).rejects.toMatchObject({ status: 400 });

    const stored = (fakeDb.rows as CvRow[]).find((r) => r.sourceType === 'github')!;
    expect(stored.cloneErrorMessage).toMatch(/NOT_FOUND.*404/);
    expect(stored.fileCount).toBeNull();
  });

  it('RATE_LIMITED (429): cloneErrorMessage 落 [RATE_LIMITED]', async () => {
    const fakeDb = makeFullFakeDbWithProject('p1');
    const fakeStorage = createFakeStorage();
    const fakeGitClone = {
      cloneRepo: vi.fn(),
      downloadFromGitHub: vi.fn(async () => {
        const { GitCloneError } = await import('../git-clone/git-clone.service.js');
        throw new GitCloneError('RATE_LIMITED', 'GitHub API 限流(429)');
      }),
    };
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      fakeDb as never,
      fakeStorage as never,
      fakeGitClone as never,
    );

    await expect(
      svc.createFromGitHub({
        projectId: 'p1',
        label: 'main',
        owner: 'owner',
        repo: 'repo',
        uploadedBy: 'user1',
      }),
    ).rejects.toMatchObject({ status: 400 });

    const stored = (fakeDb.rows as CvRow[]).find((r) => r.sourceType === 'github')!;
    expect(stored.cloneErrorMessage).toMatch(/RATE_LIMITED.*429/);
  });
});
