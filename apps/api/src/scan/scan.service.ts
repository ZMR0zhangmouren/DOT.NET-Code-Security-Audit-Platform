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
import { codeVersions, projects, scanRuns, skillBundleVersions } from '../db/schema.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StorageService } from '../storage/storage.service.js'; // runtime ref (NestJS DI)

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
  outputRoot: string;
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
  outputRoot: string;
}

@Injectable()
export class ScanService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly runner: ScanRunnerService,
    private readonly storage: StorageService,
  ) {}

  /** 创建一个 ScanRun 并立即异步启动 */
  create(input: {
    projectId: string;
    codeVersionId: string;
    skillBundleId: string;
    triggerType: 'manual' | 'scheduled' | 'replay';
    triggeredBy: string;
    coverageMode?: CoverageMode;
  }): ScanRunPublic {
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
        outputRoot,
      })
      .run();

    // 异步触发,不等完成
    this.runner.kickoff(id);

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
  replay(id: string): ScanRunPublic {
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
      outputRoot: r.outputRoot,
    };
  }
}
