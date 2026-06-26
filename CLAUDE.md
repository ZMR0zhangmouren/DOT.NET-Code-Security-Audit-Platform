# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库当前状态(2026-06-27)

文档驱动期 + 平台代码骨架已落盘。根目录含:

- `./需求文档.md` —— 1,418 行的产品/技术规格,锁定了 Q1–Q17 共 17 项决策
- `./dotnet-security-audit-skill/` —— **独立 git 仓库**(独立 .git/、独立 main 分支),内含 38 个 .NET 审计 skill + 主 agent.md + 9 份 shared 规范;平台不修改它
- `./apps/api/` —— **NestJS 后端骨架**(health check 已通,后续按 §5.x 扩 module)
- `./apps/web/` —— **React + Vite + shadcn/ui 前端骨架**(健康检查 UI 已通)
- `./packages/shared/` —— 跨 api/web 共享的枚举与类型(严格对应 §4.2 / §11)
- `./pnpm-workspace.yaml` + `./package.json` + `./tsconfig.base.json` —— pnpm workspace + TS / ESLint / Prettier / Vitest 全栈配置
- `./eslint.config.js` + `./.prettierrc.json` + `./vitest.config.ts` —— 跨包统一代码风格

## 核心技术栈(锁定)

| 角色 | 选型 |
|------|------|
| AI 编排 | `@openai/agents`(OpenAI Agents SDK, TS/JS) |
| 后端 | NestJS 10 + TypeScript 5.7 |
| 前端 | React 18 + Vite 6 + shadcn/ui + Tailwind CSS 3 |
| 数据库 | SQLite 3.x + Drizzle ORM(MVP) |
| 包管理 | pnpm 10(workspace) |
| 测试 | Vitest 2(shared/api/web 三个 project) |
| Lint | ESLint 9(flat config)+ Prettier 3 |
| 运行时 | Node.js ≥ 20 LTS(本机 24.14.1) |

## Monorepo 布局

```
.
├── apps/
│   ├── api/      # @platform/api  —— NestJS(CommonJS)
│   └── web/      # @platform/web  —— React + Vite(ESM)
├── packages/
│   └── shared/   # @platform/shared —— 跨包枚举与类型
├── pnpm-workspace.yaml
├── package.json        # 根:scripts + 共享 devDeps
├── tsconfig.base.json  # 共享 TS 配置(strict + noUncheckedIndexedAccess)
├── eslint.config.js    # ESLint flat config
├── vitest.config.ts    # 根 vitest 占位(workspace 模式在 Windows 长路径下有兼容性问题)
└── .prettierrc.json / .prettierignore
```

每个子包自带 `vitest.config.ts` 与 `tsconfig.json`,根 `pnpm test` 通过 `pnpm -r test` 触发各包独立跑测试。

## 子仓库关系(硬约束)

- `./dotnet-security-audit-skill/` 是**独立嵌入的 git 仓库**,平台**不修改**它,子仓库通过自身 git 流程演进
- 平台通过 `SkillBundleVersion` 锁定子仓库某次 commit(git_commit + snapshot_path)
- 子仓库结构(平台侧只读):
  - `agents/dotnet代码审计.agent.md` —— 主 Agent 提示词,平台加载到 instructions 中部
  - `skills/dotnet-audit-pipeline/SKILL.md` —— 总编排方法论,平台加载到 instructions **头部**
  - `skills/{route-mapper, auth-audit, vuln-scanner, route-tracer, framework×9, vuln×31, exploit-chain}/SKILL.md` —— 运行时按需通过 `invokeSkill` Tool 调用
  - `shared/*.md` —— EVIDENCE_POINT_IDS / IO_PATH_CONVENTION / DOTNET_SINK_REFERENCE 等 9 份

## 常用命令

```bash
pnpm install              # 装依赖
pnpm -r typecheck         # 三个子包 tsc --noEmit
pnpm -r test              # 各包独立跑 vitest
pnpm -r build             # 编译
pnpm lint                 # ESLint + Prettier --check(0 错 0 警)
pnpm format               # Prettier --write

# 单包开发
pnpm --filter @platform/api dev          # nest start --watch
pnpm --filter @platform/web dev          # vite
```

dev 期联调:`apps/web` Vite dev server 把 `/api` 与 `/socket.io` 代理到 `apps/api` 的 127.0.0.1:3000(已写进 `apps/web/vite.config.ts`)。

## 已落地验证

- ✅ `pnpm install`(836 包)
- ✅ `pnpm -r typecheck`(shared / api / web 全绿)
- ✅ `pnpm -r test`(11 测试通过:shared 6 + api 3 + web 2)
- ✅ `pnpm lint`(ESLint 0 错 0 警 + Prettier 干净)
- ✅ `GET /api/health` 返回 `{status, uptimeSec, coverageModeDefault, nodeVersion}`

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
