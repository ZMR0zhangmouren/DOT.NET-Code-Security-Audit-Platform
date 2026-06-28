/**
 * §5.4 多 ScanRun 报告对比 —— 纯函数工具集
 *
 * 目的:在 controller / service 里只做"读 DB → 调下面这些纯函数 → 返回 JSON"。
 * 所有判定逻辑都在这里,方便单测覆盖所有边界(onlyA / onlyB / inBoth / 严重度升降 / 状态流转 / 覆盖率 delta)。
 *
 * 严重度排序(C > H > M > L;数字越大越严重)。比较规则:
 *   - severityRank(to) > severityRank(from) ⇒ 升级
 *   - severityRank(to) < severityRank(from) ⇒ 降级
 *   - 相等则不算升级 / 降级
 *
 * §5.5 library 状态流转(open / fixing / fixed / ignored):
 *   - runA open → runB fixed ⇒ fixedInB
 *   - runB 第一次出现(runA 没有)⇒ newInB
 *   - runA severity_max < runB severity_max ⇒ worsened(severity 升)
 *
 * §5.3 覆盖率 delta:
 *   - aPercent = runA.controllerCoveragePercent / 100
 *   - bPercent = runB.controllerCoveragePercent / 100
 *   - delta = bPercent - aPercent(正数 = B 覆盖更好;负数 = B 覆盖回退)
 */
import type { GateDecision, ApiCoverageStatus } from '@platform/shared';

import type { VulnLibraryPublic } from '../vulns/vuln-library.service.js';
import type { VulnerabilityPublic } from '../vulns/vuln.service.js';

import type { ScanRunPublic } from './scan.service.js';

// ---------------------------------------------------------------------------
// Public types(与 §5.4 接口契约一致)
// ---------------------------------------------------------------------------

export interface ScanDiffRunSummary {
  id: string;
  status: ScanRunPublic['status'];
  startedAt: number | null;
  apiCoverageStatus: ApiCoverageStatus;
  gateDecision: GateDecision;
  vulnCount: number;
}

export interface VulnSummary {
  id: string;
  fingerprint: string;
  vulnType: string;
  severity: VulnerabilityPublic['severity'];
  filePath: string;
  lineStart: number;
  status: VulnerabilityPublic['status'];
}

export interface VulnInBoth {
  fingerprint: string;
  vulnType: string;
  filePath: string;
  /** a / b 中各自的代表条目(同 fingerprint 取第一条) */
  inA: VulnSummary;
  inB: VulnSummary;
  severityChanged: 'upgraded' | 'downgraded' | 'unchanged';
  statusChanged: boolean;
}

export interface VulnLibrarySummary {
  id: string;
  fingerprint: string;
  vulnType: string;
  severityMax: VulnLibraryPublic['severityMax'];
  status: VulnLibraryPublic['status'];
  title: string | null;
}

