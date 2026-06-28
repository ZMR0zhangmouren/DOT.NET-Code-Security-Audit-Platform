import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { eq, inArray } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import {
  codeVersions,
  pipelineQualityGates,
  pendingRiskPool,
  projects,
  scanRuns,
  skillBundleVersions,
  skillExecutions,
  vulnLibraryEntries,
  vulnerabilities,
} from '../db/schema.js';

/**
 * §5.4 报告服务 —— 从 DB 聚合生成 Markdown / JSON / 归档包
 *
 * 报告章节(锁死 8 段,对应 §5.4 + README §"最终合并报告至少应包含"):
 *  1. Header(项目 / 版本 / Skill bundle / 覆盖模式 / 状态)
 *  2. 执行清单(各阶段是否完成)
 *  3. Skill 使用矩阵(skill_name × skill_type × execution_status × findings_status)
 *  4. 漏洞列表(按 severity 排序)
 *  5. 风险统计(按 severity + vuln_type 分组)
 *  6. 利用链 / 漏洞库条目(vuln_library_entries)
 *  7. 待补证风险池(pending_risk_pool)
 *  8. 质量门禁(pipeline_quality_gates)
 */
@Injectable()
export class ReportService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /** 1) 头部 + 聚合数据 */
  private gather(scanRunId: string): {
    run: typeof scanRuns.$inferSelect;
    project: typeof projects.$inferSelect | null;
    codeVersion: typeof codeVersions.$inferSelect | null;
    bundle: typeof skillBundleVersions.$inferSelect | null;
    vulns: (typeof vulnerabilities.$inferSelect)[];
    library: (typeof vulnLibraryEntries.$inferSelect)[];
    skills: (typeof skillExecutions.$inferSelect)[];
    gates: (typeof pipelineQualityGates.$inferSelect)[];
    pending: (typeof pendingRiskPool.$inferSelect)[];
  } {
    const run = this.db.select().from(scanRuns).where(eq(scanRuns.id, scanRunId)).get();
    if (!run) throw new NotFoundException(`scan run ${scanRunId} not found`);

    const project =
      this.db.select().from(projects).where(eq(projects.id, run.projectId)).get() ?? null;
    const codeVersion =
      this.db.select().from(codeVersions).where(eq(codeVersions.id, run.codeVersionId)).get() ??
      null;
    const bundle =
      this.db
        .select()
        .from(skillBundleVersions)
        .where(eq(skillBundleVersions.id, run.skillBundleId))
        .get() ?? null;
    const vulns = this.db
      .select()
      .from(vulnerabilities)
      .where(eq(vulnerabilities.scanRunId, scanRunId))
      .all();
    const libIds = Array.from(
      new Set(vulns.map((v) => v.libraryId).filter((x): x is string => Boolean(x))),
    );
    const library =
      libIds.length === 0
        ? []
        : this.db
            .select()
            .from(vulnLibraryEntries)
            .where(inArray(vulnLibraryEntries.id, libIds))
            .all();
    const skills = this.db
      .select()
      .from(skillExecutions)
      .where(eq(skillExecutions.scanRunId, scanRunId))
      .all();
    const gates = this.db
      .select()
      .from(pipelineQualityGates)
      .where(eq(pipelineQualityGates.scanRunId, scanRunId))
      .all();
    const pending = this.db
      .select()
      .from(pendingRiskPool)
      .where(eq(pendingRiskPool.scanRunId, scanRunId))
      .all();

    return { run, project, codeVersion, bundle, vulns, library, skills, gates, pending };
  }

  /** 2) 生成 Markdown */
  toMarkdown(scanRunId: string): string {
    const g = this.gather(scanRunId);
    const lines: string[] = [];

    // §1 Header
    lines.push(`# Audit Report — ${g.project?.name ?? g.run.projectId}`);
    lines.push('');
    lines.push(`- **Report ID**: \`${g.run.id}\``);
    lines.push(`- **Project**: ${g.project?.name ?? g.run.projectId} (\`${g.run.projectId}\`)`);
    lines.push(
      `- **Code Version**: \`${g.run.codeVersionId}\`${g.codeVersion?.versionLabel ? ` — ${g.codeVersion.versionLabel}` : ''}`,
    );
    lines.push(
      `- **Skill Bundle**: \`${g.bundle?.version ?? g.run.skillBundleId}\` (commit \`${g.bundle?.gitCommit?.slice(0, 8) ?? '?'}\`)`,
    );
    lines.push(`- **Coverage Mode**: \`${g.run.coverageMode}\``);
    lines.push(
      `- **Status**: \`${g.run.status}\` | **Pipeline**: \`${g.run.pipelineExecution}\` | **Gate**: \`${g.run.gateDecision}\``,
    );
    lines.push(`- **Duration**: ${g.run.durationSec ?? '?'}s`);
    lines.push(`- **Triggered by**: \`${g.run.triggeredBy}\` (\`${g.run.triggerType}\`)`);
    lines.push('');

    // §2 Execution checklist
    lines.push('## 1. Execution Checklist');
    lines.push('');
    lines.push(
      `- [${g.run.status === 'succeeded' ? 'x' : ' '}] ScanRunner 完成 (status=${g.run.status})`,
    );
    lines.push(
      `- [${g.run.pipelineExecution === 'COMPLETED' ? 'x' : ' '}] Pipeline (pipelineExecution=${g.run.pipelineExecution})`,
    );
    lines.push(
      `- [${g.run.auditSurfaceStatus === 'COMPLETED' ? 'x' : ' '}] 专项覆盖 (auditSurfaceStatus=${g.run.auditSurfaceStatus})`,
    );
    lines.push(
      `- [${g.run.apiCoverageStatus === 'COMPLETE' ? 'x' : ' '}] 入口覆盖 (apiCoverageStatus=${g.run.apiCoverageStatus})`,
    );
    lines.push(
      `- [${g.run.gateDecision === 'PASS' ? 'x' : ' '}] 质量门禁 (gateDecision=${g.run.gateDecision})`,
    );
    lines.push(`- [${g.skills.length > 0 ? 'x' : ' '}] Skill 执行记录 (${g.skills.length} 条)`);
    lines.push(`- [${g.vulns.length > 0 ? 'x' : ' '}] 漏洞入库 (${g.vulns.length} 条)`);
    lines.push('');

    // §3 Skill 使用矩阵
    lines.push('## 2. Skill 使用矩阵');
    lines.push('');
    if (g.skills.length === 0) {
      lines.push('_No skill execution records found._');
    } else {
      lines.push('| skill_name | skill_type | execution_status | findings_status | 工具调用次数 |');
      lines.push('|---|---|---|---|---|');
      for (const s of g.skills) {
        const callCount = s.findingsStatus ? 1 : 0; // MVP 简版
        lines.push(
          `| \`${s.skillName}\` | ${s.skillType} | ${s.executionStatus} | ${s.findingsStatus} | ${callCount} |`,
        );
      }
    }
    lines.push('');

    // §4 漏洞列表
    lines.push('## 3. 漏洞列表');
    lines.push('');
    if (g.vulns.length === 0) {
      lines.push('_No vulnerabilities recorded._');
    } else {
      const sorted = [...g.vulns].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
      for (const v of sorted) {
        lines.push(`### ${v.severity} · ${v.vulnType} · ${v.filePath}:${v.lineStart}-${v.lineEnd}`);
        lines.push('');
        if (v.codeSnippet) {
          lines.push('```');
          lines.push(v.codeSnippet);
          lines.push('```');
          lines.push('');
        }
        if (v.exploitPayload) {
          lines.push('**Exploit PoC**:');
          lines.push('```http');
          lines.push(v.exploitPayload);
          lines.push('```');
          lines.push('');
        }
        if (v.fixSuggestion) {
          lines.push('**Fix suggestion**:');
          lines.push(v.fixSuggestion);
          lines.push('');
        }
        lines.push(`- fingerprint: \`${v.fingerprint}\``);
        lines.push(`- library_id: \`${v.libraryId}\``);
        lines.push('');
      }
    }

    // §5 风险统计
    lines.push('## 4. 风险统计');
    lines.push('');
    const bySev = groupCount(g.vulns, (v) => v.severity);
    const byType = groupCount(g.vulns, (v) => v.vulnType);
    lines.push('### By Severity');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|---|---|');
    for (const s of ['C', 'H', 'M', 'L']) {
      lines.push(`| ${s} | ${bySev[s] ?? 0} |`);
    }
    lines.push('');
    lines.push('### By Type');
    lines.push('');
    lines.push('| Vuln Type | Count |');
    lines.push('|---|---|');
    for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${t} | ${c} |`);
    }
    lines.push('');

    // §6 利用链 / 漏洞库
    lines.push('## 5. 利用链 / 漏洞库条目');
    lines.push('');
    if (g.library.length === 0) {
      lines.push('_No root-cause library entries._');
    } else {
      lines.push('| Library ID | Vuln Type | Severity | Status | Title |');
      lines.push('|---|---|---|---|---|');
      for (const l of g.library) {
        lines.push(
          `| \`${l.id.slice(0, 16)}…\` | ${l.vulnType} | ${l.severityMax} | ${l.status} | ${l.title ?? ''} |`,
        );
      }
    }
    lines.push('');

    // §7 待补证风险池
    lines.push('## 6. 待补证风险池(Pending Risk Pool)');
    lines.push('');
    if (g.pending.length === 0) {
      lines.push('_No pending risks._');
    } else {
      lines.push('| Risk ID | Type | File | Status | Reason |');
      lines.push('|---|---|---|---|---|');
      for (const p of g.pending) {
        lines.push(
          `| \`${p.id.slice(0, 16)}…\` | ${p.riskType} | ${p.filePath}:${p.lineStart} | ${p.traceStatus} | ${p.blockingReason.slice(0, 60)} |`,
        );
      }
    }
    lines.push('');

    // §8 质量门禁
    lines.push('## 7. 质量门禁(Pipeline Quality Gates)');
    lines.push('');
    if (g.gates.length === 0) {
      lines.push('_No quality gate records._');
    } else {
      lines.push('| Gate | Status | Reason |');
      lines.push('|---|---|---|');
      for (const ga of g.gates) {
        lines.push(`| ${ga.gateType} | ${ga.status} | ${ga.decisionReason ?? ''} |`);
      }
    }
    lines.push('');

    lines.push('---');
    lines.push(`_Generated at ${new Date().toISOString()} by AuditPlatform §5.4_`);
    return lines.join('\n');
  }

  /** 3) 生成 JSON */
  toJson(scanRunId: string): Record<string, unknown> {
    const g = this.gather(scanRunId);
    return {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      report: {
        run: g.run,
        project: g.project,
        codeVersion: g.codeVersion,
        bundle: g.bundle,
      },
      execution: {
        skills: g.skills,
        gates: g.gates,
      },
      vulnerabilities: g.vulns,
      vulnLibrary: g.library,
      pendingRisks: g.pending,
      stats: {
        bySeverity: groupCount(g.vulns, (v) => v.severity),
        byType: groupCount(g.vulns, (v) => v.vulnType),
        total: g.vulns.length,
      },
    };
  }

  /** 4) 归档 zip(写到 storage dir,返回文件路径) */
  buildArchive(scanRunId: string): { zipPath: string; bytes: number } {
    const g = this.gather(scanRunId);
    const md = this.toMarkdown(scanRunId);
    const json = JSON.stringify(this.toJson(scanRunId), null, 2);
    const z = new AdmZip();
    z.addFile('report.md', Buffer.from(md, 'utf8'));
    z.addFile('report.json', Buffer.from(json, 'utf8'));
    // 原始 log(优先 outputRoot/run.log,fallback 'no log file')
    if (g.run.outputRoot) {
      const logPath = join(g.run.outputRoot, 'run.log');
      try {
        const st = statSync(logPath);
        if (st.isFile()) {
          z.addLocalFile(logPath, '', 'run.log');
        }
      } catch {
        // ignore missing log
      }
    }
    // 阶段产物索引
    z.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify(
          {
            scanRunId,
            generatedAt: new Date().toISOString(),
            files: ['report.md', 'report.json', 'run.log?'],
          },
          null,
          2,
        ),
        'utf8',
      ),
    );
    const dir = join(process.cwd(), 'storage', 'reports');
    mkdirSync(dir, { recursive: true });
    const zipName = `${scanRunId}-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}.zip`;
    const zipPath = join(dir, zipName);
    writeFileSync(zipPath, z.toBuffer());
    return { zipPath, bytes: statSync(zipPath).size };
  }
}

function sevRank(s: string): number {
  return { C: 0, H: 1, M: 2, L: 3 }[s] ?? 9;
}

function groupCount<T>(arr: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of arr) {
    const k = key(t);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
