import { randomBytes } from 'node:crypto';

import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type {
  AuditSurfaceStatus,
  ApiCoverageStatus,
  PipelineExecution,
  GateDecision,
  CoverageMode,
  ScanRunStatus,
} from '@platform/shared';
import { and, desc, eq } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import {
  codeVersions,
  projects,
  scanRuns,
  skillBundleVersions,
  vulnerabilities,
} from '../db/schema.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StorageService } from '../storage/storage.service.js'; // runtime ref (NestJS DI)

import { computeApiCoverage, type VulnLookup } from './coverage.util.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanQueueService } from './scan-queue.service.js'; // runtime ref (NestJS DI)
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanRunnerService } from './scan-runner.service.js'; // runtime ref (NestJS DI)

export interface ScanRunPublic {
  id: string;
  projectId: string;
  codeVersionId: string;
  skillBundleId: string;
  status: ScanRunStatus;
  triggeredBy: string;
  triggerType: 'manual' | 'scheduled' | 'replay';
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationSec: number | null;
  errorMessage: string | null;
  retryCount: number;
  coverageMode: CoverageMode;
  auditSurfaceStatus: AuditSurfaceStatus;
  apiCoverageStatus: ApiCoverageStatus;
  pipelineExecution: PipelineExecution;
  gateDecision: GateDecision;
  controllerCoveragePercent: number | null;
  authCoveragePercent: number | null;
  outputRoot: string;
  logPath: string | null;
}

interface ScanRunRow {
  id: string;
  projectId: string;
  codeVersionId: string;
  skillBundleId: string;
  status: ScanRunStatus;
  triggeredBy: string;
  triggerType: 'manual' | 'scheduled' | 'replay';
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationSec: number | null;
  logPath: string | null;
  reportPath: string | null;
  errorMessage: string | null;
  retryCount: number;
  coverageMode: CoverageMode;
  auditSurfaceStatus: AuditSurfaceStatus;
  apiCoverageStatus: ApiCoverageStatus;
  pipelineExecution: PipelineExecution;
  gateDecision: GateDecision;
  controllerCoveragePercent: number | null;
  authCoveragePercent: number | null;
  outputRoot: string;
}

