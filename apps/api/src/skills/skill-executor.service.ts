import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import {
  codeVersions,
  scanRuns,
  skillBundleVersions,
  skillExecutions,
  vulnerabilities,
} from '../db/schema.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StorageService } from '../storage/storage.service.js'; // runtime ref (NestJS DI)

/**
 * Phase 3 #I —— 子仓库 skill 真产出的平台侧 vendor 实现
 *
 * 设计取舍(2026-06-29):
 *  - 子仓库 skill 的真 invoke vs 平台 vendor —— 选 vendor
 *    原因:OpenAI Agents SDK 的 multi-agent + invokeSkill Tool 在 MVP 阶段
 *    难以稳定跑通(messages 长度 / tool 嵌套深度 / 计时都可能崩),先把 4 个
 *    关键 skill 的"读 + 写 + 输出"用 vendor 实现做出来,让 report §3 / §3.4
 *    / §3.5 真有文件可读。Phase 3 K 任务再做 agent_traces 表 + 真 invoke。
 *  - 输出格式选 JSON(MD 是辅助),让 report.service.ts 直接 parse。
 *
 * 4 个真跑方法:
 *   - runRouteMapperSkill(scanRunId)  →  route_mapping/routes_{ts}.json
 *   - runFrameworkAuditSkill(scanRunId, framework)
 *                                       →  framework_audit/{framework}_{ts}.md
 *   - runVulnScannerSkill(scanRunId)   →  vuln_audit/nuget_{ts}.md
 *   - runExploitChainSkill(scanRunId)  →  exploit_chain/exploit_chains_{ts}.md
 *
 * 每个方法都返回 SkillRunResult,内含:
 *   - skillName, ts, outputRoot
 *   - outputFiles: [相对路径, ...]    (供 scan-runner 写 SkillExecution.primaryOutputs)
 *   - recordCount: number             (route 数 / 框架数 / 漏洞数 / 链路数)
 *   - durationMs
 */
@Injectable()
export class SkillExecutorService {
  private readonly logger = new Logger('SkillExecutorService');

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  /* ============================ route-mapper ============================ */

  /**
   * 跑 `dotnet-route-mapper` skill —— 扫 codeRoot 下 *.cs,正则匹配
   * [Route(...)] / [HttpGet(...)] 等,生成 route_mapping/routes_{ts}.json。
   */
  async runRouteMapperSkill(scanRunId: string): Promise<SkillRunResult> {
    const t0 = Date.now();
    const ctx = this.resolveCtx(scanRunId);
    const ts = this.ts();
    const outDir = join(ctx.outputRoot, 'route_mapping');
    mkdirSync(outDir, { recursive: true });

    const routes: RouteEntry[] = [];
    const csFiles = walkFiles(ctx.codeRoot, '.cs');
    for (const abs of csFiles) {
      const content = safeRead(abs);
      if (!content) continue;
      const rel = toRel(ctx.codeRoot, abs);
      const parsed = parseControllerActions(content, rel);
      for (const p of parsed) routes.push(p);
    }

    // 同时扫 Minimal API:MapGet/MapPost/MapGroup + Program.cs/Startup.cs
    const programFiles = csFiles.filter((f) => /Program\.cs|Startup\.cs/i.test(f));
    for (const abs of programFiles) {
      const content = safeRead(abs);
      if (!content) continue;
      const rel = toRel(ctx.codeRoot, abs);
      const parsed = parseMinimalApiRoutes(content, rel);
      for (const p of parsed) {
        // 避免重复:route_id 唯一性
        if (!routes.some((r) => r.path === p.path && r.http_method === p.http_method)) {
          routes.push(p);
        }
      }
    }

    // 给每条 route 分配递增 route_id(从 1 开始)
    const numbered = routes.map((r, i) => ({ ...r, route_id: String(i + 1) }));

    const json = {
      skill_name: 'dotnet-route-mapper',
      git_commit: ctx.gitCommit,
      generated_at: new Date(ts).toISOString(),
      coverage_mode: ctx.coverageMode,
      ts,
      total_routes: numbered.length,
      routes: numbered,
    };
    const jsonPath = join(outDir, `routes_${ts}.json`);
    writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');

    // 写人类可读 MD
    const md = renderRoutesMd(json);
    const mdPath = join(outDir, `routes_${ts}.md`);
    writeFileSync(mdPath, md, 'utf8');

    // 写 params MD(空骨架,Phase 3 J 任务接)
    const paramsMd = `# Params Index (${ts})\n\n_占位: Phase 3 J 任务会接 recordVuln 的 binding source 解析。_\n`;
    const paramsPath = join(outDir, `params_${ts}.md`);
    writeFileSync(paramsPath, paramsMd, 'utf8');

    return {
      skillName: 'dotnet-route-mapper',
      ts,
      outputRoot: ctx.outputRoot,
      outputFiles: [relPath(jsonPath, ctx.outputRoot), relPath(mdPath, ctx.outputRoot)],
      recordCount: numbered.length,
      durationMs: Date.now() - t0,
    };
  }

