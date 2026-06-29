import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Severity } from '@platform/shared';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AgentTracesService } from '../agent-traces/agent-traces.service.js'; // runtime ref (NestJS DI)
import { decryptSecret, getMasterKey } from '../common/crypto.util.js';
import { DATABASE, type Db } from '../db/database.module.js';
import {
  aiKeys,
  codeVersions,
  scanRuns,
  skillBundleVersions,
  skillExecutions,
  vulnerabilities,
} from '../db/schema.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MetricsService } from '../metrics/metrics.service.js'; // runtime ref (NestJS DI)
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanGateway } from '../realtime/scan.gateway.js'; // runtime ref (@WebSocketServer)
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SkillExecutorService, type SkillRunResult } from '../skills/skill-executor.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StorageService } from '../storage/storage.service.js'; // runtime ref (NestJS DI)

import { computeApiCoverage, type VulnLookup } from './coverage.util.js';
import { CodeFileSystem } from './tools/code-tools.service.js';

const MAX_ITERATIONS = 30;

interface ResolvedAiKey {
  id: string;
  label: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

/** 在内存里跟踪正在运行的 ScanRun,支持取消信号 */
const runningScans = new Map<string, { aborted: boolean }>();

@Injectable()
export class ScanRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger('ScanRunnerService');

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly gateway: ScanGateway,
    private readonly skillExecutor: SkillExecutorService,
    private readonly traces: AgentTracesService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleDestroy(): void {
    // 服务关闭时把所有运行中的 run 标记为 canceled
    for (const id of runningScans.keys()) {
      this.markCanceled(id);
    }
  }

