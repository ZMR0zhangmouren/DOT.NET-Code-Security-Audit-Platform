import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

// §5.2 CodeVersionsService 单测 —— 覆盖 uploadZip / get / listByProject / getExtractedPath
// / createFromGitHub 的 happy + error 路径(createFromGit 在另一个 .spec 文件)
//
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

// Mock yauzl 整体包(避免 ESM 循环 + 真 zip 操作)
vi.mock('yauzl', () => ({
  default: {
    open: (_path: string, _opts: unknown, cb: (err: Error | null, zf?: unknown) => void) => {
      cb(new Error('mocked yauzl: open'));
    },
  },
  open: (_path: string, _opts: unknown, cb: (err: Error | null, zf?: unknown) => void) => {
    cb(new Error('mocked yauzl: open'));
  },
}));

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

interface ProjectRow {
  id: string;
}

interface Cond {
  __eq?: { table: string; col: string; val: unknown };
  __and?: Array<Cond>;
}
function matchesCond(row: Record<string, unknown>, cond: Cond): boolean {
  if (cond?.__eq) return row[cond.__eq.col] === cond.__eq.val;
  if (cond?.__and) return cond.__and.every((c) => matchesCond(row, c));
  return true;
}

interface FakeDb {
  projects: ProjectRow[];
  rows: CvRow[];
  select: (..._args: unknown[]) => {
    from: (t: unknown) => {
      where: (c: Cond) => {
        get: () => unknown;
        all: () => unknown[];
        orderBy: (c: unknown) => { all: () => unknown[] };
      };
      get: () => unknown;
      all: () => unknown[];
    };
  };
  insert: () => { values: (v: CvRow) => { run: () => void } };
  update: () => { set: (v: Partial<CvRow>) => { where: (c: Cond) => { run: () => void } } };
}

function makeDb(): FakeDb {
  const db: FakeDb = {
    projects: [],
    rows: [],
    select: () => ({
      from: () => ({
        where: () => ({ get: () => undefined, all: () => [], orderBy: () => ({ all: () => [] }) }),
        get: () => undefined,
        all: () => [],
      }),
    }),
    insert: () => ({
      values: () => ({ run: () => {} }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ run: () => {} }),
      }),
    }),
  };
  db.select = () => ({
    from: (t: unknown) => {
      const isProjects = (t as { __table?: string })?.__table === 'projects';
      const getPool = () =>
        (isProjects ? db.projects : db.rows) as unknown as Record<string, unknown>[];
      return {
        where: (c: Cond) => ({
          get: () => getPool().find((r) => matchesCond(r, c)),
          all: () => getPool().filter((r) => matchesCond(r, c)),
          orderBy: (_c: unknown) => ({
            all: () => getPool().filter((r) => matchesCond(r, c)),
          }),
        }),
        get: () => getPool()[0],
        all: () => getPool(),
      };
    },
  });
  db.insert = () => ({
    values: (v: CvRow) => ({
      run: () => {
        db.rows.push(v);
      },
    }),
  });
  db.update = () => ({
    set: (v: Partial<CvRow>) => ({
      where: (c: Cond) => ({
        run: () => {
          const target = db.rows.find((r) =>
            matchesCond(r as unknown as Record<string, unknown>, c),
          );
          if (target) Object.assign(target, v);
        },
      }),
    }),
  });
  return db;
}

function makeStorage() {
  return { codeVersionDir: (id: string) => `/tmp/storage/code-versions/${id}` };
}

function makeGitClone() {
  return { cloneRepo: vi.fn() };
}

