/**
 * Drizzle schema —— 严格对应 ./需求文档.md §4.2 锁定的 14 个实体
 *
 * 改动需先 /decision-check,任何与 §11 Q1–Q17 决策冲突的字段调整都视为破坏性变更。
 *
 * 设计要点:
 * - 所有 UUID 主键;SQLite 用 TEXT 存储(SQLite 没有原生 UUID)
 * - 所有 ENUM 用 TEXT + CHECK 约束(或直接用 @platform/shared 字符串字面量类型校验)
 * - 所有时间戳 INTEGER(Unix epoch ms)便于排序
 * - 所有 JSON 字段用 TEXT + JSON.parse,因为 SQLite 没有原生 JSONB
 */
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// =====================================================================
// §4.2.1 Project
// =====================================================================
export const PROJECT_VISIBILITY = ['public', 'private'] as const;
export type Visibility = (typeof PROJECT_VISIBILITY)[number];
export const PROJECT_STATUS = ['active', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[number];

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: text('owner_id').notNull(), // FK -> users.id
    visibility: text('visibility', { enum: ['public', 'private'] })
      .notNull()
      .default('private'),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    ownerIdx: index('projects_owner_idx').on(t.ownerId),
    statusIdx: index('projects_status_idx').on(t.status),
  }),
);

// =====================================================================
// §4.2.2 CodeVersion
// =====================================================================
export const codeVersions = sqliteTable(
  'code_versions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    versionLabel: text('version_label').notNull(),
    sourceType: text('source_type', { enum: ['zip', 'git', 'github'] }).notNull(),
    sourceRef: text('source_ref').notNull(),
    fileCount: integer('file_count'),
    locCount: integer('loc_count'),
    sizeBytes: integer('size_bytes'),
    parentVersionId: text('parent_version_id'),
    uploadedBy: text('uploaded_by').notNull(),
    uploadedAt: integer('uploaded_at').notNull(),
    checksum: text('checksum').notNull(), // SHA-256
    // §5.7 真接 git clone 时填充
    clonedAt: integer('cloned_at'),
    cloneErrorMessage: text('clone_error_message'),
  },
  (t) => ({
    projectIdx: index('code_versions_project_idx').on(t.projectId),
    checksumUnique: uniqueIndex('code_versions_checksum_unique').on(t.checksum),
  }),
);

// =====================================================================
// §4.2.3 SkillBundleVersion
// =====================================================================
export const skillBundleVersions = sqliteTable(
  'skill_bundle_versions',
  {
    id: text('id').primaryKey(),
    version: text('version').notNull(),
    gitCommit: text('git_commit').notNull(),
    snapshotPath: text('snapshot_path').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    // §11 Q7 双轨 C —— 默认 bundle 标记(快照可复现 vs 最新 Skill 重扫)
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    // §11 Q7 —— published_at 是 publish 动作的时间戳,可选(老 bundle 没记时为 NULL)
    publishedAt: integer('published_at'),
    note: text('note'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    activeIdx: index('skill_bundle_active_idx').on(t.isActive),
    defaultIdx: index('skill_bundle_default_idx').on(t.isDefault),
    versionUnique: uniqueIndex('skill_bundle_version_unique').on(t.version),
  }),
);

