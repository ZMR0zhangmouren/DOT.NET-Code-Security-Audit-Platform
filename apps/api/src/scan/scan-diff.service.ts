import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { vulnerabilities } from '../db/schema.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VulnLibraryService, type VulnLibraryPublic } from '../vulns/vuln-library.service.js'; // runtime ref (NestJS DI)
import { type VulnerabilityPublic } from '../vulns/vuln.service.js'; // type-only

import { computeScanDiff, type ScanDiff } from './scan-diff.util.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanService } from './scan.service.js'; // runtime ref (NestJS DI)

@Injectable()
export class ScanDiffService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly scan: ScanService,
    private readonly library: VulnLibraryService,
  ) {}

  /**
   * §5.4 多 ScanRun 报告对比
   *
   * 读 a / b 两条 ScanRun,聚合它们的 vulnerabilities + vulnLibraryEntries,
   * 调纯函数 computeScanDiff 出 JSON。
   *
   * 校验:
   *   - aId !== bId(同一 run 比对无意义)
   *   - 两条都存在
   *   - 两条 projectId 都等于 :id(不允许跨项目比)
   */
  diff(projectId: string, aId: string, bId: string): ScanDiff {
    if (aId === bId) {
      throw new BadRequestException('a and b must be different scanRun ids');
    }

    const runA = this.scan.get(aId);
    const runB = this.scan.get(bId);
    if (runA.projectId !== projectId || runB.projectId !== projectId) {
      throw new BadRequestException(
        `scanRuns must belong to project ${projectId} (a=${runA.projectId}, b=${runB.projectId})`,
      );
    }

    const vulnsA = this.loadVulnsForRun(aId);
    const vulnsB = this.loadVulnsForRun(bId);

    const libA = this.loadLibForRun(projectId, aId);
    const libB = this.loadLibForRun(projectId, bId);

    return computeScanDiff({
      projectId,
      runA,
      runB,
      vulnsA,
      vulnsB,
      libA,
      libB,
    });
  }

  private loadVulnsForRun(scanRunId: string): VulnerabilityPublic[] {
    const rows = this.db
      .select()
      .from(vulnerabilities)
      .where(eq(vulnerabilities.scanRunId, scanRunId))
      .all();
    return rows.map((r) => ({
      id: r.id,
      scanRunId: r.scanRunId,
      projectId: r.projectId,
      codeVersionId: r.codeVersionId,
      libraryId: r.libraryId,
      vulnType: r.vulnType,
      severity: r.severity,
      cvssScore: r.cvssScore,
      fingerprint: r.fingerprint,
      filePath: r.filePath,
      lineStart: r.lineStart,
      lineEnd: r.lineEnd,
      codeSnippet: r.codeSnippet,
      exploitPayload: r.exploitPayload,
      fixSuggestion: r.fixSuggestion,
      evidenceRefs: r.evidenceRefs,
      status: r.status,
      assigneeId: r.assigneeId,
      fixedInVersionId: r.fixedInVersionId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * 取 run 内 vulnerability 涉及的 fingerprint 对应的 VulnLibraryEntry。
   * 这里直接调 library.list(projectId) 然后 filter —— MVP 阶段 library 体量小,
   * 这样拿到的是 §5.5 sync 后的"当前态"status / severityMax,反映修复进度。
   */
  private loadLibForRun(projectId: string, scanRunId: string): VulnLibraryPublic[] {
    const fpRows = this.db
      .selectDistinct({ fingerprint: vulnerabilities.fingerprint })
      .from(vulnerabilities)
      .where(eq(vulnerabilities.scanRunId, scanRunId))
      .all();
    const fps = new Set(fpRows.map((r) => r.fingerprint));
    if (fps.size === 0) return [];
    return this.library.list(projectId).filter((l) => fps.has(l.fingerprint));
  }
}