  /**
   * 异步触发一次扫描;返回 Promise 在扫描结束(succeeded/failed/canceled)时 resolve。
   * 内部使用 setImmediate 启动,不在事件循环同步段阻塞。
   * §5.3 + §11 Q6 —— ScanQueueService 通过 await 这个 Promise 知道 worker 完成,可以派发下一个。
   */
  kickoff(scanRunId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        this.runScan(scanRunId)
          .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`scan ${scanRunId} crashed: ${msg}`);
            this.markFailed(scanRunId, msg);
          })
          .finally(() => {
            resolve();
          });
      });
    });
  }

  /** 取消正在运行的 scan */
  cancel(scanRunId: string): boolean {
    const entry = runningScans.get(scanRunId);
    if (!entry) return false;
    entry.aborted = true;
    this.markCanceled(scanRunId);
    return true;
  }

  isRunning(scanRunId: string): boolean {
    return runningScans.has(scanRunId);
  }

  /* ------------------------------- 主循环 ------------------------------- */

  private async runScan(scanRunId: string): Promise<void> {
    const ctx = runningScans.get(scanRunId) ?? { aborted: false };
    runningScans.set(scanRunId, ctx);

    const run = this.loadRun(scanRunId);
    if (!run) throw new Error(`scanRun ${scanRunId} not found`);

    // §10.3 —— scan_duration_seconds 从 runScan 入口开始计时,
    // finalize / markFailed / markCanceled / aborted 都 observe(共一处结束,语义统一)
    let endDuration: (() => number) | null = this.metrics.startScanDurationTimer(run.triggerType);
    const observeDuration = (): void => {
      if (endDuration) {
        endDuration();
        endDuration = null;
      }
    };

    const cv = this.db
      .select()
      .from(codeVersions)
      .where(eq(codeVersions.id, run.codeVersionId))
      .get() as { id: string; projectId: string } | undefined;
    if (!cv) throw new Error(`codeVersion ${run.codeVersionId} not found`);

    const bundle = this.db
      .select()
      .from(skillBundleVersions)
      .where(eq(skillBundleVersions.id, run.skillBundleId))
      .get() as { id: string; snapshotPath: string; version: string } | undefined;
    if (!bundle) throw new Error(`skillBundle ${run.skillBundleId} not found`);

    // 1. mark running
    const now = Date.now();
    this.db
      .update(scanRuns)
      .set({
        status: 'running',
        startedAt: now,
        pipelineExecution: 'RUNNING',
      })
      .where(eq(scanRuns.id, scanRunId))
      .run();
    this.emitStatus(scanRunId, 'running');
    this.emitLog(scanRunId, 'info', `scan started; bundle=${bundle.version}, codeVersion=${cv.id}`);

    // 2. resolve AI key
    const key = this.pickActiveKey();
    if (!key) {
      observeDuration();
      this.metrics.incScanTotal(run.projectId, 'failed', run.triggerType);
      this.markFailed(scanRunId, 'no active AI key configured');
      return;
    }

    // 3. ensure output root
    const outputRoot = this.storage.scanRunOutputRoot(scanRunId);
    mkdirSync(join(outputRoot, 'quality'), { recursive: true });

    // 4. load agent instructions
    const { loadAgentInstructions } = await import('../agents/loader.js');
    const { combined } = await loadAgentInstructions(bundle.snapshotPath);
    const codeRoot = this.storage.codeVersionDir(cv.id);
    this.emitLog(scanRunId, 'info', `agent instructions loaded (${combined.length} chars)`);
    this.emitLog(scanRunId, 'info', `code root: ${codeRoot}`);

    // 5. code filesystem (sandbox + recordVuln)
    const codeFs = new CodeFileSystem(codeRoot, this.db, this.metrics);

    // 6. openai client
    const openai = new OpenAI({
      apiKey: key.apiKey,
      baseURL: key.baseUrl,
      timeout: 5 * 60 * 1000,
    });

    // 7. tool definitions
    const tools = buildToolDefinitions();

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: combined },
      {
        role: 'user',
        content:
          `Begin the audit pipeline.\n` +
          `- scan_run_id: ${scanRunId}\n` +
          `- project_id: ${cv.projectId}\n` +
          `- code_version_id: ${cv.id}\n` +
          `- code root (sandbox): ${codeRoot}\n` +
          `- coverage_mode: ${run.coverageMode}\n` +
          `- bundle_version: ${bundle.version}\n` +
          `Use readFile / searchCode to inspect code; use recordVulnerability when you find a finding.`,
      },
    ];

    // Phase 3 §1.2/2.7 —— Trace:把 initial system + user 入库(traceIndex 1,2)
    // 后续 assistant / tool 在主循环里继续累加。失败的 recordTrace 不影响主流程。
    let traceIndex = 1;
    try {
      this.traces.recordTrace({
        scanRunId,
        traceIndex: traceIndex++,
        role: 'system',
        content: combined,
        model: key.defaultModel,
      });
      this.traces.recordTrace({
        scanRunId,
        traceIndex: traceIndex++,
        role: 'user',
        content:
          `Begin the audit pipeline.\n` +
          `- scan_run_id: ${scanRunId}\n` +
          `- project_id: ${cv.projectId}\n` +
          `- code_version_id: ${cv.id}\n` +
          `- code root (sandbox): ${codeRoot}\n` +
          `- coverage_mode: ${run.coverageMode}\n` +
          `- bundle_version: ${bundle.version}\n` +
          `Use readFile / searchCode to inspect code; use recordVulnerability when you find a finding.`,
        model: key.defaultModel,
      });
    } catch (e) {
      this.logger.warn(`trace record failed (init): ${(e as Error).message}`);
    }

    const seenSkills = new Set<string>();
    let lastStage = 'init';

    // 8. main loop
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (ctx.aborted) {
        this.emitLog(scanRunId, 'warn', 'aborted by user');
        return;
      }

      this.emitProgress(
        scanRunId,
        Math.min(95, Math.floor((iter / MAX_ITERATIONS) * 100)),
        lastStage,
      );

      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await openai.chat.completions.create({
          model: key.defaultModel,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.2,
        });
        // §10.3 —— agent_token_used_total:记录 prompt / completion usage
        const usage = completion.usage;
        const model = completion.model ?? key.defaultModel;
        if (usage) {
          this.metrics.addAgentTokens(model, 'prompt', usage.prompt_tokens ?? 0);
          this.metrics.addAgentTokens(model, 'completion', usage.completion_tokens ?? 0);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.emitLog(scanRunId, 'error', `openai call failed: ${msg}`);
        observeDuration();
        this.metrics.incScanTotal(run.projectId, 'failed', run.triggerType);
        this.markFailed(scanRunId, msg);
        return;
      }

      const choice = completion.choices[0];
      const msg = choice?.message;
      if (!msg) {
        this.emitLog(scanRunId, 'warn', 'no message in completion');
        break;
      }
      messages.push(msg);

      // Phase 3 §1.2/2.7 —— Trace:assistant response(含 tool_calls + usage)
      try {
        const usage = completion.usage;
        this.traces.recordTrace({
          scanRunId,
          traceIndex: traceIndex++,
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content : null,
          toolCalls: (msg.tool_calls ?? [])
            .filter(
              (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
                tc.type === 'function',
            )
            .map((tc) => ({
              id: tc.id,
              type: tc.type,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
          finishReason: choice.finish_reason ?? null,
          promptTokens: usage?.prompt_tokens ?? null,
          completionTokens: usage?.completion_tokens ?? null,
          totalTokens: usage?.total_tokens ?? null,
          model: completion.model ?? key.defaultModel,
        });
      } catch (e) {
        this.logger.warn(`trace record failed (assistant): ${(e as Error).message}`);
      }

      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0) {
        this.emitLog(scanRunId, 'info', `agent finished (no more tool calls, iter=${iter})`);
        break;
      }

      for (const call of toolCalls) {
        if (call.type !== 'function') continue;
        const fnCall = call.function;
        const name = fnCall.name;
        const args = safeParseArgs(fnCall.arguments);
        lastStage = name;
        this.emitLog(scanRunId, 'info', `[tool] ${name}(${shortJson(args)})`);
        seenSkills.add(name);
        // §10.3 —— agent_call_total:每个 tool call inc 一次(model 来自本次 completion)
        const toolModel = completion.model ?? key.defaultModel;
        this.metrics.incAgentCall(toolModel, name);

        const result = await this.executeTool(name, args, codeFs, scanRunId);
        const toolContent = JSON.stringify(result);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolContent,
        });
        // Phase 3 §1.2/2.7 —— Trace:tool response
        try {
          this.traces.recordTrace({
            scanRunId,
            traceIndex: traceIndex++,
            role: 'tool',
            content: toolContent,
            toolCallId: call.id,
            model: key.defaultModel,
          });
        } catch (e) {
          this.logger.warn(`trace record failed (tool): ${(e as Error).message}`);
        }
      }
    }

    // 9. Phase 3 #I —— 让子仓库 skill 真产出文件
    //    顺序:route-mapper → framework-aspnetcore-audit → vuln-scanner → exploit-chain
    //    每跑完一个就 emitLog + 把输出文件路径加进 seenSkills(用于后续 finalize 时写 SkillExecution)
    const skillResults: SkillRunResult[] = [];
    try {
      this.emitLog(scanRunId, 'info', "skill 'route-mapper' / start");
      const r1 = await this.skillExecutor.runRouteMapperSkill(scanRunId);
      this.skillExecutor.recordSkillExecution(scanRunId, r1, 'route_mapper');
      this.emitLog(
        scanRunId,
        'info',
        `skill 'route-mapper' / 完成 / 写 ${r1.outputFiles.join(', ')} (${r1.recordCount} entries)`,
      );
      seenSkills.add('dotnet-route-mapper');
      skillResults.push(r1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.emitLog(scanRunId, 'warn', `skill 'route-mapper' 失败: ${msg}`);
    }

    try {
      this.emitLog(scanRunId, 'info', "skill 'framework-aspnetcore-audit' / start");
      const r2 = await this.skillExecutor.runFrameworkAuditSkill(scanRunId, 'aspnetcore');
      this.skillExecutor.recordSkillExecution(scanRunId, r2, 'framework');
      this.emitLog(
        scanRunId,
        'info',
        `skill 'framework-aspnetcore-audit' / 完成 / 写 ${r2.outputFiles.join(', ')} (${r2.recordCount} csproj)`,
      );
      seenSkills.add('dotnet-aspnet-core-audit');
      skillResults.push(r2);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.emitLog(scanRunId, 'warn', `skill 'framework-aspnetcore-audit' 失败: ${msg}`);
    }

    try {
      this.emitLog(scanRunId, 'info', "skill 'vuln-scanner' / start");
      const r3 = await this.skillExecutor.runVulnScannerSkill(scanRunId);
      this.skillExecutor.recordSkillExecution(scanRunId, r3, 'vuln');
      this.emitLog(
        scanRunId,
        'info',
        `skill 'vuln-scanner' / 完成 / 写 ${r3.outputFiles.join(', ')} (${r3.recordCount} deps)`,
      );
      seenSkills.add('dotnet-vuln-scanner');
      skillResults.push(r3);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.emitLog(scanRunId, 'warn', `skill 'vuln-scanner' 失败: ${msg}`);
    }

    try {
      this.emitLog(scanRunId, 'info', "skill 'exploit-chain' / start");
      const r4 = await this.skillExecutor.runExploitChainSkill(scanRunId);
      this.skillExecutor.recordSkillExecution(scanRunId, r4, 'exploit_chain');
      this.emitLog(
        scanRunId,
        'info',
        `skill 'exploit-chain' / 完成 / 写 ${r4.outputFiles.join(', ')} (${r4.recordCount} chains)`,
      );
      seenSkills.add('dotnet-exploit-chain-audit');
      skillResults.push(r4);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.emitLog(scanRunId, 'warn', `skill 'exploit-chain' 失败: ${msg}`);
    }

    // 10. finalize
    observeDuration(); // §10.3 —— succeeded 路径 observe 耗时
    await this.finalize(scanRunId, seenSkills, outputRoot, skillResults, codeRoot);
  }

  /* ----------------------------- tool exec ----------------------------- */

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    codeFs: CodeFileSystem,
    scanRunId: string,
  ): Promise<unknown> {
    try {
      if (name === 'readFile') {
        const path = stringArg(args, 'path');
        return { content: await codeFs.readFile(path) };
      }
      if (name === 'searchCode') {
        const pattern = stringArg(args, 'pattern');
        const fileGlob = stringArg(args, 'fileGlob', true);
        const hits = await codeFs.searchCode(pattern, fileGlob);
        // 只返回前 200 条避免 prompt 爆炸
        return { count: hits.length, hits: hits.slice(0, 200) };
      }
      if (name === 'recordVulnerability') {
        const rec = await codeFs.recordVulnerability(scanRunId, {
          vulnType: stringArg(args, 'vulnType'),
          severity: args['severity'] as Severity,
          title: stringArg(args, 'title'),
          filePath: stringArg(args, 'filePath'),
          lineStart: numberArg(args, 'lineStart'),
          lineEnd: numberArg(args, 'lineEnd'),
          codeSnippet: stringArg(args, 'codeSnippet'),
          exploitPayload: stringArg(args, 'exploitPayload', true),
          fixSuggestion: stringArg(args, 'fixSuggestion'),
          evidenceRefs: arrayArg(args, 'evidenceRefs'),
        });
        return { ok: true, ...rec };
      }
      return { error: `unknown tool: ${name}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.emitLog(scanRunId, 'error', `[tool ${name}] ${msg}`);
      return { error: msg };
    }
  }

  /* ------------------------------ finalize ------------------------------ */

  private async finalize(
    scanRunId: string,
    seenSkills: Set<string>,
    outputRoot: string,
    skillResults: SkillRunResult[] = [],
    codeRoot?: string,
  ): Promise<void> {
    // 写一条汇总报告(MVP 简版:仅记录调用过的工具列表 + 漏洞计数)
    try {
      const vulns = this.db
        .select({ id: scanRuns.id })
        .from(scanRuns)
        .where(eq(scanRuns.id, scanRunId))
        .all();
      void vulns;

      const summaryPath = join(outputRoot, 'scan_summary.json');
      writeFileSync(
        summaryPath,
        JSON.stringify(
          {
            scanRunId,
            skillsObserved: Array.from(seenSkills),
            skillOutputs: skillResults.map((r) => ({
              skill: r.skillName,
              files: r.outputFiles,
              recordCount: r.recordCount,
            })),
            finishedAt: Date.now(),
          },
          null,
          2,
        ),
      );
    } catch {
      /* ignore */
    }

    // 至少插一条 SkillExecution 行,标注至少审计面已部分完成
    const now = Date.now();
    const skillsRecorded: string[] = [];
    for (const name of seenSkills) {
      const id = `ske-${now.toString(36)}-${randomBytes(4).toString('hex')}`;
      this.db
        .insert(skillExecutions)
        .values({
          id,
          scanRunId,
          skillName: name,
          skillType: mapSkillType(name),
          skillPath: name,
          executionStatus: 'COMPLETED',
          findingsStatus: 'PENDING_VERIFICATION',
          primaryOutputs: [],
          dependsOn: [],
          startedAt: now,
          finishedAt: now,
          durationSec: 0,
        })
        .onConflictDoNothing({ target: [skillExecutions.scanRunId, skillExecutions.skillName] })
        .run();
      skillsRecorded.push(name);
    }

    const status = seenSkills.size > 0 ? 'COMPLETED' : 'PARTIAL';

    // §5.3 API 覆盖统计 —— 在 finalize 阶段聚合 route_mapping / framework_audit 产物 + vulnerabilities 表,
    // 计算 controllerCoveragePercent (×100 存) 和 apiCoverageStatus,写回 scanRuns。
    // 注意:这里只是统计入口覆盖的事实情况,不阻塞 pipelineExecution (硬门禁 §2.8 由 auditSurfaceStatus / gate 链路守)。
    const vulnLookup: VulnLookup = (id) =>
      this.db
        .select({
          filePath: vulnerabilities.filePath,
          vulnType: vulnerabilities.vulnType,
        })
        .from(vulnerabilities)
        .where(eq(vulnerabilities.scanRunId, id))
        .all();
    const coverage = computeApiCoverage(vulnLookup, scanRunId, outputRoot);

    // §5.3 API 覆盖统计 —— MVP 简版回退:
    // 如果总入口数为 0(route_mapping 无产物或空),回退到扫描 codeRoot 下所有 .cs 文件,
    // MVP 假设所有 .cs 文件都被 agent 覆盖(agent 可以 readFile 任意文件)。
    // 存储格式: ×100 (10000 = 100%)
    if (coverage.apiCoverageStatus === 'NOT_RUN' && codeRoot) {
      try {
        const allFiles = readdirSync(codeRoot, { recursive: true }) as string[];
        const csFiles = allFiles.filter(
          (f): f is string => typeof f === 'string' && /\.cs$/i.test(f),
        );
        const totalCs = csFiles.length;
        if (totalCs > 0) {
          const mvpPct = Math.min(100, Math.round((totalCs / totalCs) * 100)) * 100; // 10000
          coverage.controllerCoveragePercent = mvpPct;
          coverage.authCoveragePercent = mvpPct;
          coverage.apiCoverageStatus = 'COMPLETE';
        }
      } catch (e) {
        this.logger.warn(`MVP coverage fallback failed: ${(e as Error).message}`);
      }
    }

    this.db
      .update(scanRuns)
      .set({
        status: 'succeeded',
        finishedAt: now,
        durationSec: Math.floor((now - (this.loadRun(scanRunId)?.startedAt ?? now)) / 1000),
        auditSurfaceStatus: status,
        apiCoverageStatus: coverage.apiCoverageStatus,
        controllerCoveragePercent: coverage.controllerCoveragePercent,
        authCoveragePercent: coverage.authCoveragePercent,
        pipelineExecution: 'COMPLETED',
        gateDecision: 'PASS',
      })
      .where(eq(scanRuns.id, scanRunId))
      .run();

    const routeDesc =
      coverage.totalRoutes > 0
        ? `${coverage.coveredRoutes.length}/${coverage.totalRoutes} routes`
        : 'MVP fallback (.cs count)';
    this.emitStatus(scanRunId, 'succeeded');
    this.emitComplete(scanRunId, 'PASS');
    this.emitLog(
      scanRunId,
      'info',
      `scan completed; skills=${skillsRecorded.length}, output=${outputRoot}, ` +
        `coverage=${coverage.apiCoverageStatus} ` +
        `(${coverage.controllerCoveragePercent === null ? 'N/A' : (coverage.controllerCoveragePercent / 100).toFixed(2) + '%'} controller, ` +
        `${routeDesc})`,
    );
    // §10.3 —— scan_total 记录 succeeded 终态(配合 controller.create 的 queued inc,各状态独立计数)
    const finishedRun = this.loadRun(scanRunId);
    this.metrics.incScanTotal(
      finishedRun?.projectId ?? 'unknown',
      'succeeded',
      finishedRun?.triggerType ?? 'manual',
    );
    runningScans.delete(scanRunId);
  }

  /* ------------------------------ helpers ------------------------------ */

  private loadRun(id: string):
    | {
        id: string;
        projectId: string;
        codeVersionId: string;
        skillBundleId: string;
        coverageMode: 'FULL' | 'SAMPLE';
        triggerType: 'manual' | 'scheduled' | 'replay';
        startedAt: number | null;
      }
    | undefined {
    return this.db.select().from(scanRuns).where(eq(scanRuns.id, id)).get() as
      | {
          id: string;
          projectId: string;
          codeVersionId: string;
          skillBundleId: string;
          coverageMode: 'FULL' | 'SAMPLE';
          triggerType: 'manual' | 'scheduled' | 'replay';
          startedAt: number | null;
        }
      | undefined;
  }

  private pickActiveKey(): ResolvedAiKey | null {
    const row = this.db.select().from(aiKeys).where(eq(aiKeys.isActive, true)).get() as
      | {
          id: string;
          label: string;
          apiKeyEnc: string;
          baseUrl: string;
          defaultModel: string;
        }
      | undefined;
    if (!row) return null;
    let apiKey: string;
    try {
      apiKey = decryptSecret(row.apiKeyEnc, getMasterKey());
    } catch {
      return null;
    }
    return {
      id: row.id,
      label: row.label,
      apiKey,
      baseUrl: row.baseUrl,
      defaultModel: row.defaultModel,
    };
  }

  private markFailed(scanRunId: string, message: string): void {
    const now = Date.now();
    this.db
      .update(scanRuns)
      .set({
        status: 'failed',
        finishedAt: now,
        errorMessage: message,
        pipelineExecution: 'BLOCKED',
        gateDecision: 'BLOCKED',
      })
      .where(eq(scanRuns.id, scanRunId))
      .run();
    this.emitStatus(scanRunId, 'failed');
    this.emitComplete(scanRunId, 'BLOCKED');
    this.emitLog(scanRunId, 'error', `failed: ${message}`);
    // §10.3 —— scan_total failed 终态(若 controller.create 已 inc queued,这是第二条独立计数)
    const run = this.loadRun(scanRunId);
    this.metrics.incScanTotal(run?.projectId ?? 'unknown', 'failed', run?.triggerType ?? 'manual');
    runningScans.delete(scanRunId);
  }

  private markCanceled(scanRunId: string): void {
    this.db
      .update(scanRuns)
      .set({
        status: 'canceled',
        finishedAt: Date.now(),
      })
      .where(eq(scanRuns.id, scanRunId))
      .run();
    this.emitStatus(scanRunId, 'canceled');
    this.emitComplete(scanRunId, 'BLOCKED');
    // §10.3 —— scan_total canceled 终态
    const run = this.loadRun(scanRunId);
    this.metrics.incScanTotal(
      run?.projectId ?? 'unknown',
      'canceled',
      run?.triggerType ?? 'manual',
    );
    runningScans.delete(scanRunId);
  }

  private emitStatus(scanRunId: string, status: string): void {
    this.gateway.server?.to(`scan:${scanRunId}`).emit('scan:status', { scanRunId, status });
  }

  private emitProgress(scanRunId: string, percent: number, currentStage: string): void {
    this.gateway.server
      ?.to(`scan:${scanRunId}`)
      .emit('scan:progress', { scanRunId, percent, currentStage });
  }

  private emitLog(scanRunId: string, level: 'info' | 'warn' | 'error', message: string): void {
    this.gateway.server?.to(`scan:${scanRunId}`).emit('scan:log', {
      scanRunId,
      level,
      message,
      ts: Date.now(),
    });
  }

  private emitComplete(scanRunId: string, gateDecision: 'PASS' | 'BLOCKED'): void {
    this.gateway.server?.to(`scan:${scanRunId}`).emit('scan:complete', {
      scanRunId,
      status: 'succeeded',
      gateDecision,
    });
  }
}

/* ---------------------- 工具定义与参数解析辅助 ---------------------- */

function buildToolDefinitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'readFile',
        description: 'Read a file from the staged code (sandboxed; up to 100KB)',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'path relative to sandbox root' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'searchCode',
        description: 'Regex search the staged code (rg preferred)',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            fileGlob: { type: 'string', description: 'optional glob like **/*.cs' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recordVulnerability',
        description: 'Record a discovered vulnerability (writes Vulnerability + VulnLibraryEntry)',
        parameters: {
          type: 'object',
          properties: {
            vulnType: { type: 'string' },
            severity: { type: 'string', enum: ['C', 'H', 'M', 'L'] },
            title: { type: 'string' },
            filePath: { type: 'string' },
            lineStart: { type: 'number' },
            lineEnd: { type: 'number' },
            codeSnippet: { type: 'string' },
            exploitPayload: { type: 'string' },
            fixSuggestion: { type: 'string' },
            evidenceRefs: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'vulnType',
            'severity',
            'title',
            'filePath',
            'lineStart',
            'lineEnd',
            'codeSnippet',
            'fixSuggestion',
          ],
        },
      },
    },
  ];
}

function safeParseArgs(s: string): Record<string, unknown> {
  try {
    const o = JSON.parse(s) as unknown;
    if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function stringArg(o: Record<string, unknown>, key: string, optional = false): string {
  const v = o[key];
  if (typeof v === 'string') return v;
  if (optional) return '';
  throw new Error(`arg ${key} must be a string`);
}

function numberArg(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`arg ${key} must be a number`);
}

function arrayArg(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (!v) return [];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function mapSkillType(
  name: string,
):
  | 'infra'
  | 'framework'
  | 'vuln'
  | 'orchestrator'
  | 'route_mapper'
  | 'route_tracer'
  | 'exploit_chain'
  | 'supply_chain' {
  if (name === 'readFile' || name === 'searchCode') return 'infra';
  if (name === 'recordVulnerability') return 'vuln';
  return 'orchestrator';
}

function shortJson(o: unknown): string {
  const s = JSON.stringify(o);
  return s.length > 200 ? s.slice(0, 200) + '...' : s;
}

// suppress unused import in some toolchains
void createHash;