// =====================================================================
// §4.2.4 ScanRun
// =====================================================================
export const scanRuns = sqliteTable(
  'scan_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    codeVersionId: text('code_version_id')
      .notNull()
      .references(() => codeVersions.id),
    skillBundleId: text('skill_bundle_id')
      .notNull()
      .references(() => skillBundleVersions.id),
    status: text('status', {
      enum: ['queued', 'running', 'succeeded', 'failed', 'canceled'],
    }).notNull(),
    triggeredBy: text('triggered_by').notNull(),
    triggerType: text('trigger_type', { enum: ['manual', 'scheduled', 'replay'] }).notNull(),
    queuedAt: integer('queued_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    durationSec: integer('duration_sec'),
    logPath: text('log_path'),
    reportPath: text('report_path'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    // 2026-06 覆盖门禁新增字段
    coverageMode: text('coverage_mode', { enum: ['FULL', 'SAMPLE'] })
      .notNull()
      .default('FULL'),
    auditSurfaceStatus: text('audit_surface_status', {
      enum: ['NOT_RUN', 'INITIAL_SCREENED', 'PARTIAL', 'COMPLETED', 'NOT_APPLICABLE'],
    })
      .notNull()
      .default('NOT_RUN'),
    apiCoverageStatus: text('api_coverage_status', {
      enum: ['NOT_RUN', 'PARTIAL', 'COMPLETE'],
    })
      .notNull()
      .default('NOT_RUN'),
    pipelineExecution: text('pipeline_execution', {
      enum: ['NOT_RUN', 'RUNNING', 'COMPLETED', 'BLOCKED'],
    })
      .notNull()
      .default('NOT_RUN'),
    gateDecision: text('gate_decision', { enum: ['PASS', 'BLOCKED', 'PENDING'] })
      .notNull()
      .default('PENDING'),
    controllerCoveragePercent: integer('controller_coverage_percent'), // ×100 存
    authCoveragePercent: integer('auth_coverage_percent'),
    traceBatchMaxSize: integer('trace_batch_max_size').notNull().default(10),
    traceBatchPlanPath: text('trace_batch_plan_path'),
    outputRoot: text('output_root').notNull(),
  },
  (t) => ({
    projectIdx: index('scan_runs_project_idx').on(t.projectId),
    statusIdx: index('scan_runs_status_idx').on(t.status),
    coverageIdx: index('scan_runs_coverage_idx').on(t.coverageMode),
  }),
);

// =====================================================================
// §4.2.5 Vulnerability(实例)
// =====================================================================
export const vulnerabilities = sqliteTable(
  'vulnerabilities',
  {
    id: text('id').primaryKey(),
    scanRunId: text('scan_run_id')
      .notNull()
      .references(() => scanRuns.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    codeVersionId: text('code_version_id')
      .notNull()
      .references(() => codeVersions.id),
    libraryId: text('library_id').references(() => vulnLibraryEntries.id),
    vulnType: text('vuln_type').notNull(),
    severity: text('severity', { enum: ['C', 'H', 'M', 'L'] }).notNull(),
    cvssScore: integer('cvss_score'), // ×10 存
    fingerprint: text('fingerprint').notNull(),
    filePath: text('file_path').notNull(),
    lineStart: integer('line_start').notNull(),
    lineEnd: integer('line_end').notNull(),
    codeSnippet: text('code_snippet').notNull(),
    exploitPayload: text('exploit_payload'),
    fixSuggestion: text('fix_suggestion').notNull(),
    evidenceRefs: text('evidence_refs', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status', { enum: ['open', 'fixing', 'fixed', 'wontfix', 'ignored'] })
      .notNull()
      .default('open'),
    assigneeId: text('assignee_id'),
    fixedInVersionId: text('fixed_in_version_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    libraryIdx: index('vulns_library_idx').on(t.libraryId),
    scanRunIdx: index('vulns_scan_run_idx').on(t.scanRunId),
    fingerprintIdx: index('vulns_fingerprint_idx').on(t.fingerprint),
    projectStatusIdx: index('vulns_project_status_idx').on(t.projectId, t.status),
  }),
);

// =====================================================================
// §4.2.6 VulnLibraryEntry(漏洞库条目)
// =====================================================================
export const vulnLibraryEntries = sqliteTable(
  'vuln_library_entries',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    vulnType: text('vuln_type').notNull(),
    fingerprint: text('fingerprint').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    severityMax: text('severity_max', { enum: ['C', 'H', 'M', 'L'] }).notNull(),
    cvssMax: integer('cvss_max'),
    status: text('status', {
      enum: ['open', 'fixing', 'fixed', 'wontfix', 'ignored', 'suppressed'],
    })
      .notNull()
      .default('open'),
    assigneeId: text('assignee_id'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    firstSeenRunId: text('first_seen_run_id').notNull(),
    firstSeenVersionId: text('first_seen_version_id').notNull(),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenRunId: text('last_seen_run_id').notNull(),
    lastSeenVersionId: text('last_seen_version_id').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    fixedInVersionId: text('fixed_in_version_id'),
    fixedAt: integer('fixed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    projectFingerprintUnique: uniqueIndex('vuln_library_project_fingerprint_unique').on(
      t.projectId,
      t.fingerprint,
    ),
    projectStatusIdx: index('vuln_library_project_status_idx').on(t.projectId, t.status),
    projectVulnTypeIdx: index('vuln_library_project_type_idx').on(t.projectId, t.vulnType),
    projectSeverityIdx: index('vuln_library_project_severity_idx').on(t.projectId, t.severityMax),
  }),
);

// =====================================================================
// §4.2.7 User
// =====================================================================
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'auditor', 'developer', 'viewer'] })
      .notNull()
      .default('developer'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    lastLoginAt: integer('last_login_at'),
  },
  (t) => ({
    usernameUnique: uniqueIndex('users_username_unique').on(t.username),
    emailUnique: uniqueIndex('users_email_unique').on(t.email),
  }),
);

// =====================================================================
// §4.2.8 ProjectMember
// =====================================================================
export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    projectRole: text('project_role', { enum: ['lead', 'contributor', 'viewer'] }).notNull(),
    grantedBy: text('granted_by').notNull(),
    grantedAt: integer('granted_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.userId] }),
  }),
);

