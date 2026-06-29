/**
 * §5.7 真接 GitHub REST API —— /repos/{owner}/{repo}/tarball/{ref}
 *
 * 设计要点:
 * - 流式 pipe 响应到落盘的 .tar.gz,避免大仓库内存爆
 * - 自写 minimal tar 解压器,不引入 `tar` / `tar-stream` 包(MVP 减依赖)
 * - 错误映射 401 / 403 / 404 / 429 / 5xx → GitCloneError(同 §5.7 风格)
 * - 凭证优先级:env GITHUB_TOKEN > git_credentials(精确 hostPattern > 通配 *)
 *
 * 依赖:仅 node 内置 `node:https` / `node:zlib` / `node:stream` / `node:fs`
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import { dirname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { decryptSecret, getMasterKey } from '../common/crypto.util.js';
import { DATABASE, type Db } from '../db/database.module.js';
import { gitCredentials } from '../db/schema.js';

import { GitCloneError, type GitCloneErrorCode } from './git-clone.service.js';

const USER_AGENT = 'dotnet-audit-platform/1.0';
const ACCEPT_JSON = 'application/vnd.github+json';
const TAR_BLOCK = 512;
// 5 分钟超时(与 git clone 路径一致)
const TIMEOUT_MS = 5 * 60 * 1000;

export interface DownloadTarballInput {
  owner: string;
  repo: string;
  ref?: string;
  hostPattern?: string; // 不传则默认 'github.com'
  destDir: string; // 已经 mkdir 好的目标顶层目录;tarball 顶层目录会被剥离
  projectId?: string; // 用于匹配 project scope 凭证
  /** 测试用:替换底层 GET(签名仿 node:https.get) */
  fetchImpl?: (url: string, opts: NodeHttpRequestOptions) => Promise<IncomingMessage>;
}

interface NodeHttpRequestOptions {
  method: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}

