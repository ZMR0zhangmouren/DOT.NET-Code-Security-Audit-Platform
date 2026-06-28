/**
 * §5.4 scan-diff.util 纯函数单元测试
 *
 * 覆盖(任务规格要求):
 *   - 只 a 有 / 只 b 有 / 共有
 *   - severity 升 / 降
 *   - status 从 open → fixed
 *   - 覆盖率 delta(正 / 负)
 */
import { describe, it, expect } from 'vitest';

import type { VulnLibraryPublic } from '../vulns/vuln-library.service.js';
import type { VulnerabilityPublic } from '../vulns/vuln.service.js';

import { computeScanDiff, severityRank } from './scan-diff.util.js';
import type { ScanRunPublic } from './scan.service.js';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeScanRun(over: Partial<ScanRunPublic> = {}): ScanRunPublic {
  return {
    id: 'scan-x',
    projectId: 'proj-1',
    codeVersionId: 'cv-1',
    skillBundleId: 'sb-1',
    status: 'succeeded',
    triggeredBy: 'admin',
    triggerType: 'manual',
    queuedAt: 1_000,
    startedAt: 2_000,
    finishedAt: 3_000,
    durationSec: 1,
    logPath: null,
    reportPath: null,
    errorMessage: null,
    retryCount: 0,
    coverageMode: 'FULL',
    auditSurfaceStatus: 'COMPLETED',
    apiCoverageStatus: 'COMPLETE',
    pipelineExecution: 'COMPLETED',
    gateDecision: 'PASS',
    controllerCoveragePercent: 9500,
    authCoveragePercent: 8000,
    outputRoot: '/tmp/x',
    ...over,
  };
}

