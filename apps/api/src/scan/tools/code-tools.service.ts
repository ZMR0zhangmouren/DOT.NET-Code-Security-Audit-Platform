import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve as resolvePath, sep, normalize, relative } from 'node:path';
import { promisify } from 'node:util';

import { Inject, Injectable } from '@nestjs/common';
import type { Severity } from '@platform/shared';
import { and, eq } from 'drizzle-orm';

import { DATABASE, type Db } from '../../db/database.module.js';
import { scanRuns, vulnerabilities, vulnLibraryEntries } from '../../db/schema.js';
import type { MetricsService } from '../../metrics/metrics.service.js';

const execFileAsync = promisify(execFile);

/** 单文件最大读取上限(避免 agent 一次读整个二进制或巨型文件) */
const MAX_READ_BYTES = 100 * 1024;

/** 指纹归一化:去空白、去注释前缀、压空白 */
function normalizeSnippet(snippet: string): string {
  return snippet
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeFilePath(p: string): string {
  return normalize(p).replace(/\\/g, '/').toLowerCase();
}

/**
 * §4.2.6 fingerprint 算法:
 *   sha256(normalize(file_path) + "|" + vuln_type + "|" + normalize(code_snippet))
 */
export function computeFingerprint(filePath: string, vulnType: string, snippet: string): string {
  const h = createHash('sha256');
  h.update(normalizeFilePath(filePath));
  h.update('|');
  h.update(vulnType);
  h.update('|');
  h.update(normalizeSnippet(snippet));
  return h.digest('hex');
}

/**
 * 沙箱路径解析器 —— 任何 LLM 提供的 path 必须落在 sandboxRoot 内。
 * 返回规范化的绝对路径;若越界抛错。
 */
export class SandboxPath {
  readonly sandboxRoot: string;

  constructor(sandboxRoot: string) {
    this.sandboxRoot = resolvePath(sandboxRoot);
  }

  /** 给定用户输入的相对/绝对路径,返回安全绝对路径;若越界抛 Error */
  resolve(input: string): string {
    const abs = resolvePath(this.sandboxRoot, input);
    const rel = relative(this.sandboxRoot, abs);
    if (rel.startsWith('..') || rel === '..' || abs !== `${this.sandboxRoot}${sep}${rel}`) {
      throw new Error(`path escapes sandbox: ${input}`);
    }
    return abs;
  }

  toRelative(abs: string): string {
    return relative(this.sandboxRoot, abs).split(sep).join('/');
  }
}

export interface RecordVulnInput {
  vulnType: string;
  severity: Severity;
  title: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet: string;
  exploitPayload?: string;
  fixSuggestion: string;
  evidenceRefs?: string[];
}

/**
 * CodeFileSystem —— 受 sandbox 限制的只读文件视图 + recordVulnerability。
 *
 * ScanRunnerService 为每次 ScanRun new 一个实例,绑定到该 run 的代码解压目录。
 */
@Injectable()
export class CodeFileSystem {
  readonly path: SandboxPath;

  constructor(
    sandboxRoot: string,
    @Inject(DATABASE) private readonly db: Db,
    // §10.3 —— 可选依赖,允许单测里 new CodeFileSystem(...) 不传 metrics
    private readonly metrics?: MetricsService,
  ) {
    this.path = new SandboxPath(sandboxRoot);
  }

  /** 读取文件(最多 100KB),返回 utf8 字符串 */
  async readFile(input: string): Promise<string> {
    const abs = this.path.resolve(input);
    const buf = await readFile(abs);
    if (buf.length > MAX_READ_BYTES) {
      return buf.subarray(0, MAX_READ_BYTES).toString('utf8') + '\n... [truncated]';
    }
    return buf.toString('utf8');
  }

  /** 关键字搜索 —— 优先用 rg,否则退化到 node 正则 */
  async searchCode(
    pattern: string,
    fileGlob?: string,
  ): Promise<Array<{ file: string; line: number; text: string }>> {
    const root = this.path.sandboxRoot;
    const hits: Array<{ file: string; line: number; text: string }> = [];
    const regex = new RegExp(pattern, 'i');
    const matchGlob = fileGlob ? globToRegex(fileGlob) : null;

    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = `${dir}/${ent.name}`;
        if (ent.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!ent.isFile()) continue;
        const rel = full
          .slice(root.length + 1)
          .split(sep)
          .join('/');
        if (matchGlob && !matchGlob.test(rel)) continue;
        let content: string;
        try {
          const st = await stat(full);
          if (st.size > MAX_READ_BYTES * 4) continue; // 太大跳过
          content = (await readFile(full)).toString('utf8');
        } catch {
          continue;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (regex.test(line)) {
            hits.push({ file: rel, line: i + 1, text: line });
          }
        }
      }
    }

    // 先尝试 rg
    try {
      const args = ['--line-number', '--no-heading', '-i', pattern];
      if (fileGlob) args.push('--glob', fileGlob);
      args.push('.');
      const { stdout } = await execFileAsync('rg', args, {
        cwd: root,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      for (const line of stdout.split('\n')) {
        const m = /^(.+?):(\d+):(.*)$/.exec(line);
        if (!m) continue;
        const file = m[1] ?? '';
        const ln = Number(m[2] ?? '0');
        const text = m[3] ?? '';
        hits.push({ file, line: ln, text });
      }
      return hits;
    } catch {
      // rg 不可用或无命中,退化 walk
      await walk(root);
    }
    return hits;
  }

  /**
   * 记录一条漏洞实例 —— 计算 fingerprint,upsert VulnLibraryEntry,插入 Vulnerability。
   * 返回新建实例的 id + libraryId。
   */
  async recordVulnerability(
    scanRunId: string,
    input: RecordVulnInput,
  ): Promise<{ vulnId: string; libraryId: string; fingerprint: string }> {
    const run = this.db.select().from(scanRuns).where(eq(scanRuns.id, scanRunId)).get() as
      | {
          id: string;
          projectId: string;
          codeVersionId: string;
        }
      | undefined;
    if (!run) throw new Error(`scanRun ${scanRunId} not found`);

    const fingerprint = computeFingerprint(input.filePath, input.vulnType, input.codeSnippet);
    const now = Date.now();

    // upsert VulnLibraryEntry
    const existing = this.db
      .select()
      .from(vulnLibraryEntries)
      .where(
        and(
          eq(vulnLibraryEntries.projectId, run.projectId),
          eq(vulnLibraryEntries.fingerprint, fingerprint),
        ),
      )
      .get() as { id: string; occurrenceCount: number; severityMax: Severity } | undefined;

    let libraryId: string;
    if (existing) {
      libraryId = existing.id;
      const bumpedCount = existing.occurrenceCount + 1;
      // severityMax 简单取更严重:C > H > M > L
      const order: Record<Severity, number> = { C: 4, H: 3, M: 2, L: 1 };
      const newMax =
        order[input.severity] > order[existing.severityMax] ? input.severity : existing.severityMax;
      this.db
        .update(vulnLibraryEntries)
        .set({
          lastSeenRunId: scanRunId,
          lastSeenVersionId: run.codeVersionId,
          lastSeenAt: now,
          occurrenceCount: bumpedCount,
          severityMax: newMax,
          updatedAt: now,
        })
        .where(eq(vulnLibraryEntries.id, libraryId))
        .run();
    } else {
      libraryId = `vle-${now.toString(36)}-${randomHex(4)}`;
      this.db
        .insert(vulnLibraryEntries)
        .values({
          id: libraryId,
          projectId: run.projectId,
          vulnType: input.vulnType,
          fingerprint,
          title: input.title,
          description: input.fixSuggestion,
          severityMax: input.severity,
          cvssMax: null,
          status: 'open',
          assigneeId: null,
          tags: [],
          firstSeenRunId: scanRunId,
          firstSeenVersionId: run.codeVersionId,
          firstSeenAt: now,
          lastSeenRunId: scanRunId,
          lastSeenVersionId: run.codeVersionId,
          lastSeenAt: now,
          occurrenceCount: 1,
          fixedInVersionId: null,
          fixedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const vulnId = `vul-${now.toString(36)}-${randomHex(4)}`;
    this.db
      .insert(vulnerabilities)
      .values({
        id: vulnId,
        scanRunId,
        projectId: run.projectId,
        codeVersionId: run.codeVersionId,
        libraryId,
        vulnType: input.vulnType,
        severity: input.severity,
        cvssScore: null,
        fingerprint,
        filePath: input.filePath,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd,
        codeSnippet: input.codeSnippet,
        exploitPayload: input.exploitPayload ?? null,
        fixSuggestion: input.fixSuggestion,
        evidenceRefs: input.evidenceRefs ?? [],
        status: 'open',
        assigneeId: null,
        fixedInVersionId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // §10.3 —— vuln_found_total:recordVulnerability 成功落库后 inc
    this.metrics?.incVulnFound(input.severity, input.vulnType);

    return { vulnId, libraryId, fingerprint };
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLESTAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLESTAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function randomHex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++)
    s += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  return s;
}