export interface DownloadTarballResult {
  fileCount: number;
  locCount: number;
  sizeBytes: number;
  checksum: string;
  downloadTimeMs: number;
}

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

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);

  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * 解析凭证来源(优先级):
   *   1. process.env.GITHUB_TOKEN(运维侧配置,优先级最高,适合 CI / 服务器部署)
   *   2. git_credentials 表:精确 hostPattern > 通配符 '*';project scope > system scope
   * 返回 { token, source } 或 null
   */
  resolveToken(input: { hostPattern?: string; projectId?: string }): {
    token: string;
    source: 'env' | 'db_exact' | 'db_wild';
  } | null {
    const envTok = process.env['GITHUB_TOKEN'];
    if (envTok && envTok.trim()) {
      return { token: envTok.trim(), source: 'env' };
    }

    const host = input.hostPattern ?? 'github.com';

    const rows = this.db.select().from(gitCredentials).all() as CredRow[];
    const active = rows.filter((r) => r.isActive);
    const matchExact = active.filter((r) => r.hostPattern === host);
    if (matchExact.length > 0) {
      const projHit = input.projectId
        ? matchExact.find((r) => r.scope === 'project' && r.projectId === input.projectId)
        : undefined;
      const row = projHit ?? matchExact[0]!;
      if (row.kind === 'https_token') {
        return {
          token: decryptSecret(row.secretEnc, getMasterKey()),
          source: 'db_exact',
        };
      }
    }
    const matchWild = active.filter((r) => r.hostPattern === '*');
    if (matchWild.length > 0) {
      const projHit = input.projectId
        ? matchWild.find((r) => r.scope === 'project' && r.projectId === input.projectId)
        : undefined;
      const row = projHit ?? matchWild[0]!;
      if (row.kind === 'https_token') {
        return {
          token: decryptSecret(row.secretEnc, getMasterKey()),
          source: 'db_wild',
        };
      }
    }
    return null;
  }

  /**
   * 主入口:下载 GitHub tarball 并解压到 destDir
   *
   * 流程:
   *  1. 解析凭证(env > db)
   *  2. 拼 URL + Header,GET tarball,流式写到 tmp .tar.gz
   *  3. gunzip + 自写 minimal tar parser,落到 destDir(去掉顶层目录前缀)
   *  4. walkAndCount + checksumDir → 返回 metrics
   *
   * 失败映射:
   *  - 401 → AUTH_FAILED
   *  - 403 → AUTH_FORBIDDEN
   *  - 404 → NOT_FOUND
   *  - 429 → RATE_LIMITED
   *  - 5xx → SERVER_ERROR
   *  - 网络错误 → NETWORK_UNREACHABLE
   *  - 超时 → TIMEOUT
   */
  async downloadTarball(input: DownloadTarballInput): Promise<DownloadTarballResult> {
    if (!input.owner?.trim() || !input.repo?.trim()) {
      throw new GitCloneError('INVALID_URL', 'owner/repo 不能为空');
    }
    const cred = this.resolveToken({
      hostPattern: input.hostPattern,
      projectId: input.projectId,
    });
    if (!cred) {
      throw new GitCloneError(
        'NO_CREDENTIAL',
        `未找到 hostPattern="${input.hostPattern ?? 'github.com'}" 的凭证;可设置环境变量 GITHUB_TOKEN 或在 §5.7 Git Credentials 中创建 https_token 凭证`,
      );
    }

    const ref = input.ref?.trim() || 'HEAD';
    const url = buildTarballUrl(input.owner.trim(), input.repo.trim(), ref);

    // 1. 确保 destDir 父存在,清理上次残留
    const parent = dirname(input.destDir);
    mkdirSync(parent, { recursive: true });
    if (existsSync(input.destDir)) {
      rmSync(input.destDir, { recursive: true, force: true });
    }
    mkdirSync(input.destDir, { recursive: true });

    const tgzPath = join(input.destDir, '_download.tar.gz');
    const startedAt = Date.now();

    // 2. GET tarball,流式 pipe 到临时文件
    const fetchImpl: NonNullable<DownloadTarballInput['fetchImpl']> =
      input.fetchImpl ?? httpsGetAsync;
    try {
      await getAndPipe({
        url,
        token: cred.token,
        outPath: tgzPath,
        fetchImpl,
        onStatusError: (statusCode) => {
          throw mapHttpStatus(statusCode, url);
        },
      });
    } catch (e) {
      if (e instanceof GitCloneError) throw e;
      // 网络层异常
      const err = e as { code?: string; message?: string; name?: string };
      if (
        err.name === 'AbortError' ||
        err.code === 'ABORT_ERR' ||
        /aborted/i.test(err.message ?? '')
      ) {
        throw new GitCloneError('TIMEOUT', `GitHub tarball 下载超时(>${TIMEOUT_MS}ms)`, e);
      }
      if (
        err.code === 'ENOTFOUND' ||
        err.code === 'ECONNREFUSED' ||
        /ENETUNREACH|getaddrinfo|EAI_AGAIN/i.test(err.message ?? '')
      ) {
        throw new GitCloneError(
          'NETWORK_UNREACHABLE',
          `无法连接 api.github.com:${err.message ?? 'unknown'}`,
          e,
        );
      }
      throw new GitCloneError('UNKNOWN', `GitHub tarball 下载失败:${err.message ?? String(e)}`, e);
    }

    // 3. 解压 .tar.gz → destDir
    let extractedBytes = 0;
    try {
      extractedBytes = await extractTarGz(tgzPath, input.destDir);
    } catch (e) {
      throw new GitCloneError(
        'UNKNOWN',
        `tarball 解压失败:${(e as Error).message ?? String(e)}`,
        e,
      );
    } finally {
      // 解压完清理 tar.gz
      try {
        rmSync(tgzPath, { force: true });
      } catch {
        /* ignore */
      }
    }

    // 4. 统计
    const { fileCount, locCount, sizeBytes } = walkAndCount(input.destDir);
    const checksum = await checksumDir(input.destDir);
    const downloadTimeMs = Date.now() - startedAt;

    this.logger.warn(
      `[downloadTarball] ${input.owner}/${input.repo}#${ref} -> ` +
        `${fileCount} files, ${locCount} LOC, ${extractedBytes} bytes extracted in ${downloadTimeMs}ms ` +
        `(token=${cred.source})`,
    );

    return { fileCount, locCount, sizeBytes, checksum, downloadTimeMs };
  }
}