function makeVuln(over: Partial<VulnerabilityPublic>): VulnerabilityPublic {
  return {
    id: over.id ?? 'v-default',
    scanRunId: 'scan-x',
    projectId: 'proj-1',
    codeVersionId: 'cv-1',
    libraryId: null,
    vulnType: 'sql-injection',
    severity: 'H',
    cvssScore: 80,
    fingerprint: 'fp-default',
    filePath: 'a/b.cs',
    lineStart: 10,
    lineEnd: 20,
    codeSnippet: 'cmd',
    exploitPayload: null,
    fixSuggestion: 'fix it',
    evidenceRefs: [],
    status: 'open',
    assigneeId: null,
    fixedInVersionId: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function makeLib(over: Partial<VulnLibraryPublic>): VulnLibraryPublic {
  return {
    id: over.id ?? 'lib-default',
    projectId: 'proj-1',
    vulnType: 'sql-injection',
    severityMax: 'H',
    status: 'open',
    title: 'SQL Injection',
    description: null,
    tags: [],
    occurrenceCount: 1,
    firstSeenAt: 1,
    firstSeenVersionId: 'cv-1',
    lastSeenAt: 1,
    lastSeenVersionId: 'cv-1',
    fixedInVersionId: null,
    fixedAt: null,
    assigneeId: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// severityRank 排序
// ---------------------------------------------------------------------------

describe('§5.4 severityRank', () => {
  it('C > H > M > L', () => {
    expect(severityRank('C')).toBeGreaterThan(severityRank('H'));
    expect(severityRank('H')).toBeGreaterThan(severityRank('M'));
    expect(severityRank('M')).toBeGreaterThan(severityRank('L'));
  });
});

// ---------------------------------------------------------------------------
// 主体
// ---------------------------------------------------------------------------

describe('§5.4 computeScanDiff - vulnerabilities 三类分组', () => {
  it('onlyInA / onlyInB / inBoth 各自正确分组', () => {
    const runA = makeScanRun({ id: 'run-A' });
    const runB = makeScanRun({ id: 'run-B' });

    const vulnsA: VulnerabilityPublic[] = [
      makeVuln({ id: 'v1', fingerprint: 'fp-only-a', vulnType: 'x', filePath: 'X.cs' }),
      makeVuln({
        id: 'v2',
        fingerprint: 'fp-shared',
        vulnType: 'y',
        filePath: 'Y.cs',
        severity: 'H',
      }),
    ];
    const vulnsB: VulnerabilityPublic[] = [
      makeVuln({ id: 'v3', fingerprint: 'fp-only-b', vulnType: 'z', filePath: 'Z.cs' }),
      makeVuln({
        id: 'v4',
        fingerprint: 'fp-shared',
        vulnType: 'y',
        filePath: 'Y.cs',
        severity: 'M',
      }),
    ];

    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA,
      runB,
      vulnsA,
      vulnsB,
      libA: [],
      libB: [],
    });

    expect(diff.vulnerabilities.onlyInA.map((v) => v.fingerprint)).toEqual(['fp-only-a']);
    expect(diff.vulnerabilities.onlyInB.map((v) => v.fingerprint)).toEqual(['fp-only-b']);
    expect(diff.vulnerabilities.inBoth).toHaveLength(1);
    expect(diff.vulnerabilities.inBoth[0]?.fingerprint).toBe('fp-shared');
  });
});

describe('§5.4 computeScanDiff - severity 升降', () => {
  it('共有 fingerprint,B severity 更高 → upgraded', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun(),
      runB: makeScanRun(),
      vulnsA: [makeVuln({ fingerprint: 'fp', severity: 'L' })],
      vulnsB: [makeVuln({ fingerprint: 'fp', severity: 'H' })],
      libA: [],
      libB: [],
    });
    expect(diff.vulnerabilities.inBoth).toHaveLength(1);
    expect(diff.vulnerabilities.inBoth[0]?.severityChanged).toBe('upgraded');
  });

  it('共有 fingerprint,B severity 更低 → downgraded', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun(),
      runB: makeScanRun(),
      vulnsA: [makeVuln({ fingerprint: 'fp', severity: 'C' })],
      vulnsB: [makeVuln({ fingerprint: 'fp', severity: 'M' })],
      libA: [],
      libB: [],
    });
    expect(diff.vulnerabilities.inBoth[0]?.severityChanged).toBe('downgraded');
  });

  it('共有 fingerprint,B severity 相同 → unchanged', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun(),
      runB: makeScanRun(),
      vulnsA: [makeVuln({ fingerprint: 'fp', severity: 'H' })],
      vulnsB: [makeVuln({ fingerprint: 'fp', severity: 'H' })],
      libA: [],
      libB: [],
    });
    expect(diff.vulnerabilities.inBoth[0]?.severityChanged).toBe('unchanged');
  });
});

describe('§5.4 computeScanDiff - status 变化', () => {
  it('vuln status 从 open → fixed → statusChanged=true', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun(),
      runB: makeScanRun(),
      vulnsA: [makeVuln({ fingerprint: 'fp', status: 'open' })],
      vulnsB: [makeVuln({ fingerprint: 'fp', status: 'fixed' })],
      libA: [],
      libB: [],
    });
    expect(diff.vulnerabilities.inBoth[0]?.statusChanged).toBe(true);
  });

  it('vuln status 保持 open → statusChanged=false', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun(),
      runB: makeScanRun(),
      vulnsA: [makeVuln({ fingerprint: 'fp', status: 'open' })],
      vulnsB: [makeVuln({ fingerprint: 'fp', status: 'open' })],
      libA: [],
      libB: [],
    });
    expect(diff.vulnerabilities.inBoth[0]?.statusChanged).toBe(false);
  });
});

describe('§5.4 computeScanDiff - 覆盖率 delta(正 / 负)', () => {
  it('delta 正:B 比 A 覆盖更高', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun({ controllerCoveragePercent: 5000 }),
      runB: makeScanRun({ controllerCoveragePercent: 9500 }),
      vulnsA: [],
      vulnsB: [],
      libA: [],
      libB: [],
    });
    expect(diff.coverage.aPercent).toBe(50);
    expect(diff.coverage.bPercent).toBe(95);
    expect(diff.coverage.delta).toBe(45);
  });

  it('delta 负:B 比 A 覆盖回退', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun({ controllerCoveragePercent: 9500 }),
      runB: makeScanRun({ controllerCoveragePercent: 4000 }),
      vulnsA: [],
      vulnsB: [],
      libA: [],
      libB: [],
    });
    expect(diff.coverage.aPercent).toBe(95);
    expect(diff.coverage.bPercent).toBe(40);
    expect(diff.coverage.delta).toBe(-55);
  });

  it('任一侧 controllerCoveragePercent 为 null → delta=null', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun({ controllerCoveragePercent: null }),
      runB: makeScanRun({ controllerCoveragePercent: 8000 }),
      vulnsA: [],
      vulnsB: [],
      libA: [],
      libB: [],
    });
    expect(diff.coverage.aPercent).toBeNull();
    expect(diff.coverage.delta).toBeNull();
  });
});

