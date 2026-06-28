import type * as FsTypes from 'node:fs';

import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// §5.4 ReportService 单测 —— 覆盖 toJson / toMarkdown / buildArchive
// 用 fakeDb + mock fs 让 gather/toJson/toMarkdown 跑过数据流。

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));

vi.mock('adm-zip', () => {
  return {
    default: class AdmZip {
      addFile = vi.fn();
      toBuffer = vi.fn(() => Buffer.from('zip-content'));
    },
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<FsTypes>('node:fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn(() => ({ isDirectory: () => true, size: 100 })),
  };
});

vi.mock('../db/schema.js', () => {
  const makeTable = (tableName: string): Record<string, unknown> => {
    const t: Record<string, unknown> = { __table: tableName };
    return new Proxy(t, {
      get: (target, prop: string) => {
        if (prop === '__table') return target['__table'];
        return { __table: target['__table'], __col: prop };
      },
    });
  };
  return {
    scanRuns: makeTable('scan_runs'),
    projects: makeTable('projects'),
    codeVersions: makeTable('code_versions'),
    skillBundleVersions: makeTable('skill_bundle_versions'),
    vulnerabilities: makeTable('vulnerabilities'),
    vulnLibraryEntries: makeTable('vuln_library_entries'),
    skillExecutions: makeTable('skill_executions'),
    pipelineQualityGates: makeTable('pipeline_quality_gates'),
    pendingRiskPool: makeTable('pending_risk_pool'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  inArray: (col: { __table: string; __col: string }, vals: unknown) => ({
    __inArray: { table: col.__table, col: col.__col, vals },
  }),
}));

interface Cond {
  __eq?: { col: string; val: unknown };
  __inArray?: { col: string; val: unknown };
}

function matchesCond(row: Record<string, unknown>, cond: Cond): boolean {
  if (cond.__eq) return row[cond.__eq.col] === cond.__eq.val;
  if (cond.__inArray) return (cond.__inArray.val as unknown[]).includes(row[cond.__inArray.col]);
  return true;
}

function createFakeDb(): {
  rows: Record<string, Record<string, unknown>[]>;
  select: () => {
    from: (t: unknown) => {
      where: (cond: Cond) => {
        get: () => Record<string, unknown> | undefined;
        all: () => Record<string, unknown>[];
      };
      get: () => Record<string, unknown> | undefined;
      all: () => Record<string, unknown>[];
    };
  };
} {
  const rows: Record<string, Record<string, unknown>[]> = {};
  return {
    rows,
    select: () => ({
      from: (t: unknown) => {
        const tableName = (t as { __table: string }).__table;
        if (!rows[tableName]) rows[tableName] = [];
        const where = (cond: Cond) => ({
          get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
          all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
        });
        return {
          where,
          get: () => rows[tableName]![0],
          all: () => rows[tableName]!,
        };
      },
    }),
  };
}

function seedScanRun(db: ReturnType<typeof createFakeDb>): void {
  for (const t of [
    'scan_runs',
    'projects',
    'code_versions',
    'skill_bundle_versions',
    'vulnerabilities',
    'vuln_library_entries',
    'skill_executions',
    'pipeline_quality_gates',
    'pending_risk_pool',
  ]) {
    db.rows[t] = db.rows[t] ?? [];
  }
  db.rows['scan_runs']!.push({
    id: 'scan-1',
    projectId: 'p1',
    codeVersionId: 'cv-1',
    skillBundleId: 'sb-1',
    status: 'succeeded',
    triggeredBy: 'admin',
    triggerType: 'manual',
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 100,
    durationSec: 98,
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
    authCoveragePercent: 9800,
    outputRoot: '/tmp/scan-1',
  });
  db.rows['projects']!.push({ id: 'p1', name: 'TestProject' });
  db.rows['code_versions']!.push({ id: 'cv-1', versionLabel: 'v1' });
  db.rows['skill_bundle_versions']!.push({
    id: 'sb-1',
    version: 'v1.0.0',
    gitCommit: 'abcdef1234567890',
    snapshotPath: '/tmp/bundle',
    isActive: true,
    isDefault: false,
    note: null,
    createdAt: 1,
    publishedAt: 1,
  });
}

describe('ReportService (mocked DB) — §5.4', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toJson:scanRun 不存在 → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./report.service.js');
    const svc = new mod.ReportService(fakeDb as never);
    expect(() => svc.toJson('scan-missing')).toThrow(NotFoundException);
  });

  it('toJson:happy → 返回 JSON object,含 report.run / vulnerabilities 字段', async () => {
    const fakeDb = createFakeDb();
    seedScanRun(fakeDb);
    fakeDb.rows['vulnerabilities']!.push({
      id: 'v-1',
      scanRunId: 'scan-1',
      projectId: 'p1',
      codeVersionId: 'cv-1',
      libraryId: null,
      vulnType: 'sqli',
      severity: 'H',
      cvssScore: 8.5,
      fingerprint: 'fp1',
      filePath: 'a.cs',
      lineStart: 1,
      lineEnd: 5,
      codeSnippet: 'x',
      exploitPayload: null,
      fixSuggestion: 'fix it',
      evidenceRefs: ['r1'],
      status: 'open',
      assigneeId: null,
      fixedInVersionId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const mod = await import('./report.service.js');
    const svc = new mod.ReportService(fakeDb as never);
    const json = svc.toJson('scan-1');
    expect(json.schemaVersion).toBe('1.0');
    expect((json.report as Record<string, Record<string, string>>).run.id).toBe('scan-1');
    expect((json.report as Record<string, Record<string, string>>).project.name).toBe(
      'TestProject',
    );
    expect(json.vulnerabilities).toHaveLength(1);
    expect((json.vulnerabilities as Array<{ id: string }>)[0]!.id).toBe('v-1');
  });

  it('toMarkdown:happy → 含 # Audit Report 标题 + 章节', async () => {
    const fakeDb = createFakeDb();
    seedScanRun(fakeDb);
    const mod = await import('./report.service.js');
    const svc = new mod.ReportService(fakeDb as never);
    const md = svc.toMarkdown('scan-1');
    expect(md).toContain('# Audit Report');
    expect(md).toContain('TestProject');
  });

  it('buildArchive → mkdir + writeFileSync + 返回 {zipPath, bytes}', async () => {
    const fakeDb = createFakeDb();
    seedScanRun(fakeDb);
    const fs = await import('node:fs');
    const mod = await import('./report.service.js');
    const svc = new mod.ReportService(fakeDb as never);
    const out = svc.buildArchive('scan-1');
    // mkdirSync 在 storage/reports 下(platform 全局报告目录,不是 scanRun 的 outputRoot)
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(out.zipPath).toContain('scan-1');
    expect(typeof out.bytes).toBe('number');
  });

  it('buildArchive → 缺 scanRun → NotFoundException', async () => {
    const fakeDb = createFakeDb();
    const mod = await import('./report.service.js');
    const svc = new mod.ReportService(fakeDb as never);
    expect(() => svc.buildArchive('scan-missing')).toThrow(NotFoundException);
  });
});