/* -------------------------------------------------------------------------- */
/*                          HTTP 请求层                                        */
/* -------------------------------------------------------------------------- */

/**
 * 把 node:https.get 包装成 Promise<IncomingMessage>。
 * https.get 的回调第一个参数是 IncomingMessage,所以直接 return res 后再 then 链上拿。
 * 任一 err 走 reject。
 */
function httpsGetAsync(url: string, opts: NodeHttpRequestOptions): Promise<IncomingMessage> {
  return new Promise<IncomingMessage>((resolveFn, rejectFn) => {
    try {
      const req = https.get(url, opts, (res) => {
        resolveFn(res);
      });
      req.on('error', rejectFn);
      // 把 signal 关闭 → 立刻 abort
      opts.signal?.addEventListener('abort', () => req.destroy());
    } catch (e) {
      rejectFn(e);
    }
  });
}

interface GetAndPipeArgs {
  url: string;
  token: string;
  outPath: string;
  fetchImpl: NonNullable<DownloadTarballInput['fetchImpl']>;
  onStatusError: (statusCode: number) => void;
}

/**
 * 用 https.get 或 fetchImpl 拉 tarball,边读边写,直到把响应体全部写入 outPath。
 * statusCode 不是 2xx 时调 onStatusError(由调用方决定抛什么)
 */
