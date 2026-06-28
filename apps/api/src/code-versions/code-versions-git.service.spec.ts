import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

import type { CodeVersionsService } from './code-versions.service.js';

// §5.7 createFromGit —— label/sourceRef 校验、project 校验、gitClone 成功 / 失败

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
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
    codeVersions: makeTable('code_versions'),
    projects: makeTable('projects'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  and: (...conds: unknown[]) => ({ __and: conds }),
  desc: (col: { __table: string; __col: string }) => ({
    __desc: { table: col.__table, col: col.__col },
  }),
}));

interface CondEq {
  __eq: { col: string; val: unknown };
}
type Cond = CondEq | unknown;

function matchesCond(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond || typeof cond !== 'object') return true;
  if ('__eq' in (cond as object)) {
    const c = (cond as CondEq).__eq;
    return row[c.col] === c.val;
  }
  return true;
}

function createFakeDb(rows: Record<string, Record<string, unknown>[]> = {}): {
  rows: Record<string, Record<string, unknown>[]>;
  select: () => {
    from: (t: unknown) => {
      where: (cond: Cond) => {
        get: () => Record<string, unknown> | undefined;
        all: () => Record<string, unknown>[];
      };
      get: () => Record<string, unknown> | undefined;
      all: () => Record<string, unknown>[];
    };
  };
  insert: () => {
    values: (v: Record<string, unknown>) => {
      run: () => void;
    };
  };
  update: () => {
    set: (v: Record<string, unknown>) => {
      where: (cond: Cond) => {
        run: () => void;
      };
    };
  };
} {
  return {
    rows,
    select: () => ({
      from: (t: unknown) => {
        const tableName = (t as { __table: string }).__table;
        if (!rows[tableName]) rows[tableName] = [];
        const where = (cond: Cond) => ({
          get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
          all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
        });
        return {
          where,
          get: () => rows[tableName]![0],
          all: () => rows[tableName]!,
        };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        run: () => {
          rows['code_versions'] = rows['code_versions'] ?? [];
          rows['code_versions']!.push(v);
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (cond: Cond) => ({
          run: () => {
            const target = rows['code_versions']!.find((r) => matchesCond(r, cond));
            if (target) Object.assign(target, v);
          },
        }),
      }),
    }),
  };
}

async function makeSvc(opts: {
  dbRows?: Record<string, Record<string, unknown>[]>;
  cloneRepo?: ReturnType<typeof vi.fn>;
  storageCodeVersionDir?: (id: string) => string;
}): Promise<CodeVersionsService> {
  const fakeDb = createFakeDb(opts.dbRows);
  const gitClone = {
    cloneRepo: opts.cloneRepo ?? vi.fn(),
  };
  const storage = {
    codeVersionDir: opts.storageCodeVersionDir ?? ((id: string) => `/tmp/cv/${id}`),
  };
  const mod = await import('./code-versions.service.js');
  return new mod.CodeVersionsService(fakeDb as never, storage as never, gitClone as never);
}

describe('CodeVersionsService.createFromGit (§5.7)', () => {
  it('label 缺失 → BadRequestException', async () => {
    const svc = await makeSvc({});
    await expect(
      svc.createFromGit({
        projectId: 'p1',
        label: '',
        sourceRef: 'git@github.com:x/y.git',
        uploadedBy: 'admin',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sourceRef 缺失 → BadRequestException', async () => {
    const svc = await makeSvc({});
    await expect(
      svc.createFromGit({
        projectId: 'p1',
        label: 'v1',
        sourceRef: '',
        uploadedBy: 'admin',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('project 不存在 → NotFoundException', async () => {
    const svc = await makeSvc({});
    await expect(
      svc.createFromGit({
        projectId: 'p-missing',
        label: 'v1',
        sourceRef: 'git@github.com:x/y.git',
        uploadedBy: 'admin',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('happy path:gitClone 成功 → 返回 CodeVersionPublic 含 clonedAt + checksum', async () => {
    const fakeDb = {
      projects: [{ id: 'p1', name: 'p' }],
    };
    const cloneRepo = vi.fn(async () => ({
      fileCount: 10,
      locCount: 100,
      sizeBytes: 1024,
      checksum: 'sha256:abc',
      uploadedAt: Date.now(),
      clonedAt: Date.now(),
      cloneErrorMessage: null,
    }));
    const svc = await makeSvc({ dbRows: fakeDb, cloneRepo });
    const out = await svc.createFromGit({
      projectId: 'p1',
      label: 'v1',
      sourceRef: 'git@github.com:x/y.git',
      hostPattern: 'github.com',
      uploadedBy: 'admin',
    });
    expect(out.projectId).toBe('p1');
    expect(out.sourceType).toBe('git');
    expect(out.sourceRef).toBe('git@github.com:x/y.git');
    expect(out.uploadedBy).toBe('admin');
    expect(out.checksum).toBe('sha256:abc');
    expect(cloneRepo).toHaveBeenCalledWith({
      sourceType: 'git',
      sourceRef: 'git@github.com:x/y.git',
      hostPattern: 'github.com',
      destDir: expect.stringContaining('/tmp/cv/'),
      projectId: 'p1',
    });
  });

  it('gitClone 失败 → 抛 BadRequestException(前端可见)', async () => {
    const fakeDb = {
      projects: [{ id: 'p1', name: 'p' }],
    };
    const cloneRepo = vi.fn(async () => {
      throw new Error('authentication failed');
    });
    const svc = await makeSvc({ dbRows: fakeDb, cloneRepo });
    await expect(
      svc.createFromGit({
        projectId: 'p1',
        label: 'v1',
        sourceRef: 'git@github.com:x/y.git',
        uploadedBy: 'admin',
      }),
    ).rejects.toThrow(/git clone failed: authentication failed/);
  });
});