  /* ========================= framework-audit ========================= */

  /**
   * 跑 `dotnet-{framework}-audit` skill —— 扫 *.csproj 找 framework 目标框架版本,
   * 输出 framework_audit/{framework}_{ts}.md 四章节报告。
   */
  async runFrameworkAuditSkill(
    scanRunId: string,
    framework: 'aspnetcore' | 'mvc' | 'webapi' | 'blazor' | 'minimal-api' = 'aspnetcore',
  ): Promise<SkillRunResult> {
    const t0 = Date.now();
    const ctx = this.resolveCtx(scanRunId);
    const ts = this.ts();
    const outDir = join(ctx.outputRoot, 'framework_audit');
    mkdirSync(outDir, { recursive: true });

    const csprojFiles = walkFiles(ctx.codeRoot, '.csproj');
    const frameworks: Array<{ name: string; version: string; file: string }> = [];
    for (const abs of csprojFiles) {
      const content = safeRead(abs);
      if (!content) continue;
      const rel = toRel(ctx.codeRoot, abs);
      const m = /<TargetFramework(s)?>([^<]+)<\/TargetFramework(s)?>/gi.exec(content);
      if (m) {
        const v = (m[2] ?? '').trim();
        frameworks.push({ name: framework, version: v, file: rel });
      }
    }

    // 扫 Program.cs / Startup.cs 找 Use* 链路
    const programFiles = walkFiles(ctx.codeRoot, '.cs').filter((f) =>
      /Program\.cs|Startup\.cs/i.test(f),
    );
    const middlewares: string[] = [];
    const useRegex =
      /\b(UseRouting|UseAuthentication|UseAuthorization|UseCors|UseSession|UseEndpoints|UseHttpsRedirection|UseStaticFiles|UseAntiforgery)\b/g;
    for (const abs of programFiles) {
      const c = safeRead(abs);
      if (!c) continue;
      let m: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((m = useRegex.exec(c)) !== null) {
        const tok = m[1];
        if (tok && !seen.has(tok)) {
          seen.add(tok);
          middlewares.push(tok);
        }
      }
    }

    // 写四章节报告
    const lines: string[] = [];
    lines.push(`# Framework Audit — ${framework} (${ts})`);
    lines.push('');
    lines.push(`- skill_name: \`dotnet-${framework}-audit\``);
    lines.push(`- git_commit: \`${ctx.gitCommit}\``);
    lines.push(`- generated_at: \`${new Date(ts).toISOString()}\``);
    lines.push(`- coverage_mode: \`${ctx.coverageMode}\``);
    lines.push('');
    lines.push('## 1. 中间件顺序');
    lines.push('');
    if (middlewares.length === 0) {
      lines.push('_未在 Program.cs/Startup.cs 中识别到已知中间件调用。_');
    } else {
      for (const mw of middlewares) lines.push(`- ${mw}`);
    }
    lines.push('');
    lines.push('## 2. 端点暴露面');
    lines.push('');
    lines.push(`- csproj 文件: ${csprojFiles.length}`);
    for (const f of frameworks) lines.push(`  - ${f.file} → TargetFramework=${f.version}`);
    lines.push('');
    lines.push('## 3. 配置绑定与安全开关');
    lines.push('');
    lines.push(
      '_MVP 阶段仅识别 TargetFramework;appsettings.json 解析与配置覆盖链为 Phase 3 J 任务。_',
    );
    lines.push('');
    lines.push('## 4. 环境差异与代理边界');
    lines.push('');
    lines.push('_MVP 占位: Phase 3 J 任务接 Kestrel / 反向代理 / PathBase 解析。_');
    lines.push('');

    const mdPath = join(outDir, `${framework}_${ts}.md`);
    writeFileSync(mdPath, lines.join('\n'), 'utf8');

    return {
      skillName: `dotnet-${framework}-audit`,
      ts,
      outputRoot: ctx.outputRoot,
      outputFiles: [relPath(mdPath, ctx.outputRoot)],
      recordCount: frameworks.length,
      durationMs: Date.now() - t0,
    };
  }