function getAndPipe(args: GetAndPipeArgs): Promise<void> {
  return new Promise<void>((resolveFn, rejectFn) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    args
      .fetchImpl(args.url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${args.token}`,
          Accept: ACCEPT_JSON,
          'User-Agent': USER_AGENT,
        },
      })
      .then((res) => {
        if (res.statusCode !== 200) {
          // 读 body 头部消息,但不消费整个流
          res.destroy();
          clearTimeout(timer);
          args.onStatusError(res.statusCode ?? 0);
          resolveFn();
          return;
        }
        const ws = createWriteStream(args.outPath);
        pipeline(res, ws, (err) => {
          clearTimeout(timer);
          if (err) rejectFn(err);
          else resolveFn();
        });
      })
      .catch((e) => {
        clearTimeout(timer);
        rejectFn(e);
      });
  });
}

export function mapHttpStatus(statusCode: number, url: string): GitCloneError {
  switch (statusCode) {
    case 401:
      return new GitCloneError(
        'AUTH_FAILED',
        `GitHub 凭证认证失败(401):请检查 token 是否过期或被撤销`,
      );
    case 403:
      // GitHub 也会把 rate limit 当 403,这里优先 RATE_LIMITED
      return new GitCloneError(
        'AUTH_FORBIDDEN',
        `GitHub 拒绝访问(403):token 权限不足或未授权该 repo(${url})`,
      );
    case 404:
      return new GitCloneError(
        'NOT_FOUND',
        `GitHub 仓库不存在或无权访问(404):${url}——请确认 owner/repo/ref 拼写,以及 token 是否有 repo 权限`,
      );
    case 429:
      return new GitCloneError(
        'RATE_LIMITED',
        `GitHub API 限流(429):请稍后重试,或换用更高权限的 token`,
      );
    default:
      if (statusCode >= 500) {
        return new GitCloneError('SERVER_ERROR', `GitHub 服务器错误(${statusCode}):${url}`);
      }
      return new GitCloneError('UNKNOWN', `GitHub tarball 请求失败(HTTP ${statusCode}):${url}`);
  }
}

export function buildTarballUrl(owner: string, repo: string, ref: string): string {
  // ref = HEAD 是 GitHub 允许的"默认分支"——GitHub 用 /tarball 也能代表不带 ref,但官方文档允许
  // 为了清晰,我们始终把 ref 拼上
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(ref)}`;
}

/* -------------------------------------------------------------------------- */
/*                          tarball 解压层(自写)                                */
/* -------------------------------------------------------------------------- */

/**
 * 读 .tar.gz 文件,逐 block 解析 USTAR tar header,把内容流式写出。
 *
 * 这个实现是 USTAR / POSIX tar 的超集,够读 GitHub tarball。
 *
 * 拒绝:
 *  - 路径含 `..`
 *  - 绝对路径
 *  - 符号链接、字符块、设备文件(有 typeflag)
 *
 * 顶层目录会被自动剥离(GitHub tarball 形如 `owner-repo-sha/{...}`,我们只留 sha 后的内容)
 *
 * 实现要点:把 gunzip 的 data 累积到 buf,然后在每次 data 事件里"按 tar block 边界"切割:
 *   1. 读 header(512 字节) → name / size
 *   2. 切出 data(size)→ 写到文件
 *   3. 跳过 padding((512 - size%512) %512)
 *   4. 重复,直到 buf 不足 512 字节,等下一波 data
 *   5. 遇到两个连续全零 block → 结束
 */
export function extractTarGz(tgzPath: string, targetDir: string): Promise<number> {
  return new Promise<number>((resolveFn, rejectFn) => {
    const rs = createReadStream(tgzPath);
    const gz = createGunzip();
    let buf = Buffer.alloc(0);
    let topLevelPrefix: string | null = null;
    let totalBytes = 0;
    let zeroBlockCount = 0;

    rs.on('error', rejectFn);
    gz.on('error', rejectFn);
    rs.pipe(gz);

    gz.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        while (true) {
          // 不足一个 header 就停,等下一波
          if (buf.length < TAR_BLOCK) return;

          // 探测零块
          if (isZeroBlock(buf.subarray(0, TAR_BLOCK))) {
            zeroBlockCount++;
            buf = buf.subarray(TAR_BLOCK);
            if (zeroBlockCount >= 2) {
              // 结束——把流也消费掉
              rs.destroy();
              resolveFn(totalBytes);
              return;
            }
            continue;
          }
          zeroBlockCount = 0;

          const header = buf.subarray(0, TAR_BLOCK);
          const name = parseName(header);
          const size = parseOctal(header.subarray(124, 136));
          const typeFlag = String.fromCharCode(header[156] ?? 0x30);

          // 拒绝特殊文件(symlink/字符/块设备/管道),简单起见一律跳过
          if (
            typeFlag === '1' ||
            typeFlag === '2' ||
            typeFlag === '3' ||
            typeFlag === '4' ||
            typeFlag === '5' ||
            typeFlag === '6'
          ) {
            // 切掉 header + size + padding
            const need = TAR_BLOCK + size + padOf(size);
            if (buf.length < need) return;
            buf = buf.subarray(need);
            continue;
          }

          // 普通文件 / 目录条目
          buf = buf.subarray(TAR_BLOCK);

          // 探测顶层目录(GitHub tarball 第一个 entry 形如 'owner-repo-sha/')
          if (topLevelPrefix === null && name) {
            const parts = name.split('/');
            if (parts.length > 0 && parts[0]) topLevelPrefix = parts[0]!;
          }

          const rel = stripTopLevel(name, topLevelPrefix);
          if (!rel || rel.endsWith('/')) {
            // 空目录条目;跳过 size + padding
            if (buf.length < size + padOf(size)) return;
            buf = buf.subarray(size + padOf(size));
            continue;
          }

          // 安全校验
          if (rel.includes('..') || rel.startsWith('/')) {
            if (buf.length < size + padOf(size)) return;
            buf = buf.subarray(size + padOf(size));
            continue;
          }
          const outPath = normalize(join(targetDir, rel));
          const normOut = normalize(targetDir);
          if (!outPath.startsWith(normOut + sep) && outPath !== normOut) {
            if (buf.length < size + padOf(size)) return;
            buf = buf.subarray(size + padOf(size));
            continue;
          }

          // 需要 size 字节数据
          if (buf.length < size) return;
          const dataBytes = size > 0 ? buf.subarray(0, size) : Buffer.alloc(0);
          buf = buf.subarray(size + padOf(size));

          mkdirSync(dirname(outPath), { recursive: true });
          if (size > 0) {
            writeFileSync(outPath, dataBytes);
            totalBytes += dataBytes.length;
          } else {
            // size = 0 的文件,占位
            writeFileSync(outPath, Buffer.alloc(0));
          }
        }
      } catch (e) {
        rejectFn(e);
      }
    });

    gz.on('end', () => {
      // gunzip 正常结束,正常返回累计字节
      resolveFn(totalBytes);
    });
  });
}