describe('CodeVersionsService.uploadZip (§5.2)', () => {
  it('zip 过大 → BadRequestException', async () => {
    const db = makeDb();
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );

    await expect(
      svc.uploadZip({
        projectId: 'p1',
        uploadedBy: 'u1',
        label: 'big',
        tmpPath: '/tmp/big.zip',
        originalName: 'big.zip',
        sizeBytes: 600 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('项目不存在 → NotFoundException', async () => {
    const db = makeDb();
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );

    await expect(
      svc.uploadZip({
        projectId: 'p-nope',
        uploadedBy: 'u1',
        label: 'l',
        tmpPath: '/tmp/some.zip',
        originalName: 'some.zip',
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('yauzl 失败(解压失败)→ 抛错', async () => {
    const db = makeDb();
    db.projects.push({ id: 'p1' });
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );

    await expect(
      svc.uploadZip({
        projectId: 'p1',
        uploadedBy: 'u1',
        label: 'l',
        tmpPath: '/tmp/some.zip',
        originalName: 'some.zip',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow();
  });
});

describe('CodeVersionsService.get (§5.2)', () => {
  it('cv 存在 → 返回 CodeVersionPublic', async () => {
    const db = makeDb();
    db.rows.push({
      id: 'cv-1',
      projectId: 'p1',
      versionLabel: 'main',
      sourceType: 'zip',
      sourceRef: 'src.zip',
      fileCount: 10,
      locCount: 100,
      sizeBytes: 1024,
      parentVersionId: null,
      uploadedBy: 'u1',
      uploadedAt: 1700000000,
      checksum: 'abc',
      clonedAt: null,
      cloneErrorMessage: null,
    });
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );
    const r = svc.get('cv-1');
    expect(r.id).toBe('cv-1');
    expect(r.projectId).toBe('p1');
    expect(r.sourceType).toBe('zip');
  });

  it('cv 不存在 → NotFoundException', async () => {
    const db = makeDb();
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );
    expect(() => svc.get('cv-nope')).toThrow(NotFoundException);
  });
});

describe('CodeVersionsService.listByProject (§5.2)', () => {
  it('返回该项目下全部 cv(可能为空)', async () => {
    const db = makeDb();
    db.rows.push(
      {
        id: 'cv-1',
        projectId: 'p1',
        versionLabel: 'v1',
        sourceType: 'zip',
        sourceRef: 'a.zip',
        fileCount: 1,
        locCount: 10,
        sizeBytes: 100,
        parentVersionId: null,
        uploadedBy: 'u1',
        uploadedAt: 100,
        checksum: 'x',
        clonedAt: null,
        cloneErrorMessage: null,
      },
      {
        id: 'cv-2',
        projectId: 'p1',
        versionLabel: 'v2',
        sourceType: 'git',
        sourceRef: 'git@x',
        fileCount: 2,
        locCount: 20,
        sizeBytes: 200,
        parentVersionId: 'cv-1',
        uploadedBy: 'u1',
        uploadedAt: 200,
        checksum: 'y',
        clonedAt: 150,
        cloneErrorMessage: null,
      },
    );
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );
    const r = svc.listByProject('p1');
    expect(r).toHaveLength(2);
    expect(r[0]?.id).toBe('cv-1');
    expect(r[1]?.id).toBe('cv-2');
  });

  it('空项目 → 返回 []', async () => {
    const db = makeDb();
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );
    expect(svc.listByProject('empty')).toEqual([]);
  });
});

describe('CodeVersionsService.getExtractedPath (§5.2)', () => {
  it('返回 storage.codeVersionDir(id)', async () => {
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      makeDb() as never,
      makeStorage() as never,
      makeGitClone() as never,
    );
    expect(svc.getExtractedPath('cv-xyz')).toContain('cv-xyz');
  });
});

describe('CodeVersionsService.createFromGitHub (§5.2)', () => {
  it('label 缺 → BadRequestException', async () => {
    const db = makeDb();
    db.projects.push({ id: 'p1' });
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );
    await expect(
      svc.createFromGitHub({
        projectId: 'p1',
        label: '',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        uploadedBy: 'u1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('owner 缺 → BadRequestException', async () => {
    const db = makeDb();
    db.projects.push({ id: 'p1' });
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );
    await expect(
      svc.createFromGitHub({
        projectId: 'p1',
        label: 'l',
        owner: '',
        repo: 'r',
        uploadedBy: 'u1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('repo 缺 → BadRequestException', async () => {
    const db = makeDb();
    db.projects.push({ id: 'p1' });
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );
    await expect(
      svc.createFromGitHub({
        projectId: 'p1',
        label: 'l',
        owner: 'o',
        repo: '',
        uploadedBy: 'u1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('项目不存在 → NotFoundException', async () => {
    const db = makeDb();
    const mod = await import('./code-versions.service.js');
    const svc = new mod.CodeVersionsService(
      db as never,
      makeStorage() as never,
      makeGitClone() as never,
    );
    await expect(
      svc.createFromGitHub({
        projectId: 'p-nope',
        label: 'l',
        owner: 'o',
        repo: 'r',
        uploadedBy: 'u1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
