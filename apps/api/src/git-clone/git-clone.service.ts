/**
 * §5.7 真接 git clone —— 本地 child_process 调 `git` CLI
 *
 * 设计要点:
 * - HTTPS token:URL 注入 `https://user:token@host/path`(git 自己处理)
 * - SSH key:写到 os.tmpdir() 临时文件 + GIT_SSH_COMMAND 指过去
 *   (不接 ssh-agent,Phase 2+ 再做)
 * - `--depth=1` 默认拉 shallow(快);带 `ref` 时拉对应分支
 * - 5 分钟超时(MVP 经验值,仓库超大走 ENOSPC)
 * - 错误分类:401/403/ETIMEDOUT/ENOTFOUND/ENOSPC/128
 *   (映射成可被前端展示的 code + message)
 *
 * 依赖:仅 node 内置(`node:child_process` / `node:fs` / `node:os` / `node:path` / `node:crypto`)
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, like, or } from 'drizzle-orm';

import { decryptSecret, getMasterKey } from '../common/crypto.util.js';
import { DATABASE, type Db } from '../db/database.module.js';
import { gitCredentials } from '../db/schema.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DownloadTarballResult, GitHubService } from './github.service.js'; // runtime ref (NestJS DI 反射需要运行时类型元数据,import type 会被 ESM 擦除导致 DI 找不到 provider)

const execFileAsync = promisify(execFile) as (
  file: string,
  args: string[],
  opts: { timeout: number; env: NodeJS.ProcessEnv; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

export type GitCloneErrorCode =
  | 'NO_CREDENTIAL'
  | 'AUTH_FAILED'
  | 'AUTH_FORBIDDEN'
  | 'NETWORK_UNREACHABLE'
  | 'TIMEOUT'
  | 'DISK_FULL'
  | 'INVALID_URL'
  | 'GIT_NOT_FOUND'
  // §5.7 from-github(github REST API)专用
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export class GitCloneError extends Error {
  constructor(
    public readonly code: GitCloneErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GitCloneError';
  }
}

export interface CloneRepoInput {
  sourceType: 'git';
  sourceRef: string; // 形如 `https://host/owner/repo.git#branch` 或 `git@host:owner/repo.git#branch`
  hostPattern?: string; // 显式指定用哪条凭证;不传则按 sourceRef 里的 host 匹配
  destDir: string; // 已经 mkdir 好的目标目录
  projectId?: string; // 用于 project scope 凭证过滤
  gitBin?: string; // 测试用,默认 'git'
  /** 单测可注入:替换 child_process.execFile */
  execImpl?: (
    file: string,
    args: string[],
    opts: { timeout: number; env: NodeJS.ProcessEnv; maxBuffer?: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  /** 单测可注入:替换临时文件写入(SSH key) */
  writeFileImpl?: (path: string, content: string, opts: { mode: number }) => void;
  /** 单测可注入:替换 chmod */
  chmodImpl?: (path: string, mode: number) => void;
  /** 单测可注入:返回的 SSH key path 默认是 os.tmpdir 拼文件名 */
  sshKeyPathImpl?: () => string;
}

export interface CloneRepoResult {
  clonedAt: number;
  fileCount: number;
  locCount: number;
  sizeBytes: number;
  checksum: string;
  ref: string | null; // 解析出的 branch/tag;null 表示没指定(HEAD)
}

/** 解析 `https://host/owner/repo.git#branch` / `git@host:owner/repo.git#branch` */
export function parseSourceRef(sourceRef: string): { url: string; ref: string | null } {
  const hashIdx = sourceRef.lastIndexOf('#');
  let url: string;
  let ref: string | null;
  if (hashIdx > 0) {
    url = sourceRef.slice(0, hashIdx);
    ref = sourceRef.slice(hashIdx + 1).trim() || null;
  } else {
    url = sourceRef.trim();
    ref = null;
  }
  if (!url) {
    throw new BadRequestException('sourceRef url is empty');
  }
  if (!/^https?:\/\//.test(url) && !/^[\w.-]+@[^:]+:.+/.test(url)) {
    throw new BadRequestException(
      `sourceRef url is not a supported git URL: ${url} (支持 https:// 或 git@host: 形式)`,
    );
  }
  return { url, ref };
}

export function injectHttpsToken(url: string, username: string, token: string): string {
  // url 形如 `https://github.com/owner/repo.git`
  // 注入后 `https://user:token@github.com/owner/repo.git`
  const m = url.match(/^(https?:\/\/)([^/]+)(\/.*)?$/);
  if (!m) {
    throw new BadRequestException(`invalid https url for token injection: ${url}`);
  }
  const [, scheme, host, path] = m;
  // 一次性 URL 编码 token 中的特殊字符(@ : / ? # 等)
  const encUser = encodeURIComponent(username);
  const encToken = encodeURIComponent(token);
  return `${scheme}${encUser}:${encToken}@${host}${path ?? ''}`;
}

/**
 * §5.7 Git Clone Service
 *
 * - cloneRepo:真正调 `git clone`,返回 fileCount/locCount/sizeBytes/checksum
 * - pullRepo:Phase 2 留接口(未实现,直接抛 NotImplemented)
 */
@Injectable()
export class GitCloneService {
  private readonly logger = new Logger(GitCloneService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly github?: GitHubService,
  ) {}

  /**
   * 找一条匹配 hostPattern 的活跃凭证(精确 > 通配符 `*`)
   * 不区分 scope:system + project(命中即用)
   */
  findCredentialByHostPattern(
    host: string,
    projectId?: string,
  ): {
    id: string;
    kind: 'ssh_key' | 'https_token';
    hostPattern: string;
    username: string | null;
    secret: string;
  } | null {
    // 先按精确 hostPattern 查
    const exact = this.db
      .select()
      .from(gitCredentials)
      .where(and(eq(gitCredentials.hostPattern, host), eq(gitCredentials.isActive, true)))
      .all() as Array<{
      id: string;
      kind: 'ssh_key' | 'https_token';
      hostPattern: string;
      username: string | null;
      secretEnc: string;
      scope: 'system' | 'project';
      projectId: string | null;
    }>;
    if (exact.length > 0) {
      // 优先 project scope 命中 projectId
      const projHit =
        projectId !== undefined
          ? exact.find((r) => r.scope === 'project' && r.projectId === projectId)
          : undefined;
      const row = projHit ?? exact[0]!;
      return this.decryptRow(row);
    }
    // 再查通配符 `*`
    const wild = this.db
      .select()
      .from(gitCredentials)
      .where(and(eq(gitCredentials.hostPattern, '*'), eq(gitCredentials.isActive, true)))
      .all() as Array<{
      id: string;
      kind: 'ssh_key' | 'https_token';
      hostPattern: string;
      username: string | null;
      secretEnc: string;
      scope: 'system' | 'project';
      projectId: string | null;
    }>;
    if (wild.length === 0) return null;
    const projHit =
      projectId !== undefined
        ? wild.find((r) => r.scope === 'project' && r.projectId === projectId)
        : undefined;
    const row = projHit ?? wild[0]!;
    return this.decryptRow(row);
  }

  async cloneRepo(input: CloneRepoInput): Promise<CloneRepoResult> {
    const { url, ref } = parseSourceRef(input.sourceRef);

    // 提取 host(用于凭证匹配)
    const host = extractHost(url);

    // 决定用哪条凭证
    const explicitHost = input.hostPattern;
    let cred: ReturnType<GitCloneService['findCredentialByHostPattern']> | null = null;
    if (explicitHost) {
      cred = this.findCredentialByHostPattern(explicitHost, input.projectId);
      if (!cred) {
        throw new GitCloneError(
          'NO_CREDENTIAL',
          `未找到 hostPattern="${explicitHost}" 的凭证,请先在 §5.7 Git Credentials 中创建`,
        );
      }
    } else if (host) {
      cred = this.findCredentialByHostPattern(host, input.projectId);
    }

    // 准备 exec env + args
    const env: NodeJS.ProcessEnv = { ...process.env };
    const args: string[] = ['clone', '--depth=1'];
    let effectiveUrl = url;
    let sshKeyCleanup: (() => void) | null = null;

    if (cred?.kind === 'https_token') {
      if (!cred.username) {
        throw new GitCloneError('AUTH_FAILED', `https_token 凭证 ${cred.id} 缺少 username`);
      }
      effectiveUrl = injectHttpsToken(url, cred.username, cred.secret);
    } else if (cred?.kind === 'ssh_key') {
      const keyPath = (input.sshKeyPathImpl ?? defaultSshKeyPath)();
      const writeFile = input.writeFileImpl ?? writeFileSync;
      const chmod = input.chmodImpl ?? chmodSync;
      writeFile(keyPath, cred.secret, { mode: 0o600 });
      try {
        chmod(keyPath, 0o600);
      } catch {
        /* Windows 上 chmod 无效,git 自己会用 ACL,忽略 */
      }
      // 禁用 host key 检查 + 严格 host key(避免交互)
      env['GIT_SSH_COMMAND'] =
        `ssh -i "${keyPath}" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=NUL`;
      sshKeyCleanup = () => {
        try {
          rmSync(keyPath, { force: true });
        } catch {
          /* ignore */
        }
      };
    }
    // 不带凭证也能 clone 公开仓库(anonymous)
    if (ref) args.push('--branch', ref);
    args.push(effectiveUrl, input.destDir);

    const exec = input.execImpl ?? defaultExec;
    const gitBin = input.gitBin ?? 'git';
    const TIMEOUT_MS = 5 * 60 * 1000;

    try {
      // 先确保 destDir 父目录存在(drizzle 不会自动 mkdir)
      const parent = join(input.destDir, '..');
      mkdirSync(parent, { recursive: true });
      // 清理 destDir(可能上次失败残留)
      if (existsSync(input.destDir)) {
        rmSync(input.destDir, { recursive: true, force: true });
      }
      mkdirSync(input.destDir, { recursive: true });

      await exec(gitBin, args, { timeout: TIMEOUT_MS, env, maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      sshKeyCleanup?.();
      throw mapExecError(e);
    }
    sshKeyCleanup?.();

    // 统计
    const { fileCount, locCount, sizeBytes } = walkAndCount(input.destDir);
    const checksum = await checksumDir(input.destDir);
    return {
      clonedAt: Date.now(),
      fileCount,
      locCount,
      sizeBytes,
      checksum,
      ref,
    };
  }

  /** Phase 2 占位 */
  async pullRepo(_input: { sourceRef: string; destDir: string }): Promise<never> {
    throw new GitCloneError('UNKNOWN', 'pullRepo 尚未实现(Phase 2)');
  }

  /**
   * §5.7 真接 GitHub tarball API —— 委托给 GitHubService
   * 保留这个薄壳以保持 code-versions.service 对 GitCloneService 的单一依赖入口
   */
  async downloadFromGitHub(input: {
    owner: string;
    repo: string;
    ref?: string;
    hostPattern?: string;
    destDir: string;
    projectId?: string;
  }): Promise<DownloadTarballResult> {
    if (!this.github) {
      throw new GitCloneError(
        'UNKNOWN',
        'GitHubService 未注入(单测路径);生产环境通过 CodeVersionsModule → GitCloneModule 自动注入',
      );
    }
    return this.github.downloadTarball(input);
  }

  private decryptRow(row: {
    id: string;
    kind: 'ssh_key' | 'https_token';
    hostPattern: string;
    username: string | null;
    secretEnc: string;
  }): {
    id: string;
    kind: 'ssh_key' | 'https_token';
    hostPattern: string;
    username: string | null;
    secret: string;
  } {
    return {
      id: row.id,
      kind: row.kind,
      hostPattern: row.hostPattern,
      username: row.username,
      secret: decryptSecret(row.secretEnc, getMasterKey()),
    };
  }
}

/* -------------------------------------------------------------------------- */
/*                          helper functions                                  */
/* -------------------------------------------------------------------------- */

function defaultSshKeyPath(): string {
  const name = `audit-git-key-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  return join(tmpdir(), name);
}

function defaultExec(
  file: string,
  args: string[],
  opts: { timeout: number; env: NodeJS.ProcessEnv; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, opts);
}

function extractHost(url: string): string | null {
  const httpsM = url.match(/^https?:\/\/([^/]+)/);
  if (httpsM && httpsM[1]) {
    // 去掉可能的 userinfo(`https://user:token@host/...` 不会出现,因为还没注入)
    return httpsM[1].split('@').pop() ?? null;
  }
  const sshM = url.match(/^[\w.-]+@([^:]+):/);
  if (sshM && sshM[1]) return sshM[1];
  return null;
}

function mapExecError(e: unknown): GitCloneError {
  // execFile 失败时,err.message 形如 `Command failed: git ...\n...stderr...`
  // err.code 可能是 'ENOENT' / 'ETIMEDOUT' / 'ENOSPC'
  // stderr 含 "401" / "403" / "Could not resolve host" / "Repository not found"
  const err = e as {
    code?: string;
    signal?: string;
    message?: string;
    stderr?: string;
    stdout?: string;
  };
  const stderr = (err.stderr ?? '') + '\n' + (err.message ?? '');
  const low = stderr.toLowerCase();

  if (err.code === 'ENOENT' && /git/i.test(err.message ?? '')) {
    return new GitCloneError(
      'GIT_NOT_FOUND',
      '系统未安装 git CLI(本平台用本机 git 二进制;§11 Q11)',
      e,
    );
  }
  if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
    return new GitCloneError('TIMEOUT', 'git clone 超时(>5 分钟),请重试或换更快网络', e);
  }
  if (err.code === 'ENOSPC') {
    return new GitCloneError('DISK_FULL', '磁盘空间不足(ENOSPC)', e);
  }
  if (/authentication failed|bad credentials|401|invalid username or password/i.test(low)) {
    return new GitCloneError('AUTH_FAILED', '凭证认证失败(401),请检查 token/SSH key', e);
  }
  if (/access denied|forbidden|403|permission denied/i.test(low)) {
    return new GitCloneError('AUTH_FORBIDDEN', '凭证被拒(403/无权限),请检查仓库访问权', e);
  }
  if (/could not resolve host|getaddrinfo|enotfound|network is unreachable/i.test(low)) {
    return new GitCloneError('NETWORK_UNREACHABLE', '网络不可达,请检查 DNS/代理/防火墙', e);
  }
  if (/repository .* not found|not found/i.test(low) && /git/i.test(low)) {
    return new GitCloneError('AUTH_FAILED', `仓库不存在或无访问权:${extractRepoName(stderr)}`, e);
  }
  // exit code 128 是 git 通用的"操作失败"
  if (/exit code 128/i.test(err.message ?? '')) {
    return new GitCloneError(
      'UNKNOWN',
      `git clone 失败(exit 128):${stderr.split('\n').slice(-3).join(' | ')}`,
      e,
    );
  }
  return new GitCloneError('UNKNOWN', `git clone 失败:${stderr.slice(-300)}`, e);
}

function extractRepoName(stderr: string): string {
  const m = stderr.match(/'(.+?)'/);
  return m?.[1] ?? 'unknown';
}

const LOC_EXTENSIONS = new Set(['.cs', '.cshtml', '.csproj', '.sln', '.vb', '.aspx', '.ascx']);

interface WalkResult {
  fileCount: number;
  locCount: number;
  sizeBytes: number;
}

function walkAndCount(dir: string): WalkResult {
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
      size: number;
    }>;
    try {
      entries = readdirSync(cur, { withFileTypes: true }) as unknown as Array<{
        name: string;
        isFile: () => boolean;
        isDirectory: () => boolean;
        size: number;
      }>;
    } catch {
      continue;
    }
    for (const ent of entries) {
      // 忽略 .git 目录的统计(它不是源码,也不需要 LOC)
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
        /* ignore single file stat error */
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

async function checksumDir(dir: string): Promise<string> {
  // 对目录下所有文件按相对路径排序,拼接路径 + 内容,做 SHA-256
  // 这样能稳定反映"仓库内容"且不依赖文件系统时间戳
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
  let entries: Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean }>;
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

// 抑制 unused-like 警告
void like;
void or;