function padOf(n: number): number {
  return (TAR_BLOCK - (n % TAR_BLOCK)) % TAR_BLOCK;
}

function isZeroBlock(b: Buffer): boolean {
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 0) return false;
  }
  return true;
}

/**
 * USTAR 名称解析:name(100 字节)+ prefix(155 字节)
 * 名字 > 100 字节时,用 prefix + '/' + name(UStar 模式)
 */
export function parseName(header: Buffer): string {
  const name = header.subarray(0, 100).toString('utf8').replace(/\0+$/, '');
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0+$/, '');
  if (prefix) return `${prefix}/${name}`;
  return name;
}

export function parseOctal(buf: Buffer): number {
  // tar 数字格式可以是 "0001234\0" 或 "0001234 "(空格填充)
  const s = buf.toString('utf8').replace(/\0+$/, '').replace(/\s+$/, '');
  const n = parseInt(s, 8);
  return Number.isFinite(n) ? n : 0;
}

export function stripTopLevel(name: string, top: string | null): string {
  if (!top) return name;
  if (!name.startsWith(top + '/')) return name;
  return name.slice(top.length + 1);
}

/* -------------------------------------------------------------------------- */
/*                          统计 + checksum(与 git-clone.service 共用约定)     */
/* -------------------------------------------------------------------------- */

const LOC_EXTENSIONS = new Set(['.cs', '.cshtml', '.csproj', '.sln', '.vb', '.aspx', '.ascx']);

export function walkAndCount(dir: string): {
  fileCount: number;
  locCount: number;
  sizeBytes: number;
} {
  let fileCount = 0;
  let locCount = 0;
  let sizeBytes = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: Array<{
      name: string;
      isFile: () => boolean;
      isDirectory: () => boolean;
    }>;
    try {
      entries = readdirSync(cur, { withFileTypes: true }) as unknown as Array<{
        name: string;
        isFile: () => boolean;
        isDirectory: () => boolean;
      }>;
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === '.git') continue;
      const full = join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      fileCount++;
      try {
        const st = statSync(full);
        sizeBytes += st.size;
        if (st.size <= 1024 * 1024) {
          const dotIdx = ent.name.lastIndexOf('.');
          const ext = dotIdx >= 0 ? '.' + ent.name.slice(dotIdx + 1) : '';
          if (LOC_EXTENSIONS.has(ext)) {
            const buf = readFileText(full);
            for (let i = 0; i < buf.length; i++) {
              if (buf.charCodeAt(i) === 10) locCount++;
            }
            if (buf.length && buf.charCodeAt(buf.length - 1) !== 10) locCount++;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return { fileCount, locCount, sizeBytes };
}

function readFileText(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

export async function checksumDir(dir: string): Promise<string> {
  const h = createHash('sha256');
  const files: string[] = [];
  collectFiles(dir, '', files);
  files.sort();
  for (const rel of files) {
    h.update(rel);
    h.update('\0');
    const full = join(dir, rel);
    try {
      h.update(readFileSync(full));
    } catch {
      /* skip unreadable */
    }
    h.update('\0');
  }
  return h.digest('hex');
}

function collectFiles(dir: string, rel: string, out: string[]): void {
  let entries: Array<{
    name: string;
    isFile: () => boolean;
    isDirectory: () => boolean;
  }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as unknown as Array<{
      name: string;
      isFile: () => boolean;
      isDirectory: () => boolean;
    }>;
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === '.git') continue;
    const childRel = rel ? `${rel}${sep}${ent.name}` : ent.name;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      collectFiles(full, childRel, out);
    } else if (ent.isFile()) {
      out.push(childRel);
    }
  }
}

// 抑制 GitCloneError 类型未使用警告(在 throw 里用到,但 export 类型也有定义)
export type { GitCloneErrorCode };
