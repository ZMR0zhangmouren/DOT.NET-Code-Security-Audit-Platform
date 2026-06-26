// @platform/shared —— 跨 api / web 共享的枚举与类型
// 这些枚举严格对应 需求文档.md §4.2 / §11 已锁定的决策,改动需先 /decision-check

// §4.2.5 Vulnerability.severity
export const SEVERITY = ['C', 'H', 'M', 'L'] as const;
export type Severity = (typeof SEVERITY)[number];

// §4.2.5 Vulnerability.exploitability(agent.md 模板字段)
export const EXPLOITABILITY = ['CONFIRMED', 'PENDING', 'NOT_EXPLOITABLE', 'ENV_DEPENDENT'] as const;
export type Exploitability = (typeof EXPLOITABILITY)[number];

// §4.2.4 ScanRun.status
export const SCAN_RUN_STATUS = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;
export type ScanRunStatus = (typeof SCAN_RUN_STATUS)[number];

// §4.2.4 ScanRun.coverage_mode
export const COVERAGE_MODE = ['FULL', 'SAMPLE'] as const;
export type CoverageMode = (typeof COVERAGE_MODE)[number];

// §4.2.4 ScanRun.audit_surface_status
export const AUDIT_SURFACE_STATUS = [
  'NOT_RUN',
  'INITIAL_SCREENED',
  'PARTIAL',
  'COMPLETED',
  'NOT_APPLICABLE',
] as const;
export type AuditSurfaceStatus = (typeof AUDIT_SURFACE_STATUS)[number];

// §4.2.4 ScanRun.api_coverage_status
export const API_COVERAGE_STATUS = ['NOT_RUN', 'PARTIAL', 'COMPLETE'] as const;
export type ApiCoverageStatus = (typeof API_COVERAGE_STATUS)[number];

// §4.2.4 ScanRun.pipeline_execution
export const PIPELINE_EXECUTION = ['NOT_RUN', 'RUNNING', 'COMPLETED', 'BLOCKED'] as const;
export type PipelineExecution = (typeof PIPELINE_EXECUTION)[number];

// §4.2.4 ScanRun.gate_decision
export const GATE_DECISION = ['PASS', 'BLOCKED', 'PENDING'] as const;
export type GateDecision = (typeof GATE_DECISION)[number];

// §4.2.10 SkillExecution.execution_status(README 2026-06 覆盖门禁)
export const EXECUTION_STATUS = [
  'NOT_RUN',
  'INITIAL_SCREENED',
  'PARTIAL',
  'COMPLETED',
  'NOT_APPLICABLE',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUS)[number];

// §4.2.10 SkillExecution.findings_status
export const FINDINGS_STATUS = [
  'FOUND',
  'NO_FINDING',
  'PENDING_VERIFICATION',
  'ENVIRONMENT_DEPENDENT',
] as const;
export type FindingsStatus = (typeof FINDINGS_STATUS)[number];

// §4.2.10 SkillExecution.skill_type
export const SKILL_TYPE = [
  'infra',
  'framework',
  'vuln',
  'orchestrator',
  'route_mapper',
  'route_tracer',
  'exploit_chain',
  'supply_chain',
] as const;
export type SkillType = (typeof SKILL_TYPE)[number];

// §4.2.11 PipelineQualityGate.gate_type
export const GATE_TYPE = [
  'API_COVERAGE_GATE',
  'COVERAGE_CONSISTENCY_CHECK',
  'QUICK_VALIDATION',
  'FINAL_ANCHOR_CHECKLIST',
] as const;
export type GateType = (typeof GATE_TYPE)[number];

// §4.2.11 PipelineQualityGate.status
export const GATE_STATUS = ['PASS', 'BLOCKED', 'PENDING'] as const;
export type GateStatus = (typeof GATE_STATUS)[number];

// §4.2.12 EvidenceConflict.resolution
export const CONFLICT_RESOLUTION = ['UNRESOLVED', 'KEPT_BOTH', 'MANUAL_RESOLVED'] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTION)[number];

// §4.2.13 PendingRiskPoolEntry.trace_status
export const TRACE_STATUS = ['CLOSED', 'OPEN', 'UNRESOLVED', 'NOT_TRACED'] as const;
export type TraceStatus = (typeof TRACE_STATUS)[number];

// §4.2.14 UnmappedRoute.status
export const UNMAPPED_STATUS = [
  'PENDING',
  'BACKFILLED',
  'ABANDONED',
  'RESOLVED_USER_TERMINATE',
] as const;
export type UnmappedStatus = (typeof UNMAPPED_STATUS)[number];

// §4.2.6 VulnLibraryEntry.status(漏洞库条目级)
export const VULN_LIBRARY_STATUS = [
  'open',
  'fixing',
  'fixed',
  'wontfix',
  'ignored',
  'suppressed',
] as const;
export type VulnLibraryStatus = (typeof VULN_LIBRARY_STATUS)[number];

// §4.2.6 Vulnerability.status(实例级)
export const VULNERABILITY_STATUS = ['open', 'fixing', 'fixed', 'wontfix', 'ignored'] as const;
export type VulnerabilityStatus = (typeof VULNERABILITY_STATUS)[number];

// §4.2.1 Project.visibility / status / §4.2.7 User.role(略)
// 这里只列跨 api/web 必须共享的枚举;具体实体类型留给 api 侧 Drizzle schema 与 web 侧 API client 各自封装