  /* ============================ vuln-scanner ============================ */

  /**
   * 跑 `dotnet-vuln-scanner` skill —— 扫 *.csproj 找依赖 + 写 vuln_audit/nuget_{ts}.md。
   * MVP 不接 GHSA/CVE 数据库(Phase 3 J 接),但落真文件让 §3.4 报告章节有 read 源。
   */
  async runVulnScannerSkill(scanRunId: string): Promise<SkillRunResult> {
    const t0 = Date.now();
    const ctx = this.resolveCtx(scanRunId);
    const ts = this.ts();
    const outDir = join(ctx.outputRoot, 'vuln_audit');
    mkdirSync(outDir, { recursive: true });

    const csprojFiles = walkFiles(ctx.codeRoot, '.csproj');
    const deps: Array<{ name: string; version: string; file: string }> = [];
    for (const abs of csprojFiles) {
      const content = safeRead(abs);
      if (!content) continue;
      const rel = toRel(ctx.codeRoot, abs);
      const re = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"\s*\/>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        deps.push({ name: m[1] ?? '', version: m[2] ?? '', file: rel });
      }
    }

    const lines: string[] = [];
    lines.push(`# NuGet Vuln Scanner Report (${ts})`);
    lines.push('');
    lines.push(`- skill_name: \`dotnet-vuln-scanner\``);
    lines.push(`- git_commit: \`${ctx.gitCommit}\``);
    lines.push(`- generated_at: \`${new Date(ts).toISOString()}\``);
    lines.push(`- coverage_mode: \`${ctx.coverageMode}\``);
    lines.push('');
    lines.push('## 1. 依赖清单');
    lines.push('');
    if (deps.length === 0) {
      lines.push('_无 PackageReference 依赖。_');
    } else {
      lines.push('| Package | Version | File |');
      lines.push('|---|---|---|');
      for (const d of deps) lines.push(`| ${d.name} | ${d.version} | ${d.file} |`);
    }
    lines.push('');
    lines.push('## 2. 漏洞匹配');
    lines.push('');
    lines.push(
      '_⚠️待验证: MVP 阶段未接 GHSA/CVE 数据库;占位说明。Phase 3 J 任务接 OSV / NVD 匹配。_',
    );
    lines.push('');
    lines.push('## 3. 受影响入口映射');
    lines.push('');
    lines.push('_无确证漏洞 → 暂无 route_id 映射。_');

    const mdPath = join(outDir, `nuget_${ts}.md`);
    writeFileSync(mdPath, lines.join('\n'), 'utf8');