@Injectable()
export class ScanService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly queue: ScanQueueService,
    private readonly runner: ScanRunnerService,
    private readonly storage: StorageService,
  ) {}

  /** 创建一个 ScanRun 并立即异步启动 */
  async create(input: {
    projectId: string;
    codeVersionId: string;
    skillBundleId: string;
    triggerType: 'manual' | 'scheduled' | 'replay';
    triggeredBy: string;
    coverageMode?: CoverageMode;
    aiKeyId?: string;
  }): Promise<ScanRunPublic> {
    const project = this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get();
    if (!project) throw new NotFoundException(`project ${input.projectId} not found`);

    const cv = this.db
      .select({ id: codeVersions.id })
      .from(codeVersions)
      .where(
        and(eq(codeVersions.id, input.codeVersionId), eq(codeVersions.projectId, input.projectId)),
      )
      .get();
    if (!cv)
      throw new NotFoundException(
        `codeVersion ${input.codeVersionId} not found in project ${input.projectId}`,
      );

    const bundle = this.db
      .select()
      .from(skillBundleVersions)
      .where(eq(skillBundleVersions.id, input.skillBundleId))
      .get() as { id: string; isActive: boolean } | undefined;
    if (!bundle) throw new NotFoundException(`skillBundle ${input.skillBundleId} not found`);
    if (!bundle.isActive) throw new BadRequestException('skillBundle is not active');

    const id = `scan-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const now = Date.now();
    const outputRoot = this.storage.scanRunOutputRoot(id);

    this.db
      .insert(scanRuns)
      .values({
        id,
        projectId: input.projectId,
        codeVersionId: input.codeVersionId,
        skillBundleId: input.skillBundleId,
        status: 'queued',
        triggeredBy: input.triggeredBy,
        triggerType: input.triggerType,
        queuedAt: now,
        retryCount: 0,
        coverageMode: input.coverageMode ?? 'FULL',
        auditSurfaceStatus: 'NOT_RUN',
        apiCoverageStatus: 'NOT_RUN',
        pipelineExecution: 'NOT_RUN',
        gateDecision: 'PENDING',
        controllerCoveragePercent: null,
        authCoveragePercent: null,
        outputRoot,
      })
      .run();

    // §11 Q6 —— 通过 ScanQueueService 入队(BullMQ + Redis,Phase 2 升级 2026-06-28)
    // 错误不静默吞:Redis 不可达时让上层感知,而不是把 DB 行留在 'queued' 状态
    // 永远没人跑
    try {
      await this.queue.enqueue(id, input.aiKeyId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`failed to enqueue scan ${id}: ${msg}`);
    }

    return this.get(id);
  }

  get(id: string): ScanRunPublic {
    const row = this.db.select().from(scanRuns).where(eq(scanRuns.id, id)).get() as
      | ScanRunRow
      | undefined;
    if (!row) throw new NotFoundException(`scanRun ${id} not found`);
    return this.toPublic(row);
  }

  listByProject(projectId: string): ScanRunPublic[] {
    const rows = this.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.projectId, projectId))
      .orderBy(desc(scanRuns.queuedAt))
      .all() as unknown as ScanRunRow[];
    return rows.map((r) => this.toPublic(r));
  }

  cancel(id: string): { ok: boolean; canceled: boolean } {
    const existing = this.get(id);
    if (
      existing.status === 'succeeded' ||
      existing.status === 'failed' ||
      existing.status === 'canceled'
    ) {
      return { ok: true, canceled: false };
    }
    const canceled = this.runner.cancel(id);
    return { ok: true, canceled };
  }

  /** Phase 2 占位 */
  async replay(id: string): Promise<ScanRunPublic> {
    const orig = this.get(id);
    return this.create({
      projectId: orig.projectId,
      codeVersionId: orig.codeVersionId,
      skillBundleId: orig.skillBundleId,
      triggerType: 'replay',
      triggeredBy: orig.triggeredBy,
      coverageMode: orig.coverageMode,
    });
  }

  /**
   * §11 Q7 双轨 C —— "用最新 Skill 重扫"
   *
   * - 不复用原 run 的 skill_bundle_id,而是调 defaultBundleProvider() 拿当前默认
   * - 默认 bundle 不存在 → 抛 NotFoundException
   * - 创建新 ScanRun,triggerType = 'replay'(沿用,跟原 replay 区分在 service 层用 skillBundleId 区分)
   *
   * defaultBundleProvider:延迟注入,避免循环依赖(默认注 SkillBundlesService.getDefault)
   */
  async replayWithLatest(
    id: string,
    defaultBundleProvider: () => { id: string } | null,
  ): Promise<ScanRunPublic> {
    const orig = this.get(id);
    const defaultBundle = defaultBundleProvider();
    if (!defaultBundle) {
      throw new NotFoundException(
        'no default skill bundle set; set one via POST /api/skill-bundle-versions/:id/set-default first',
      );
    }
    return this.create({
      projectId: orig.projectId,
      codeVersionId: orig.codeVersionId,
      skillBundleId: defaultBundle.id,
      triggerType: 'replay',
      triggeredBy: orig.triggeredBy,
      coverageMode: orig.coverageMode,
    });
  }

  /**
   * §5.3 API 覆盖统计 —— 重新计算并写回 scanRuns 三个字段。
   *
   * 不跑 agent,只读 outputRoot 下的 route_mapping/ + framework_audit/ 产物
   * + vulnerabilities 表,调 coverage.util.computeApiCoverage,写回
   * apiCoverageStatus / controllerCoveragePercent / authCoveragePercent。
   *
   * 用例:
   * - skill 产物后到 scan finalize 之后才落盘 → 调这个端点补算
   * - 测试 / 调试:放进 fixture 后不需要重跑 115 秒 scan 就能验证整条数据流
   * - Phase 2 接 framework×9 skill 真产物后,在路由 trace 完成后调一次
   */
  recomputeCoverage(id: string): ScanRunPublic {
    const existing = this.get(id);
    const vulnLookup: VulnLookup = (scanRunId) =>
      this.db
        .select({
          filePath: vulnerabilities.filePath,
          vulnType: vulnerabilities.vulnType,
        })
        .from(vulnerabilities)
        .where(eq(vulnerabilities.scanRunId, scanRunId))
        .all();
    const coverage = computeApiCoverage(vulnLookup, id, existing.outputRoot);

    this.db
      .update(scanRuns)
      .set({
        apiCoverageStatus: coverage.apiCoverageStatus,
        controllerCoveragePercent: coverage.controllerCoveragePercent,
        authCoveragePercent: coverage.authCoveragePercent,
      })
      .where(eq(scanRuns.id, id))
      .run();

    return this.get(id);
  }

  private toPublic(r: ScanRunRow): ScanRunPublic {
    return {
      id: r.id,
      projectId: r.projectId,
      codeVersionId: r.codeVersionId,
      skillBundleId: r.skillBundleId,
      status: r.status,
      triggeredBy: r.triggeredBy,
      triggerType: r.triggerType,
      queuedAt: r.queuedAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationSec: r.durationSec,
      errorMessage: r.errorMessage,
      retryCount: r.retryCount,
      coverageMode: r.coverageMode,
      auditSurfaceStatus: r.auditSurfaceStatus,
      apiCoverageStatus: r.apiCoverageStatus,
      pipelineExecution: r.pipelineExecution,
      gateDecision: r.gateDecision,
      controllerCoveragePercent: r.controllerCoveragePercent,
      authCoveragePercent: r.authCoveragePercent,
      outputRoot: r.outputRoot,
      logPath: r.logPath,
    };
  }
}
