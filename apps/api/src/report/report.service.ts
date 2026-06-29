import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, statSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

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
    const outputRoot = g.run.outputRoot;

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

    // §1.5 入口覆盖统计 (§5.3 API Coverage) —— 作为 §1 Header 的扩展子段渲染
    lines.push('### 入口覆盖统计 (§5.3)');
    lines.push('');
    lines.push('| 指标 | 值 |');
    lines.push('|---|---|');
    lines.push(`| apiCoverageStatus | \`${g.run.apiCoverageStatus}\` |`);
    lines.push(
      `| controllerCoveragePercent | ${g.run.controllerCoveragePercent === null ? 'N/A' : (g.run.controllerCoveragePercent / 100).toFixed(2) + '%'} (raw=${g.run.controllerCoveragePercent ?? 'null'}) |`,
    );
    lines.push(
      `| authCoveragePercent | ${g.run.authCoveragePercent === null ? 'N/A' : (g.run.authCoveragePercent / 100).toFixed(2) + '%'} (raw=${g.run.authCoveragePercent ?? 'null'}) |`,
    );
    lines.push(`| coverageMode | \`${g.run.coverageMode}\` |`);
    lines.push('');
    const statusIcon =
      g.run.apiCoverageStatus === 'COMPLETE'
        ? '[PASS]'
        : g.run.apiCoverageStatus === 'PARTIAL'
          ? '[WARN]'
          : '[FAIL]';
    lines.push(`- **覆盖状态**: ${statusIcon} ${g.run.apiCoverageStatus}`);
    if (g.run.controllerCoveragePercent === null) {
      lines.push('- **备注**: 找不到 `route_mapping/` 产物,覆盖率未计算(分母为 0)。');
    } else if (g.run.apiCoverageStatus === 'COMPLETE') {
      lines.push('- **备注**: 已覆盖 ≥95%,门禁通过。');
    } else if (g.run.apiCoverageStatus === 'PARTIAL') {
      lines.push('- **备注**: 已覆盖 ≥50% 但 <95%,建议补一次 route_mapper skill。');
    } else {
      lines.push('- **备注**: 已覆盖 <50% 或无产物,需要重跑 route_mapper skill。');
    }
    lines.push('');

    // §2 Execution checklist
    lines.push('## 2. Execution Checklist');
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

    // §3 阶段产物清单(Phase 3 #I 真 skill 产出)
    lines.push('## 3. 阶段产物清单(Phase 3 #I — 子仓库 skill 真产出)');
    lines.push('');
    if (!outputRoot || !existsSync(outputRoot)) {
      lines.push('_output_root 不存在,跳过阶段产物扫描。_');
    } else {
      const stageDirs = [
        { dir: 'route_mapping', label: 'route-mapper' },
        { dir: 'framework_audit', label: 'framework-{aspnetcore,...}-audit' },
        { dir: 'vuln_audit', label: 'vuln-scanner' },
        { dir: 'exploit_chain', label: 'exploit-chain-audit' },
        { dir: 'quality', label: 'quality gates (final_anchor)' },
      ];
      lines.push('| 阶段 | 子目录 | 文件数 | 代表文件 |');
      lines.push('|---|---|---|---|');
      for (const sd of stageDirs) {
        const sub = join(outputRoot, sd.dir);
        const files = listDirSafe(sub);
        const rep = pickRepresentative(files);
        lines.push(`| ${sd.label} | \`${sd.dir}/\` | ${files.length} | ${rep} |`);
      }
      lines.push('');

      // §3.1 入口覆盖矩阵 —— 从 route_mapping 真读
      const routeFiles = listDirSafe(join(outputRoot, 'route_mapping')).filter((n) =>
        n.endsWith('.json'),
      );
      if (routeFiles.length > 0) {
        lines.push('### 3.1 入口覆盖矩阵(从 route_mapping 真读)');
        lines.push('');
        const routeData = tryReadFirstJson(join(outputRoot, 'route_mapping'));
        if (routeData) {
          const routes = (routeData as { routes?: unknown[] }).routes;
          if (Array.isArray(routes) && routes.length > 0) {
            lines.push(`- 总入口数: ${routes.length}`);
            lines.push(
              `- 总入口文件: \`${routeFiles[0]?.split(sep).join('/') ?? ''}\` / 同目录 .md 同步落盘`,
            );
            lines.push('');
            const byMethod = new Map<string, number>();
            for (const r of routes) {
              const m = (r as { http_method?: string }).http_method ?? '?';
              byMethod.set(m, (byMethod.get(m) ?? 0) + 1);
            }
            lines.push('| HTTP Method | Count |');
            lines.push('|---|---|');
            for (const [m, c] of Array.from(byMethod.entries()).sort((a, b) => b[1] - a[1])) {
              lines.push(`| ${m} | ${c} |`);
            }
            lines.push('');
          }
        }
      }

      // §3.3 Framework 覆盖矩阵 —— 从 framework_audit 真读
      const fwFiles = listDirSafe(join(outputRoot, 'framework_audit')).filter((n) =>
        n.endsWith('.md'),
      );
      if (fwFiles.length > 0) {
        lines.push('### 3.3 Framework 覆盖矩阵(从 framework_audit 真读)');
        lines.push('');
        lines.push('| Framework | Report |');
        lines.push('|---|---|');
        for (const f of fwFiles) {
          const fname = f.split(sep).pop() ?? f;
          const framework = fname.split('_')[0] ?? fname;
          lines.push(`| ${framework} | \`framework_audit/${fname}\` |`);
        }
        lines.push('');
      }
    }

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
      coverage: {
        apiCoverageStatus: g.run.apiCoverageStatus,
        controllerCoveragePercent: g.run.controllerCoveragePercent,
        authCoveragePercent: g.run.authCoveragePercent,
        coverageMode: g.run.coverageMode,
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

/* ------------------------- Phase 3 #I helpers ------------------------- */

function listDirSafe(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function pickRepresentative(files: string[]): string {
  if (files.length === 0) return '_无_';
  // 优先选 routes_<ts>.json / framework_audit/<x>_<ts>.md 这类带 ts 的
  const sorted = [...files].sort();
  return `\`${sorted[0]?.split(sep).join('/') ?? ''}\``;
}

function tryReadFirstJson(dir: string): unknown | null {
  if (!existsSync(dir)) return null;
  const files = listDirSafe(dir)
    .filter((n) => n.endsWith('.json'))
    .sort();
  for (const f of files) {
    try {
      const buf = readFileSync(join(dir, f), 'utf8');
      return JSON.parse(buf) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}
