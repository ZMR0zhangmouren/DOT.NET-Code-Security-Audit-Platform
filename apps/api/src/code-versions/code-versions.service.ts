import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdirSync, createWriteStream, rmSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { Entry as YauzlEntry } from 'yauzl';

import { DATABASE, type Db } from '../db/database.module.js';
import { codeVersions, projects } from '../db/schema.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GitCloneService, GitCloneError } from '../git-clone/git-clone.service.js'; // runtime ref (NestJS DI)
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StorageService } from '../storage/storage.service.js'; // runtime ref (NestJS DI)

/** Q4:单 zip 500MB 上限 */
export const ZIP_MAX_BYTES = 500 * 1024 * 1024;

const LOC_EXTENSIONS = new Set(['.cs', '.cshtml', '.csproj', '.sln', '.vb', '.aspx', '.ascx']);

export interface CodeVersionPublic {
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
  extractedPath: string;
  clonedAt: number | null;
  cloneErrorMessage: string | null;
}

interface CodeVersionRow {
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

@Injectable()
export class CodeVersionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly gitClone: GitCloneService,
  ) {}

  /**
   * 上传并解压 zip。
   * 流程:
   *  1. 计算 SHA-256
   *  2. 拒绝:损坏 / 加密 / 含符号链接 / 绝对路径 / `..` 穿越
   *  3. 解压到 storage/code-versions/{cvId}/
   *  4. 计数 fileCount + LOC(粗粒度,扫所有文本文件)
   *  5. 插入 code_versions 行
   */
  async uploadZip(input: {
    projectId: string;
    uploadedBy: string;
    label: string;
    parentVersionId?: string;
    tmpPath: string;
    originalName: string;
    sizeBytes: number;
  }): Promise<CodeVersionPublic> {
    if (input.sizeBytes > ZIP_MAX_BYTES) {
      throw new BadRequestException(
        `zip too large: ${input.sizeBytes} bytes (limit ${ZIP_MAX_BYTES})`,
      );
    }

    // 1. 项目存在性校验
    const project = this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get();
    if (!project) throw new NotFoundException(`project ${input.projectId} not found`);

    if (input.parentVersionId) {
      const parent = this.db
        .select({ id: codeVersions.id })
        .from(codeVersions)
        .where(
          and(
            eq(codeVersions.id, input.parentVersionId),
            eq(codeVersions.projectId, input.projectId),
          ),
        )
        .get();
      if (!parent) throw new BadRequestException('parentVersionId not found in this project');
    }

    // 2. SHA-256
    const checksum = await sha256File(input.tmpPath);

    // 3. 解压
    const cvId = `cv-${Date.now().toString(36)}-${randomHex(4)}`;
    const targetDir = this.storage.codeVersionDir(cvId);

    const { fileCount, locCount } = await safeExtractZip(input.tmpPath, targetDir);

    // 4. 插入
    const now = Date.now();
    this.db
      .insert(codeVersions)
      .values({
        id: cvId,
        projectId: input.projectId,
        versionLabel: input.label,
        sourceType: 'zip',
        sourceRef: input.originalName,
        fileCount,
        locCount,
        sizeBytes: input.sizeBytes,
        parentVersionId: input.parentVersionId ?? null,
        uploadedBy: input.uploadedBy,
        uploadedAt: now,
        checksum,
      })
      .run();

    return {
      ...this.get(cvId),
      extractedPath: targetDir,
    };
  }

  get(id: string): CodeVersionPublic {
    const row = this.db.select().from(codeVersions).where(eq(codeVersions.id, id)).get() as
      | CodeVersionRow
      | undefined;
    if (!row) throw new NotFoundException(`codeVersion ${id} not found`);
    return this.toPublic(row);
  }

  listByProject(projectId: string): CodeVersionPublic[] {
    const rows = this.db
      .select()
      .from(codeVersions)
      .where(eq(codeVersions.projectId, projectId))
      .orderBy(desc(codeVersions.uploadedAt))
      .all() as unknown as CodeVersionRow[];
    return rows.map((r) => this.toPublic(r));
  }

  getExtractedPath(id: string): string {
    return this.storage.codeVersionDir(id);
  }

  private toPublic(r: CodeVersionRow): CodeVersionPublic {
    return {
      id: r.id,
      projectId: r.projectId,
      versionLabel: r.versionLabel,
      sourceType: r.sourceType,
      sourceRef: r.sourceRef,
      fileCount: r.fileCount,
      locCount: r.locCount,
      sizeBytes: r.sizeBytes,
      parentVersionId: r.parentVersionId,
      uploadedBy: r.uploadedBy,
      uploadedAt: r.uploadedAt,
      checksum: r.checksum,
      extractedPath: this.storage.codeVersionDir(r.id),
      clonedAt: r.clonedAt,
      cloneErrorMessage: r.cloneErrorMessage,
    };
  }

  /**
   * §5.7 真接 git clone —— 创建一条 sourceType='git' 的 code_versions,
   * 调 GitCloneService.cloneRepo,失败时把 message 落到 cloneErrorMessage。
   *
   * 成功路径:产物落在 storage/code-versions/{cvId}/,后续 Scan 流程无差异(都用 extractedPath)
   * 失败路径:row 保留(clonedAt=null, cloneErrorMessage 写入),前端可见
   */
  async createFromGit(input: {
    projectId: string;
    label: string;
    sourceRef: string;
    hostPattern?: string;
    uploadedBy: string;
  }): Promise<CodeVersionPublic> {
    if (!input.label?.trim()) throw new BadRequestException('label is required');
    if (!input.sourceRef?.trim()) throw new BadRequestException('sourceRef is required');

    // 1. 项目存在性校验
    const project = this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get();
    if (!project) throw new NotFoundException(`project ${input.projectId} not found`);

    // 2. 占位 row(先有 id 才能算 destDir)
    const cvId = `cv-${Date.now().toString(36)}-${randomHex(4)}`;
    const destDir = this.storage.codeVersionDir(cvId);
    const now = Date.now();

    this.db
      .insert(codeVersions)
      .values({
        id: cvId,
        projectId: input.projectId,
        versionLabel: input.label.trim(),
        sourceType: 'git',
        sourceRef: input.sourceRef.trim(),
        fileCount: null,
        locCount: null,
        sizeBytes: null,
        parentVersionId: null,
        uploadedBy: input.uploadedBy,
        uploadedAt: now,
        checksum: `pending-${cvId}`, // 临时,克隆成功后会被覆盖
        clonedAt: null,
        cloneErrorMessage: null,
      })
      .run();

    // 3. 调 gitCloneService
    try {
      const r = await this.gitClone.cloneRepo({
        sourceType: 'git',
        sourceRef: input.sourceRef,
        hostPattern: input.hostPattern,
        destDir,
        projectId: input.projectId,
      });
      this.db
        .update(codeVersions)
        .set({
          fileCount: r.fileCount,
          locCount: r.locCount,
          sizeBytes: r.sizeBytes,
          checksum: r.checksum,
          clonedAt: r.clonedAt,
          cloneErrorMessage: null,
        })
        .where(eq(codeVersions.id, cvId))
        .run();
    } catch (e) {
      const msg =
        e instanceof GitCloneError ? `[${e.code}] ${e.message}` : String((e as Error).message);
      this.db
        .update(codeVersions)
        .set({ cloneErrorMessage: msg })
        .where(eq(codeVersions.id, cvId))
        .run();
      // 重新抛 BadRequestException,前端能拿到 4xx + message
      throw new BadRequestException(`git clone failed: ${msg}`);
    }
    return this.get(cvId);
  }
}

