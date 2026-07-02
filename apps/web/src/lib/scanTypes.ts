// §5.2 / §5.3 前端类型 —— 与 apps/api 侧的 ScanRunPublic / CodeVersionPublic 对齐
// 字段命名/枚举值与 需求文档.md §4.2.4 / §4.2.3 一致

export type ScanRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type CoverageMode = 'FULL' | 'SAMPLE';
export type AuditSurfaceStatus =
  | 'NOT_RUN'
  | 'INITIAL_SCREENED'
  | 'PARTIAL'
  | 'COMPLETED'
  | 'NOT_APPLICABLE';
export type ApiCoverageStatus = 'NOT_RUN' | 'PARTIAL' | 'COMPLETE';
export type PipelineExecution = 'NOT_RUN' | 'RUNNING' | 'COMPLETED' | 'BLOCKED';
export type GateDecision = 'PASS' | 'BLOCKED' | 'PENDING';
export type TriggerType = 'manual' | 'scheduled' | 'replay';

export interface CodeVersionPublic {
  id: string;
  projectId: string;
  versionLabel: string | null;
  sourceType: 'zip' | 'git' | 'github';
  sourceRef: string;
  fileCount: number;
  locCount: number;
  sizeBytes: number | null;
  parentVersionId: string | null;
  uploadedBy: string;
  uploadedAt: number;
  checksum: string; // SHA-256
}

export interface ScanRunPublic {
  id: string;
  projectId: string;
  codeVersionId: string;
  skillBundleId: string;
  status: ScanRunStatus;
  triggeredBy: string;
  triggerType: TriggerType;
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

// §5.3 Skill Bundle —— 选取 active 版本触发扫描
export interface SkillBundleVersion {
  id: string;
  bundleId: string;
  version: string;
  gitCommit: string;
  snapshotPath: string;
  isActive: boolean;
  createdBy: string;
  createdAt: number;
}

/**
 * 状态/覆盖徽章颜色映射 —— 复用,避免散落
 */
export function scanStatusClass(status: ScanRunStatus): string {
  switch (status) {
    case 'queued':
      return 'bg-muted text-muted-foreground';
    case 'running':
      return 'bg-primary/20 text-primary';
    case 'succeeded':
      return 'bg-success/15 text-success border border-success/30';
    case 'failed':
      return 'bg-destructive/15 text-destructive border border-destructive/30';
    case 'canceled':
      return 'bg-muted text-muted-foreground';
  }
}

export function coverageClass(s: ApiCoverageStatus): string {
  switch (s) {
    case 'NOT_RUN':
      return 'bg-muted text-muted-foreground';
    case 'PARTIAL':
      return 'bg-warning/15 text-warning border border-warning/30';
    case 'COMPLETE':
      return 'bg-success/15 text-success border border-success/30';
  }
}

export function gateClass(g: GateDecision): string {
  switch (g) {
    case 'PASS':
      return 'bg-success/15 text-success border border-success/30';
    case 'BLOCKED':
      return 'bg-destructive/15 text-destructive border border-destructive/30';
    case 'PENDING':
      return 'bg-muted text-muted-foreground';
  }
}