describe('§5.4 computeScanDiff - vulnLibrary 三类分组', () => {
  it('runA 没有的 fingerprint 在 runB 出现 → newInB', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun(),
      runB: makeScanRun(),
      vulnsA: [],
      vulnsB: [],
      libA: [],
      libB: [makeLib({ fingerprint: 'fp-new', vulnType: 'xss' })],
    });
    expect(diff.vulnLibrary.newInB.map((l) => l.fingerprint)).toEqual(['fp-new']);
    expect(diff.vulnLibrary.fixedInB).toEqual([]);
    expect(diff.vulnLibrary.worsened).toEqual([]);
  });

  it('runA open → runB fixed → fixedInB', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun(),
      runB: makeScanRun(),
      vulnsA: [],
      vulnsB: [],
      libA: [makeLib({ fingerprint: 'fp', status: 'open' })],
      libB: [makeLib({ fingerprint: 'fp', status: 'fixed' })],
    });
    expect(diff.vulnLibrary.fixedInB).toHaveLength(1);
    expect(diff.vulnLibrary.fixedInB[0]?.status).toBe('fixed');
  });

  it('severityMax M → H → worsened', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun(),
      runB: makeScanRun(),
      vulnsA: [],
      vulnsB: [],
      libA: [makeLib({ fingerprint: 'fp', severityMax: 'M' })],
      libB: [makeLib({ fingerprint: 'fp', severityMax: 'H' })],
    });
    expect(diff.vulnLibrary.worsened).toHaveLength(1);
    expect(diff.vulnLibrary.worsened[0]?.severityMax).toBe('H');
  });

  it('severityMax 不变 → 不算 worsened', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun(),
      runB: makeScanRun(),
      vulnsA: [],
      vulnsB: [],
      libA: [makeLib({ fingerprint: 'fp', severityMax: 'H', status: 'open' })],
      libB: [makeLib({ fingerprint: 'fp', severityMax: 'H', status: 'fixing' })],
    });
    expect(diff.vulnLibrary.worsened).toEqual([]);
    expect(diff.vulnLibrary.fixedInB).toEqual([]);
  });
});

describe('§5.4 computeScanDiff - run summary', () => {
  it('正确填充 vulnCount 和核心字段', () => {
    const diff = computeScanDiff({
      projectId: 'proj-1',
      runA: makeScanRun({ id: 'run-A', apiCoverageStatus: 'PARTIAL', gateDecision: 'BLOCKED' }),
      runB: makeScanRun({ id: 'run-B', apiCoverageStatus: 'COMPLETE', gateDecision: 'PASS' }),
      vulnsA: [
        makeVuln({ id: 'a1', fingerprint: 'f1' }),
        makeVuln({ id: 'a2', fingerprint: 'f2' }),
      ],
      vulnsB: [makeVuln({ id: 'b1', fingerprint: 'f3' })],
      libA: [],
      libB: [],
    });
    expect(diff.runA.id).toBe('run-A');
    expect(diff.runA.vulnCount).toBe(2);
    expect(diff.runA.apiCoverageStatus).toBe('PARTIAL');
    expect(diff.runA.gateDecision).toBe('BLOCKED');
    expect(diff.runB.vulnCount).toBe(1);
    expect(diff.runB.apiCoverageStatus).toBe('COMPLETE');
    expect(diff.runB.gateDecision).toBe('PASS');
    expect(diff.projectId).toBe('proj-1');
  });
});