export interface ScanDiff {
  projectId: string;
  runA: ScanDiffRunSummary;
  runB: ScanDiffRunSummary;
  vulnerabilities: {
    onlyInA: VulnSummary[];
    onlyInB: VulnSummary[];
    inBoth: VulnInBoth[];
  };
  vulnLibrary: {
    newInB: VulnLibrarySummary[];
    fixedInB: VulnLibrarySummary[];
    worsened: VulnLibrarySummary[];
  };
  coverage: {
    aPercent: number | null;
    bPercent: number | null;
    delta: number | null;
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 严重度数值排序:C > H > M > L,返回数字越大越严重 */
export function severityRank(s: 'C' | 'H' | 'M' | 'L'): number {
  switch (s) {
    case 'C':
      return 4;
    case 'H':
      return 3;
    case 'M':
      return 2;
    case 'L':
      return 1;
  }
}

function vulnToSummary(v: VulnerabilityPublic): VulnSummary {
  return {
    id: v.id,
    fingerprint: v.fingerprint,
    vulnType: v.vulnType,
    severity: v.severity,
    filePath: v.filePath,
    lineStart: v.lineStart,
    status: v.status,
  };
}

function libToSummary(l: VulnLibraryPublic): VulnLibrarySummary {
  return {
    id: l.id,
    fingerprint: l.fingerprint,
    vulnType: l.vulnType,
    severityMax: l.severityMax,
    status: l.status,
    title: l.title,
  };
}

// ---------------------------------------------------------------------------
// 主计算函数(纯函数 —— 单测全跑它)
// ---------------------------------------------------------------------------

export interface ComputeScanDiffInput {
  projectId: string;
  runA: ScanRunPublic;
  runB: ScanRunPublic;
  vulnsA: VulnerabilityPublic[];
  vulnsB: VulnerabilityPublic[];
  libA: VulnLibraryPublic[];
  libB: VulnLibraryPublic[];
}

/**
 * 比较两个 ScanRun 的差异。
 *
 * 约定:
 * - "in both" = 同一个 fingerprint 在 vulnsA 和 vulnsB 各至少出现一次
 * - "onlyInA/B" = 只在一边的 vulns
 * - library 用 fingerprint 索引(同一根因),severity_max 用 severityRank 比较
 */
export function computeScanDiff(input: ComputeScanDiffInput): ScanDiff {
  const { projectId, runA, runB, vulnsA, vulnsB, libA, libB } = input;

  // --- 摘要 ---
  const runASummary: ScanDiffRunSummary = {
    id: runA.id,
    status: runA.status,
    startedAt: runA.startedAt,
    apiCoverageStatus: runA.apiCoverageStatus,
    gateDecision: runA.gateDecision,
    vulnCount: vulnsA.length,
  };
  const runBSummary: ScanDiffRunSummary = {
    id: runB.id,
    status: runB.status,
    startedAt: runB.startedAt,
    apiCoverageStatus: runB.apiCoverageStatus,
    gateDecision: runB.gateDecision,
    vulnCount: vulnsB.length,
  };

  // --- vulnerabilities diff(按 fingerprint) ---
  const mapA = new Map<string, VulnerabilityPublic>();
  for (const v of vulnsA) {
    if (!mapA.has(v.fingerprint)) mapA.set(v.fingerprint, v);
  }
  const mapB = new Map<string, VulnerabilityPublic>();
  for (const v of vulnsB) {
    if (!mapB.has(v.fingerprint)) mapB.set(v.fingerprint, v);
  }

  const onlyInA: VulnSummary[] = [];
  const onlyInB: VulnSummary[] = [];
  const inBoth: VulnInBoth[] = [];

  for (const [fp, va] of mapA) {
    const vb = mapB.get(fp);
    if (!vb) {
      onlyInA.push(vulnToSummary(va));
      continue;
    }
    const rankA = severityRank(va.severity);
    const rankB = severityRank(vb.severity);
    const severityChanged: VulnInBoth['severityChanged'] =
      rankB > rankA ? 'upgraded' : rankB < rankA ? 'downgraded' : 'unchanged';
    inBoth.push({
      fingerprint: fp,
      vulnType: va.vulnType,
      filePath: va.filePath,
      inA: vulnToSummary(va),
      inB: vulnToSummary(vb),
      severityChanged,
      statusChanged: va.status !== vb.status,
    });
  }
  for (const [fp, vb] of mapB) {
    if (!mapA.has(fp)) onlyInB.push(vulnToSummary(vb));
  }

  // --- vuln library diff(按 fingerprint) ---
  // fingerprint 是 library 与 vulnerability 共用的根因 key,§4.2.6 schema 把它
  // 标 unique-by-project;用于 diff 比较稳定。
  const libMapA = new Map<string, VulnLibraryPublic>();
  for (const l of libA) libMapA.set(l.fingerprint, l);
  const libMapB = new Map<string, VulnLibraryPublic>();
  for (const l of libB) libMapB.set(l.fingerprint, l);

  const newInB: VulnLibrarySummary[] = [];
  const fixedInB: VulnLibrarySummary[] = [];
  const worsened: VulnLibrarySummary[] = [];

  for (const [fp, lb] of libMapB) {
    const la = libMapA.get(fp);
    if (!la) {
      // B 第一次出现
      newInB.push(libToSummary(lb));
      continue;
    }
    // runA open → runB fixed 算"已修复"
    if (la.status === 'open' && lb.status === 'fixed') {
      fixedInB.push(libToSummary(lb));
    }
    // severity_max 升级
    if (severityRank(lb.severityMax) > severityRank(la.severityMax)) {
      worsened.push(libToSummary(lb));
    }
  }

  // --- coverage delta ---
  const aPercent =
    runA.controllerCoveragePercent === null || runA.controllerCoveragePercent === undefined
      ? null
      : Math.round(runA.controllerCoveragePercent) / 100;
  const bPercent =
    runB.controllerCoveragePercent === null || runB.controllerCoveragePercent === undefined
      ? null
      : Math.round(runB.controllerCoveragePercent) / 100;
  const delta = aPercent === null || bPercent === null ? null : round2(bPercent - aPercent);

  return {
    projectId,
    runA: runASummary,
    runB: runBSummary,
    vulnerabilities: { onlyInA, onlyInB, inBoth },
    vulnLibrary: { newInB, fixedInB, worsened },
    coverage: { aPercent, bPercent, delta },
  };
}

/** 保留 2 位小数(避免 0.30000000000000004 这种浮点尾) */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
