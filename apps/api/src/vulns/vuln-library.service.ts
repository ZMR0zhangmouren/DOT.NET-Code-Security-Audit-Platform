import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VulnLibraryStatus } from '@platform/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { vulnLibraryEntries, vulnerabilities } from '../db/schema.js';

export interface VulnLibraryPublic {
  id: string;
  projectId: string;
  fingerprint: string;
  vulnType: string;
  severityMax: 'C' | 'H' | 'M' | 'L';
  status: VulnLibraryStatus;
  title: string | null;
  description: string | null;
  tags: string[];
  occurrenceCount: number;
  firstSeenAt: number;
  firstSeenVersionId: string;
  lastSeenAt: number;
  lastSeenVersionId: string;
  fixedInVersionId: string | null;
  fixedAt: number | null;
  assigneeId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface VulnLibraryWithTimeline extends VulnLibraryPublic {
  timeline: Array<{
    vulnerabilityId: string;
    scanRunId: string;
    codeVersionId: string;
    severity: 'C' | 'H' | 'M' | 'L';
    filePath: string;
    lineStart: number;
    lineEnd: number;
    status: 'open' | 'fixing' | 'fixed' | 'wontfix' | 'ignored';
    createdAt: number;
  }>;
}

/**
 * §5.5 漏洞库(根因级)服务
 *
 * - list(projectId) —— 列出某项目的所有 VulnLibraryEntry,按 severity + lastSeen 排序
 * - getWithTimeline(id) —— 拿一条 + 关联的 vulnerabilities 时间线
 * - setStatus(id, status) —— 改根因状态
 */
@Injectable()
export class VulnLibraryService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  list(projectId: string): VulnLibraryPublic[] {
    const rows = this.db
      .select()
      .from(vulnLibraryEntries)
      .where(eq(vulnLibraryEntries.projectId, projectId))
      .orderBy(asc(vulnLibraryEntries.severityMax), desc(vulnLibraryEntries.lastSeenAt))
      .all();
    return rows.map((r) => this.toPublic(r));
  }

  getWithTimeline(id: string): VulnLibraryWithTimeline {
    const row = this.db
      .select()
      .from(vulnLibraryEntries)
      .where(eq(vulnLibraryEntries.id, id))
      .get();
    if (!row) throw new NotFoundException(`library entry ${id} not found`);

    const vulns = this.db
      .select()
      .from(vulnerabilities)
      .where(eq(vulnerabilities.libraryId, id))
      .orderBy(asc(vulnerabilities.createdAt))
      .all();

    return {
      ...this.toPublic(row),
      timeline: vulns.map((v) => ({
        vulnerabilityId: v.id,
        scanRunId: v.scanRunId,
        codeVersionId: v.codeVersionId,
        severity: v.severity,
        filePath: v.filePath,
        lineStart: v.lineStart,
        lineEnd: v.lineEnd,
        status: v.status,
        createdAt: v.createdAt,
      })),
    };
  }

  /**
   * §5.5 Phase 3 — 漏洞趋势聚合
   * 按 day/week/month 粒度统计 vuln_library_entries 的 created_at 分布,
   * 返回 trend 数组供前端图表渲染。
   */
  getTrend(
    projectId: string,
    granularity: 'day' | 'week' | 'month',
    days: number,
  ): Array<{ period: string; total: number; bySeverity: Record<string, number> }> {
    const rows = this.db
      .select()
      .from(vulnLibraryEntries)
      .where(eq(vulnLibraryEntries.projectId, projectId))
      .orderBy(asc(vulnLibraryEntries.createdAt))
      .all() as Array<{ createdAt: number; severityMax: string }>;

    if (rows.length === 0) return [];

    // 按粒度分桶
    const buckets = new Map<string, { total: number; bySeverity: Record<string, number> }>();
    const now = Date.now();
    const cutoff = now - days * 24 * 3600 * 1000;

    for (const row of rows) {
      if (row.createdAt < cutoff) continue;
      const d = new Date(row.createdAt);
      let key: string;
      if (granularity === 'day') key = d.toISOString().slice(0, 10);
      else if (granularity === 'week') {
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        key = monday.toISOString().slice(0, 10);
      } else {
        key = d.toISOString().slice(0, 7); // YYYY-MM
      }

      const b = buckets.get(key) ?? { total: 0, bySeverity: {} };
      b.total++;
      const sev = row.severityMax ?? '?';
      b.bySeverity[sev] = (b.bySeverity[sev] ?? 0) + 1;
      buckets.set(key, b);
    }

    // 按 key 排序并返回
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, v]) => ({ period, total: v.total, bySeverity: v.bySeverity }));
  }

  setStatus(id: string, status: VulnLibraryStatus): VulnLibraryWithTimeline {
    const existing = this.db
      .select()
      .from(vulnLibraryEntries)
      .where(eq(vulnLibraryEntries.id, id))
      .get();
    if (!existing) throw new NotFoundException(`library entry ${id} not found`);

    const update: Partial<typeof vulnLibraryEntries.$inferInsert> = {
      status,
      updatedAt: Date.now(),
    };
    if (status === 'fixed' && existing.status !== 'fixed') {
      update.fixedAt = Date.now();
    }
    this.db.update(vulnLibraryEntries).set(update).where(eq(vulnLibraryEntries.id, id)).run();
    return this.getWithTimeline(id);
  }

  /** 内部:配合 VulnService 状态变更时自动同步 library */
  syncFromVulnerability(vulnId: string, _newStatus: 'fixed' | 'ignored'): void {
    const vuln = this.db.select().from(vulnerabilities).where(eq(vulnerabilities.id, vulnId)).get();
    if (!vuln || !vuln.libraryId) return;
    // 收集所有关联 vulnerabilities 的状态
    const siblings = this.db
      .select({ status: vulnerabilities.status })
      .from(vulnerabilities)
      .where(eq(vulnerabilities.libraryId, vuln.libraryId))
      .all();
    const allFixed = siblings.every((s) => s.status === 'fixed' || s.status === 'wontfix');
    const allClosed = siblings.every(
      (s) => s.status === 'fixed' || s.status === 'wontfix' || s.status === 'ignored',
    );
    let libStatus: VulnLibraryStatus = 'open';
    if (allFixed) libStatus = 'fixed';
    else if (allClosed) libStatus = 'ignored';
    else if (siblings.some((s) => s.status === 'fixing')) libStatus = 'fixing';
    this.db
      .update(vulnLibraryEntries)
      .set({ status: libStatus, updatedAt: Date.now() })
      .where(eq(vulnLibraryEntries.id, vuln.libraryId))
      .run();
  }

  private toPublic(r: typeof vulnLibraryEntries.$inferSelect): VulnLibraryPublic {
    return {
      id: r.id,
      projectId: r.projectId,
      fingerprint: r.fingerprint,
      vulnType: r.vulnType,
      severityMax: r.severityMax,
      status: r.status,
      title: r.title,
      description: r.description,
      tags: r.tags,
      occurrenceCount: r.occurrenceCount,
      firstSeenAt: r.firstSeenAt,
      firstSeenVersionId: r.firstSeenVersionId,
      lastSeenAt: r.lastSeenAt,
      lastSeenVersionId: r.lastSeenVersionId,
      fixedInVersionId: r.fixedInVersionId,
      fixedAt: r.fixedAt,
      assigneeId: r.assigneeId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

// suppress unused
void and;
void inArray;
