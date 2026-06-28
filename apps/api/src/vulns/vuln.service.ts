import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VulnerabilityStatus } from '@platform/shared';
import { eq } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { vulnerabilities } from '../db/schema.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VulnLibraryService } from './vuln-library.service.js'; // runtime ref (NestJS DI resolves via VulnsModule providers)

export interface VulnerabilityPublic {
  id: string;
  scanRunId: string;
  projectId: string;
  codeVersionId: string;
  libraryId: string | null;
  vulnType: string;
  severity: 'C' | 'H' | 'M' | 'L';
  cvssScore: number | null;
  fingerprint: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet: string;
  exploitPayload: string | null;
  fixSuggestion: string;
  evidenceRefs: string[];
  status: VulnerabilityStatus;
  assigneeId: string | null;
  fixedInVersionId: string | null;
  createdAt: number;
  updatedAt: number;
}

@Injectable()
export class VulnService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly library: VulnLibraryService,
  ) {}

  get(id: string): VulnerabilityPublic {
    const row = this.db.select().from(vulnerabilities).where(eq(vulnerabilities.id, id)).get();
    if (!row) throw new NotFoundException(`vulnerability ${id} not found`);
    return this.toPublic(row);
  }

  /** 改 vulnerability 状态 + 联动 library 状态 */
  setStatus(id: string, status: VulnerabilityStatus): VulnerabilityPublic {
    const existing = this.db.select().from(vulnerabilities).where(eq(vulnerabilities.id, id)).get();
    if (!existing) throw new NotFoundException(`vulnerability ${id} not found`);

    this.db
      .update(vulnerabilities)
      .set({ status, updatedAt: Date.now() })
      .where(eq(vulnerabilities.id, id))
      .run();

    // 触发 library 状态同步(同 fingerprint 的所有 vuln 全部 fixed → library=fixed)
    if (status === 'fixed' || status === 'ignored' || status === 'wontfix') {
      this.library.syncFromVulnerability(id, status === 'fixed' ? 'fixed' : 'ignored');
    }
    return this.get(id);
  }

  private toPublic(r: typeof vulnerabilities.$inferSelect): VulnerabilityPublic {
    return {
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
    };
  }
}