// =====================================================================
// §4.2.9 ProxyConfig
// =====================================================================
export const proxyConfigs = sqliteTable('proxy_configs', {
  id: text('id').primaryKey(),
  protocol: text('protocol', { enum: ['http', 'https', 'socks5'] }), // NULL = 直连(对应 §11 Q13:HTTP/HTTPS/SOCKS5)
  host: text('host'),
  port: integer('port'),
  username: text('username'), // NULL = 无认证
  passwordEnc: text('password_enc'), // AES-256 加密
  applyTo: text('apply_to', { enum: ['all', 'http_only', 'all_outbound'] })
    .notNull()
    .default('all_outbound'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  updatedBy: text('updated_by'),
  updatedAt: integer('updated_at').notNull(),
  testStatus: text('test_status', { enum: ['unknown', 'success', 'failed'] })
    .notNull()
    .default('unknown'),
  testMessage: text('test_message'),
});

// =====================================================================
// §4.2.10 SkillExecution
// =====================================================================
export const skillExecutions = sqliteTable(
  'skill_executions',
  {
    id: text('id').primaryKey(),
    scanRunId: text('scan_run_id')
      .notNull()
      .references(() => scanRuns.id),
    skillName: text('skill_name').notNull(),
    skillType: text('skill_type', {
      enum: [
        'infra',
        'framework',
        'vuln',
        'orchestrator',
        'route_mapper',
        'route_tracer',
        'exploit_chain',
        'supply_chain',
      ],
    }).notNull(),
    skillPath: text('skill_path').notNull(),
    executionStatus: text('execution_status', {
      enum: ['NOT_RUN', 'INITIAL_SCREENED', 'PARTIAL', 'COMPLETED', 'NOT_APPLICABLE'],
    }).notNull(),
    findingsStatus: text('findings_status', {
      enum: ['FOUND', 'NO_FINDING', 'PENDING_VERIFICATION', 'ENVIRONMENT_DEPENDENT'],
    }).notNull(),
    primaryOutputs: text('primary_outputs', { mode: 'json' }).$type<string[]>().notNull(),
    dependsOn: text('depends_on', { mode: 'json' }).$type<string[]>().notNull(),
    traceRefs: text('trace_refs', { mode: 'json' }).$type<string[]>(),
    exploitability: text('exploitability', {
      enum: ['CONFIRMED', 'PENDING', 'NOT_EXPLOITABLE', 'ENV_DEPENDENT'],
    }),
    notes: text('notes'),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    durationSec: integer('duration_sec'),
  },
  (t) => ({
    scanSkillUnique: uniqueIndex('skill_exec_scan_skill_unique').on(t.scanRunId, t.skillName),
    scanStatusIdx: index('skill_exec_scan_status_idx').on(t.scanRunId, t.executionStatus),
  }),
);

// =====================================================================
// §4.2.11 PipelineQualityGate
// =====================================================================
export const pipelineQualityGates = sqliteTable(
  'pipeline_quality_gates',
  {
    id: text('id').primaryKey(),
    scanRunId: text('scan_run_id')
      .notNull()
      .references(() => scanRuns.id),
    gateType: text('gate_type', {
      enum: [
        'API_COVERAGE_GATE',
        'COVERAGE_CONSISTENCY_CHECK',
        'QUICK_VALIDATION',
        'FINAL_ANCHOR_CHECKLIST',
      ],
    }).notNull(),
    filePath: text('file_path').notNull(),
    status: text('status', { enum: ['PASS', 'BLOCKED', 'PENDING'] }).notNull(),
    details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
    decisionReason: text('decision_reason'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    scanGateUnique: uniqueIndex('gate_scan_type_unique').on(t.scanRunId, t.gateType),
  }),
);

// =====================================================================
// §4.2.12 EvidenceConflict
// =====================================================================
export const evidenceConflicts = sqliteTable(
  'evidence_conflicts',
  {
    id: text('id').primaryKey(),
    scanRunId: text('scan_run_id')
      .notNull()
      .references(() => scanRuns.id),
    fieldName: text('field_name').notNull(),
    sourceAPath: text('source_a_path').notNull(),
    sourceAValue: text('source_a_value').notNull(),
    sourceBPath: text('source_b_path').notNull(),
    sourceBValue: text('source_b_value').notNull(),
    resolution: text('resolution', {
      enum: ['UNRESOLVED', 'KEPT_BOTH', 'MANUAL_RESOLVED'],
    })
      .notNull()
      .default('UNRESOLVED'),
    resolutionNote: text('resolution_note'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    fieldIdx: index('evidence_conflicts_field_idx').on(t.fieldName),
    resolutionIdx: index('evidence_conflicts_resolution_idx').on(t.resolution),
  }),
);

// =====================================================================
// §4.2.13 PendingRiskPoolEntry
// =====================================================================
export const pendingRiskPool = sqliteTable(
  'pending_risk_pool',
  {
    id: text('id').primaryKey(),
    scanRunId: text('scan_run_id')
      .notNull()
      .references(() => scanRuns.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    codeVersionId: text('code_version_id')
      .notNull()
      .references(() => codeVersions.id),
    riskType: text('risk_type').notNull(),
    sourceSkill: text('source_skill').notNull(),
    filePath: text('file_path').notNull(),
    lineStart: integer('line_start').notNull(),
    lineEnd: integer('line_end').notNull(),
    codeSnippet: text('code_snippet').notNull(),
    staticHit: text('static_hit', { mode: 'json' }).$type<Record<string, unknown>>(),
    traceStatus: text('trace_status', {
      enum: ['CLOSED', 'OPEN', 'UNRESOLVED', 'NOT_TRACED'],
    }).notNull(),
    missingEvidence: text('missing_evidence', { mode: 'json' }).$type<string[]>().notNull(),
    blockingReason: text('blocking_reason').notNull(),
    backfillPlan: text('backfill_plan'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => ({
    scanTraceIdx: index('risk_pool_scan_trace_idx').on(t.scanRunId, t.traceStatus),
    projectTraceIdx: index('risk_pool_project_trace_idx').on(t.projectId, t.traceStatus),
  }),
);

// =====================================================================
// §4.2.14 UnmappedRoute
// =====================================================================
export const unmappedRoutes = sqliteTable(
  'unmapped_routes',
  {
    id: text('id').primaryKey(),
    scanRunId: text('scan_run_id')
      .notNull()
      .references(() => scanRuns.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    candidatePath: text('candidate_path').notNull(),
    detectedSignal: text('detected_signal').notNull(),
    controllerClass: text('controller_class'),
    backfillAttempts: integer('backfill_attempts').notNull().default(0),
    status: text('status', {
      enum: ['PENDING', 'BACKFILLED', 'ABANDONED', 'RESOLVED_USER_TERMINATE'],
    })
      .notNull()
      .default('PENDING'),
    abandonReason: text('abandon_reason'),
    lastAttemptedAt: integer('last_attempted_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    scanStatusIdx: index('unmapped_scan_status_idx').on(t.scanRunId, t.status),
    projectStatusIdx: index('unmapped_project_status_idx').on(t.projectId, t.status),
  }),
);

// =====================================================================
// §5.7 Git Credentials —— system/project 两种 scope 的 SSH Key / HTTPS Token
// secret_enc:AES-256-GCM 加密落盘(复用 crypto.util.ts),前端不回显明文
// =====================================================================
export const gitCredentials = sqliteTable(
  'git_credentials',
  {
    id: text('id').primaryKey(),
    scope: text('scope', { enum: ['system', 'project'] }).notNull(),
    projectId: text('project_id').references(() => projects.id), // scope='project' 时必填
    label: text('label').notNull(), // 友好别名,如 "GitHub 个人 token"
    kind: text('kind', { enum: ['ssh_key', 'https_token'] }).notNull(),
    hostPattern: text('host_pattern').notNull(), // e.g. "github.com" / "*"
    username: text('username'), // https_token 用
    secretEnc: text('secret_enc').notNull(), // AES-256-GCM 加密的私钥或 token
    fingerprint: text('fingerprint').notNull(), // 末 4 位 / SHA 短摘要
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    activeIdx: index('git_credentials_active_idx').on(t.isActive),
    scopeProjectIdx: index('git_credentials_scope_project_idx').on(t.scope, t.projectId),
    hostPatternIdx: index('git_credentials_host_pattern_idx').on(t.hostPattern),
  }),
);

// =====================================================================
// §5.7 AI Key 配置(每条对应一个 AI 厂商)
// api_key_enc:AES-256-GCM 加密落盘,密钥从 APP_MASTER_KEY 环境变量读取
// =====================================================================
export const aiKeys = sqliteTable(
  'ai_keys',
  {
    id: text('id').primaryKey(),
    provider: text('provider', {
      enum: ['openai', 'anthropic', 'deepseek', 'minimax', 'custom'],
    }).notNull(),
    label: text('label').notNull(), // 友好别名,如 "主 OpenAI Key"
    baseUrl: text('base_url').notNull(),
    apiKeyEnc: text('api_key_enc').notNull(), // 加密的 key(密文 + IV + auth tag 一起 base64)
    defaultModel: text('default_model').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    availableModels: text('available_models', { mode: 'json' }).$type<string[]>().notNull(),
    lastTestAt: integer('last_test_at'),
    lastTestStatus: text('last_test_status', { enum: ['unknown', 'success', 'failed'] })
      .notNull()
      .default('unknown'),
    lastTestMessage: text('last_test_message'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    activeIdx: index('ai_keys_active_idx').on(t.isActive),
    providerIdx: index('ai_keys_provider_idx').on(t.provider),
  }),
);