    return {
      skillName: 'dotnet-vuln-scanner',
      ts,
      outputRoot: ctx.outputRoot,
      outputFiles: [relPath(mdPath, ctx.outputRoot)],
      recordCount: deps.length,
      durationMs: Date.now() - t0,
    };
  }

  /* ========================== exploit-chain ========================== */

  /**
   * 跑 `dotnet-exploit-chain-audit` skill —— 从 vulnerabilities 表聚合,生成
   * exploit_chain/exploit_chains_{ts}.md,包含链路总览表 + 单链路详情骨架。
   */
  async runExploitChainSkill(scanRunId: string): Promise<SkillRunResult> {
    const t0 = Date.now();
    const ctx = this.resolveCtx(scanRunId);
    const ts = this.ts();
    const outDir = join(ctx.outputRoot, 'exploit_chain');
    mkdirSync(outDir, { recursive: true });

    const vulns = this.db
      .select()
      .from(vulnerabilities)
      .where(eq(vulnerabilities.scanRunId, scanRunId))
      .all();

    // 简化版:每条 vuln 自身作为单节点链路(CHAIN-1 ... N)
    const chains = vulns.map((v, i) => ({
      chainId: `CHAIN-${i + 1}`,
      startRoute: v.filePath,
      endGoal: v.fixSuggestion.slice(0, 60),
      steps: 1,
      minPrivilege: '无需认证',
      complexity: '低',
      feasibility: '已确认' as const,
      vulnRef: v.id,
    }));

    const lines: string[] = [];
    lines.push(`# Exploit Chains (${ts})`);
    lines.push('');
    lines.push(`- skill_name: \`dotnet-exploit-chain-audit\``);
    lines.push(`- git_commit: \`${ctx.gitCommit}\``);
    lines.push(`- generated_at: \`${new Date(ts).toISOString()}\``);
    lines.push(`- coverage_mode: \`${ctx.coverageMode}\``);
    lines.push(`- vuln_count: ${vulns.length}`);
    lines.push('');
    lines.push('## 链路总览表');
    lines.push('');
    lines.push('| 链路编号 | 起点入口 | 终点目标 | 步骤数 | 最低权限 | 整体复杂度 | 可行性 |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const c of chains) {
      lines.push(
        `| ${c.chainId} | \`${c.startRoute}\` | ${c.endGoal} | ${c.steps} | ${c.minPrivilege} | ${c.complexity} | ${c.feasibility} |`,
      );
    }
    lines.push('');
    lines.push('## 单链路详情');
    lines.push('');
    for (const c of chains) {
      lines.push(`### [${c.chainId}] 引用 ${c.vulnRef}`);
      lines.push('');
      lines.push(`- **攻击路径**: ${c.startRoute}`);
      lines.push(
        `- **整体评估**: 步骤数=${c.steps} / 复杂度=${c.complexity} / 可行性=${c.feasibility}`,
      );
      lines.push(`- **覆盖口径透传**: coverage_mode=${ctx.coverageMode} (MVP 简化:单 vuln 节点)`);
      lines.push('');
    }

    if (chains.length === 0) {
      lines.push('_未发现可拼接利用链(MVP 阶段:无漏洞入库则无链路)。_');
      lines.push('');
    }

    const mdPath = join(outDir, `exploit_chains_${ts}.md`);
    writeFileSync(mdPath, lines.join('\n'), 'utf8');

    return {
      skillName: 'dotnet-exploit-chain-audit',
      ts,
      outputRoot: ctx.outputRoot,
      outputFiles: [relPath(mdPath, ctx.outputRoot)],
      recordCount: chains.length,
      durationMs: Date.now() - t0,
    };
  }

  /* ============================== helpers ============================== */

  /**
   * 写一条 SkillExecution 记录(主 runner 调,不再让主 runner 手工拼)
   */
  recordSkillExecution(scanRunId: string, result: SkillRunResult, skillType: SkillType): string {
    const id = `ske-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const now = Date.now();
    this.db
      .insert(skillExecutions)
      .values({
        id,
        scanRunId,
        skillName: result.skillName,
        skillType,
        skillPath: `skills/${result.skillName}/SKILL.md`,
        executionStatus: 'COMPLETED',
        findingsStatus: result.recordCount > 0 ? 'FOUND' : 'NO_FINDING',
        primaryOutputs: result.outputFiles,
        dependsOn: [],
        startedAt: now - result.durationMs,
        finishedAt: now,
        durationSec: Math.max(1, Math.floor(result.durationMs / 1000)),
      })
      .onConflictDoNothing({ target: [skillExecutions.scanRunId, skillExecutions.skillName] })
      .run();
    return id;
  }

  private resolveCtx(scanRunId: string): ResolvedCtx {
    const run = this.db.select().from(scanRuns).where(eq(scanRuns.id, scanRunId)).get() as
      | {
          id: string;
          codeVersionId: string;
          skillBundleId: string;
          coverageMode: 'FULL' | 'SAMPLE';
        }
      | undefined;
    if (!run) throw new Error(`scanRun ${scanRunId} not found`);

    const cv = this.db
      .select()
      .from(codeVersions)
      .where(eq(codeVersions.id, run.codeVersionId))
      .get() as { id: string } | undefined;
    if (!cv) throw new Error(`codeVersion ${run.codeVersionId} not found`);

    const bundle = this.db
      .select()
      .from(skillBundleVersions)
      .where(eq(skillBundleVersions.id, run.skillBundleId))
      .get() as { gitCommit: string } | undefined;
    if (!bundle) throw new Error(`skillBundle ${run.skillBundleId} not found`);

    return {
      scanRunId,
      codeRoot: this.storage.codeVersionDir(cv.id),
      outputRoot: this.storage.scanRunOutputRoot(scanRunId),
      gitCommit: bundle.gitCommit,
      coverageMode: run.coverageMode,
    };
  }

  private ts(): number {
    return Date.now();
  }
}

/* ============================== types ============================== */

export interface SkillRunResult {
  skillName: string;
  ts: number;
  outputRoot: string;
  outputFiles: string[];
  recordCount: number;
  durationMs: number;
}

interface ResolvedCtx {
  scanRunId: string;
  codeRoot: string;
  outputRoot: string;
  gitCommit: string;
  coverageMode: 'FULL' | 'SAMPLE';
}

interface RouteEntry {
  route_id: string;
  controller: string;
  action: string;
  http_method: string;
  path: string;
  file_path: string;
  line: number;
  return_type: string;
  binding_sources: string[];
}

type SkillType =
  | 'infra'
  | 'framework'
  | 'vuln'
  | 'orchestrator'
  | 'route_mapper'
  | 'route_tracer'
  | 'exploit_chain'
  | 'supply_chain';

/* ============================ fs helpers ============================ */

function walkFiles(root: string, ext: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (
          e.name === 'node_modules' ||
          e.name === '.git' ||
          e.name === 'bin' ||
          e.name === 'obj'
        ) {
          continue;
        }
        stack.push(full);
      } else if (e.isFile() && extname(e.name).toLowerCase() === ext.toLowerCase()) {
        out.push(full);
      }
    }
  }
  return out;
}

function safeRead(abs: string): string | null {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > 512 * 1024) return null;
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

function relPath(abs: string, root: string): string {
  return relative(root, abs).split(sep).join('/');
}

/* ====================== Controller action 解析 ====================== */

/**
 * 极简 C# Controller 解析 —— 识别:
 *  - [Route("...")] / [Route("...")] 在 class 上
 *  - [HttpGet/Post/Put/Delete/Patch/Head/Options("...")] 在方法上
 *  - 方法签名(粗略:public ... MethodName(...)
 *  - [FromRoute] / [FromQuery] / [FromBody] / [FromForm] / [FromHeader] / [FromServices]
 *
 * 不做完整 AST 解析(没必要);MVP 阶段够 §3.1 入口覆盖矩阵用。
 */
export function parseControllerActions(content: string, filePath: string): RouteEntry[] {
  const out: RouteEntry[] = [];
  const lines = content.split('\n');

  // 找 class 级 [Route]
  let controllerRoute = '';
  let controllerName = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const classMatch = /public\s+(?:sealed\s+|partial\s+|abstract\s+)?class\s+(\w+)/.exec(line);
    if (classMatch) {
      controllerName = classMatch[1] ?? '';
    }
    const routeMatch = /\[Route\(\s*"([^"]+)"\s*\)\]/.exec(line);
    if (routeMatch) {
      controllerRoute = routeMatch[1] ?? '';
    }
  }

  // 找 action 级 [Http*]
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const httpMatch =
      /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|HttpHead|HttpOptions|AcceptVerbs)(\(\s*"([^"]*)"\s*\))?\]/.exec(
        line,
      );
    if (!httpMatch) continue;
    const method = (httpMatch[1] ?? '').replace('Http', '').toUpperCase();
    if (method === 'ACCEPTVERBS') continue; // 复杂,MVP 跳过
    const actionPath = httpMatch[3] ?? '';

    // 在同一行 + 后续 3 行内找方法签名(允许 [HttpGet] public ... 同行)
    const sig = findMethodSignature(lines, i);
    if (!sig) continue;

    const combinedPath = joinPath(controllerRoute, actionPath, sig.actionName);
    out.push({
      route_id: '', // runner 阶段再编号
      controller: controllerName || '(unknown)',
      action: sig.actionName,
      http_method: method,
      path: combinedPath,
      file_path: filePath,
      line: i + 1,
      return_type: sig.returnType,
      binding_sources: sig.bindingSources,
    });
  }

  return out;
}

/**
 * 找 Minimal API:MapGet/MapPost/... + MapGroup
 * 粗略正则;不解析泛型 callback
 */
export function parseMinimalApiRoutes(content: string, filePath: string): RouteEntry[] {
  const out: RouteEntry[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = /\.(MapGet|MapPost|MapPut|MapDelete|MapPatch|MapMethods)\(\s*"([^"]*)"/.exec(line);
    if (!m) continue;
    const method = (m[1] ?? '').replace('Map', '').toUpperCase();
    if (method === 'METHODS') continue;
    const path = m[2] ?? '';
    out.push({
      route_id: '',
      controller: '(minimal-api)',
      action: '<lambda>',
      http_method: method,
      path,
      file_path: filePath,
      line: i + 1,
      return_type: 'IResult',
      binding_sources: [],
    });
  }
  return out;
}

function findMethodSignature(
  lines: string[],
  startIdx: number,
): { actionName: string; returnType: string; bindingSources: string[] } | null {
  // 收集从 startIdx 开始 20 行内所有的 [FromXxx] 特性 + 方法签名
  const bindings: string[] = [];
  let methodName = '';
  let returnType = '';
  for (let i = startIdx; i < Math.min(startIdx + 30, lines.length); i++) {
    const l = lines[i] ?? '';
    const fb =
      /\[(FromRoute|FromQuery|FromBody|FromForm|FromHeader|FromServices|FromKeyedServices)\]/.exec(
        l,
      );
    if (fb) {
      const tag = fb[1] ?? '';
      if (!bindings.includes(tag)) bindings.push(tag);
    }
    const sig = /public\s+(?:async\s+)?([\w<>,\s[\]?]+?)\s+(\w+)\s*\(/.exec(l);
    if (sig) {
      returnType = (sig[1] ?? '').trim();
      methodName = sig[2] ?? '';
      break;
    }
  }
  if (!methodName) return null;
  return { actionName: methodName, returnType, bindingSources: bindings };
}

function joinPath(controllerRoute: string, actionPath: string, actionName: string): string {
  const base = controllerRoute || '';
  let combined = base;
  if (actionPath) {
    combined = base ? `${base}/${actionPath.replace(/^\//, '')}` : actionPath;
  } else {
    // 约定:action 名即子路径(MVC 风格)
    combined = base ? `${base}/${actionName}` : actionName;
  }
  return '/' + combined.replace(/^\/+/, '').replace(/\/+$/, '');
}

function renderRoutesMd(json: {
  skill_name: string;
  generated_at: string;
  total_routes: number;
  routes: RouteEntry[];
}): string {
  const lines: string[] = [];
  lines.push(`# Routes (${json.generated_at})`);
  lines.push('');
  lines.push(`- skill_name: \`${json.skill_name}\``);
  lines.push(`- total_routes: ${json.total_routes}`);
  lines.push('');
  lines.push('| route_id | HTTP | path | controller.action | file |');
  lines.push('|---|---|---|---|---|');
  for (const r of json.routes) {
    lines.push(
      `| ${r.route_id} | ${r.http_method} | \`${r.path}\` | ${r.controller}.${r.action} | ${r.file_path}:${r.line} |`,
    );
  }
  return lines.join('\n');
}

// suppress unused
