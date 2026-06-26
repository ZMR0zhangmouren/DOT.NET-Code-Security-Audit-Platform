# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库当前状态(2026-06-26)

文档驱动期。根目录仅含:

- `./需求文档.md` —— 1,418 行的产品/技术规格,锁定了 Q1–Q17 共 17 项决策
- `./dotnet-security-audit-skill/` —— **独立 git 仓库**(独立 .git/、独立 main 分支),内含 38 个 .NET 审计 skill + 主 agent.md + 9 份 shared 规范;平台不修改它

平台应用代码(`apps/api` NestJS / `apps/web` React)尚未落盘,本文档主要为后续动工做约定。

## 核心技术栈(锁定)

| 角色 | 选型 |
|------|------|
| AI 编排 | `@openai/agents`(OpenAI Agents SDK, TS/JS) |
| 后端 | NestJS + TypeScript |
| 前端 | React + Vite + shadcn/ui + Tailwind CSS |
| 数据库 | SQLite 3.x + Drizzle ORM(MVP) |
| 包管理 | pnpm(workspace 模式) |
| 运行时 | Node.js ≥ 20 LTS(本机 24.14.1) |

## 子仓库关系(硬约束)

- `./dotnet-security-audit-skill/` 是**独立嵌入的 git 仓库**,平台**不修改**它,子仓库通过自身 git 流程演进
- 平台通过 `SkillBundleVersion` 锁定子仓库某次 commit(git_commit + snapshot_path)
- 子仓库结构(平台侧只读):
  - `agents/dotnet代码审计.agent.md` —— 主 Agent 提示词,平台加载到 instructions 中部
  - `skills/dotnet-audit-pipeline/SKILL.md` —— 总编排方法论,平台加载到 instructions **头部**
  - `skills/{route-mapper, auth-audit, vuln-scanner, route-tracer, framework×9, vuln×31, exploit-chain}/SKILL.md` —— 运行时按需通过 `invokeSkill` Tool 调用
  - `shared/*.md` —— EVIDENCE_POINT_IDS / IO_PATH_CONVENTION / DOTNET_SINK_REFERENCE 等 9 份

## 已锁定决策(Q1–Q17)

完整列表见 `@./需求文档.md` §11。下面是必须遵守的硬约束:

- **Q14**:AI 编排 = `@openai/agents`,**脱离 Copilot CLI / IDE 插件**,平台自托管
- **Q15**:漏洞管理 = **漏洞库 + 实例双层**(`VulnLibraryEntry` 聚合根因 + `Vulnerability` 记录实例)
- **Q16**:fingerprint = `sha256(file_path + vuln_type + normalize(code_snippet))`,MVP 用规则化
- **Q17**:**编排不在平台侧**;平台直接加载 `agents/dotnet代码审计.agent.md` 作为主 Agent 的 `instructions`,平台只负责 Tool 注入、沙箱、产物落盘、Trace 与漏洞库持久化

修改 `需求文档.md` 前**必须**先跑 `/decision-check`;改完后再跑一次确认未违反 Q1–Q17。

## 阶段产物落盘约定

每次扫描的结构化产物落在 `ScanRun.output_root` 下,目录约定见 `@./需求文档.md` §2.9。简版:

```text
{output_root}/
├── route_mapping/    auth_audit/    route_tracer/
├── vuln_audit/       vuln_poc/      framework_audit/
├── cross_analysis/   vuln_report/   exploit_chain/
└── quality/          ★ 收尾锚点(api_coverage_gate / consistency_check / quick_validation / final_anchor_checklist)
```

**任何阶段产物缺失 = 该阶段未完成**;不得静默跳过。

## 覆盖门禁(硬门禁,继承自 dotnet-audit-pipeline/SKILL.md)

详见 `@./需求文档.md` §2.8。下面三条必须记忆:

1. `api_coverage_status != COMPLETE` ⇒ **`pipeline_execution` 不得 = COMPLETED**
2. `final_anchor_decision = BLOCKED` ⇒ 最终报告**不得**写"可交付/已通过/收尾完成"
3. 任何两个产物的关键字段冲突 ⇒ 写入 `EvidenceConflict`,**不得静默覆盖**

## 沟通偏好

继承全局 `~/.claude/CLAUDE.md`:中文沟通、简洁但完整、用 markdown 表格、代码块带语言标识、术语首次出现给中文解释。

## Skills / Hooks

- `/decision-check <改动说明>` —— 验证 `需求文档.md` 改动是否违反 Q1–Q17
- `/scan-doc` —— 扫 `需求文档.md` 残留过时表述(LangGraph、Orchestrator)+ 检查 §2.8 必备章节
- 编辑 `.md` 文件后自动跑 markdownlint-cli2
- `git push --force` / `git push origin main` 命令会被拦截(平台期 + 子仓库期都适用)

## 后续清理项(不阻塞动工)

- `./dotnet-security-audit-skill/` 子仓库脏工作树有 tracked deletions(`CLAUDE.md` / `.claude/settings.local.json` / `.agents/skills/darwin-skill/*` 等);`darwin-skill/` 目录已空但仍在工作树;本轮未触碰,后续按需 `git checkout -- .` 或 commit 清理
- 平台代码落盘后再补充 `package.json` / `pnpm-workspace.yaml` / `tsconfig.json` / `.prettierrc` / `.eslintrc` 等