/* -------------------------------------------------------------------------- */
/*                          解压 + 安全校验(yauzl)                             */
/* -------------------------------------------------------------------------- */

interface ExtractResult {
  fileCount: number;
  locCount: number;
}

async function sha256File(path: string): Promise<string> {
  return new Promise<string>((resolveFn, rejectFn) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('data', (chunk) => h.update(chunk));
    s.on('end', () => resolveFn(h.digest('hex')));
    s.on('error', rejectFn);
  });
}

function randomHex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++)
    s += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  return s;
}

/**
 * 解压 zip 到 targetDir,拒绝:
 *  - 加密条目
 *  - 符号链接(Symlink 标志位)
 *  - 绝对路径
 *  - `..` 路径穿越
 *
 * 用 yauzl 串行处理(简单且能拿到 entry flags)。
 */
async function safeExtractZip(zipPath: string, targetDir: string): Promise<ExtractResult> {
  mkdirSync(targetDir, { recursive: true });
  const yauzl = await import('yauzl');

  return new Promise<ExtractResult>((resolveFn, rejectFn) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        rmSync(targetDir, { recursive: true, force: true });
        rejectFn(err ?? new Error('failed to open zip'));
        return;
      }

      let fileCount = 0;
      let locCount = 0;
      let aborted = false;

      const onAbort = (reason: string): void => {
        aborted = true;
        rmSync(targetDir, { recursive: true, force: true });
        zipfile.close();
        rejectFn(new Error(reason));
      };

      zipfile.on('error', (e: Error) => onAbort(`zip error: ${e.message}`));
      zipfile.on('end', () => {
        if (!aborted) resolveFn({ fileCount, locCount });
      });

      zipfile.on('entry', (entry: YauzlEntry) => {
        if (aborted) return;

        // 加密条目 → 拒绝
        if ((entry as unknown as { encrypted?: boolean }).encrypted) {
          onAbort('encrypted zip entry not allowed');
          return;
        }

        // 拒绝 MS-DOS / Unix symlink(S_IFLNK = 0xA000)
        const attrs = entry.externalFileAttributes as unknown as number | undefined;
        const isSymlink =
          (typeof attrs === 'number' && ((attrs >>> 16) & 0xa000) === 0xa000) ||
          (typeof attrs === 'number' && ((attrs >>> 16) & 0o170000) === 0o120000);
        if (isSymlink) {
          onAbort(`symlink entry not allowed: ${entry.fileName}`);
          return;
        }

        const rel = normalize(entry.fileName).replace(/\\/g, '/');
        if (!rel || rel.endsWith('/')) {
          // 目录条目,跳过
          zipfile.readEntry();
          return;
        }

        // 绝对路径或 .. 穿越
        const parts = rel.split('/');
        if (parts.some((p) => p === '..') || rel.startsWith('/')) {
          onAbort(`unsafe path in zip: ${entry.fileName}`);
          return;
        }

        const outPath = join(targetDir, rel);
        const normOut = normalize(outPath);
        if (!normOut.startsWith(normalize(targetDir) + sep) && normOut !== normalize(targetDir)) {
          onAbort(`path escapes target: ${entry.fileName}`);
          return;
        }

        mkdirSync(join(normOut, '..'), { recursive: true });

        zipfile.openReadStream(entry, (rsErr, readStream) => {
          if (rsErr || !readStream) {
            onAbort(`failed to read entry ${entry.fileName}: ${rsErr?.message ?? 'unknown'}`);
            return;
          }
          const ws = createWriteStream(normOut);
          readStream.pipe(ws);
          ws.on('finish', () => {
            fileCount++;
            try {
              const st = statSync(normOut);
              if (st.size <= 1024 * 1024) {
                const ext = '.' + (parts[parts.length - 1]?.split('.').slice(1).join('.') ?? '');
                if (LOC_EXTENSIONS.has(ext)) {
                  const buf = readFileSync(normOut, 'utf8');
                  // 简单行计数
                  for (let i = 0; i < buf.length; i++) {
                    if (buf.charCodeAt(i) === 10) locCount++;
                  }
                  if (buf.length && buf.charCodeAt(buf.length - 1) !== 10) locCount++;
                }
              }
            } catch {
              /* ignore individual file stat error */
            }
            zipfile.readEntry();
          });
          ws.on('error', (e: Error) => onAbort(`write failed: ${e.message}`));
        });
      });

      zipfile.readEntry();
    });
  });
}
