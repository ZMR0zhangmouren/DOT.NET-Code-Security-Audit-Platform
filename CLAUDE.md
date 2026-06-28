# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库当前状态(2026-06-28)

§5.3 / §5.4 / §5.5 三大主流程 + §5.5 Vuln Library 真按钮 + §4.2.8 Members UI + §5.3 API 覆盖统计 + §5.7 git 凭证 + 代理 UI 已全部落地;可端到端跑通一次完整审计 + 出报告 + 漏洞库管理 + 项目成员协作 + 系统配置。根目录含:

- `./需求文档.md` —— 1,418 行的产品/技术规格,锁定了 Q1–Q17 共 17 项决策
- `./dotnet-security-audit-skill/` —— **独立 git 仓库**(独立 .git/、独立 main 分支),内含 38 个 .NET 审计 skill + 主 agent.md + 9 份 shared 规范;平台不修改它
- `./apps/api/` —— **NestJS 后端**(modules: agents / auth / code-versions / db / health / projects / realtime / report / scan / settings / skill-bundles / storage / users / vulns,共 14 个)
- `./apps/web/` —— **React + Vite + shadcn/ui 前端**(路由: /login / /projects / /projects/:id / /projects/:id/scans/:runId / /projects/:id/scans/:runId/report / /projects/:id/vuln-library / /projects/:id/vuln-library/:libId / /admin/users / /admin/config)
- `./packages/shared/` —— 跨 api/web 共享的枚举与类型(严格对应 §4.2 / §11)
- `./pnpm-workspace.yaml` + `./package.json` + `./tsconfig.base.json` —— pnpm workspace + TS / ESLint / Prettier / Vitest 全栈配置
- `./eslint.config.js` + `./.prettierrc.json` + `./vitest.config.ts` —— 跨包统一代码风格
- `./start.bat` + `./stop.bat` + `./status.bat` —— Windows 快捷脚本(双击执行)

## 核心技术栈(锁定)

| 角色 | 选型 |
|------|------|
| AI 编排 | `@openai/agents`(OpenAI Agents SDK, TS/JS)+ `openai` SDK(实际跑通) |
| 后端 | NestJS 10 + TypeScript 5.7 |
| 前端 | React 18 + Vite 5.4 + shadcn/ui + Tailwind CSS 3 |
| 数据库 | SQLite 3.x + Drizzle ORM(MVP) |
| 包管理 | pnpm 10(workspace) |
| 测试 | Vitest 2(shared/api/web 三个 project) |
| Lint | ESLint 9(flat config)+ Prettier 3 |
| 运行时 | Node.js ≥ 20 LTS(本机 24.14.1) |

## Monorepo 布局

```
.
├── apps/
│   ├── api/        # @platform/api  —— NestJS 14 modules
│   │   └── src/
│   │       ├── agents/        # @openai/agents loader + PoC
│   │       ├── auth/          # JWT + argon2id 登录
│   │       ├── code-versions/ # §5.2 zip 上传 + SHA-256 + LOC
│   │       ├── scan/          # §5.3 ScanModule + Runner + tools
│   │       ├── report/        # §5.4 Markdown/JSON/zip
│   │       ├── vulns/         # §5.5 VulnLibraryService + VulnService
│   │       ├── projects/      # §5.1 CRUD
│   │       ├── users/         # 用户管理
│   │       ├── settings/      # AI Key(AES-256-GCM 加密)
│   │       ├── skill-bundles/ # SkillBundleVersion 只读
│   │       ├── storage/       # 路径工具
│   │       ├── realtime/      # WebSocket Gateway
│   │       ├── health/        # /api/health
│   │       └── db/            # drizzle schema(15 表)+ DatabaseModule + seed
│   └── web/        # @platform/web  —— React + Vite(ESM)
│       └── src/
│           ├── pages/         # 11 个页面
│           ├── components/    # AppLayout + shadcn/ui
│           ├── hooks/          # useAuth + useScanSocket
│           └── lib/            # api client + scanTypes
└── packages/
    └── shared/     # @platform/shared —— 跨包枚举与类型
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

dev 期联调:`apps/web` Vite dev server 把 `/api` 与 `/socket.io` 代理到 `apps/api` 的 127.0.0.1:3030(已写进 `apps/web/vite.config.ts`)。

**端口约定**(避免与其它项目冲突):
- API:`3030`(默认,在 `.env` 用 `PORT` 覆盖)
- Web dev:`5180`(默认)
- 仅监听 `127.0.0.1`,不暴露公网(§6.5)

## Windows 快捷脚本(双击执行)

| 脚本 | 用途 |
|------|------|
| `start.bat` | 后台启动 API + Web,日志写到 `logs/api.log` / `logs/web.log`,自动开浏览器 |
| `stop.bat` | 按端口定位 PID,精准关闭 3030 与 5180 上的进程(不影响其它项目) |
| `status.bat` | 显示两个端口的 RUNNING / STOPPED 状态 |

用法:在资源管理器里**双击**对应 `.bat` 即可,无需打开终端。

## 默认账号(种子数据)

启动 API 后,执行一次种子:

```bash
pnpm --filter @platform/api seed
```

会创建默认 admin 账号:

- username: `admin`
- password: `admin123`
- role: admin

§6.2 要求首次登录后改密码(留 Phase 2 接)。POST /api/auth/login → 返回 JWT(15min)→ 前端存 localStorage。

## 已落地功能(2026-06-28)

- ✅ `pnpm install`(836 包)
- ✅ `pnpm -r typecheck`(shared / api / web 全绿)
- ✅ `pnpm -r test`(9 测试通过:shared 6 + api 2 + web 1)
- ✅ `pnpm lint`(ESLint 0 错 0 警 + Prettier 干净)
- ✅ **§5.3 Scan 主流程**:从 zip 上传 → Agent 调 MiniMax 跑 115 秒 → 3 漏洞入库 + 1 漏洞库条目
- ✅ **§5.3 API 覆盖统计**:report §1 checklist 的 API 入口覆盖可勾选汇总(1bc9df4)
- ✅ **§5.4 报告导出**:Markdown / JSON / zip 归档包三端点工作
- ✅ **§5.5 漏洞库 UI**:列表 + 详情 + 状态流转(open / fixing / fixed / ignored),ProjectDetailPage 上 Vuln Library tab 已从 "Phase X 待上" 变成真按钮(bde81f9)
- ✅ **§4.2.8 Members UI**:ProjectDetailPage 上 Members tab 从 "Phase X 待上" 变成真页面 —— 邀请 / 角色 / 移除(bde81f9)
- ✅ **§5.7 git 凭证 + 代理 UI**:`/admin/config` 页面新增 git 凭证(GitHub PAT)与代理配置(6b8cb83)
- ✅ GET `/api/health` 返回 `{status, uptimeSec, coverageModeDefault, nodeVersion, dbTables: 15}`

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

## 下一步候选(2026-06-28 休息点后)

| 候选 | 工作量 | 价值 | 状态 |
|------|--------|------|------|
| ProjectDetailPage 把 "Vuln Library" tab 从"Phase X"变真 tab | 5 分钟 | 完成 §5.5 UI 闭环 | ✅ bde81f9 |
| §5.3 API 覆盖统计(让 §1 checklist 入口覆盖打勾) | 1 小时 | 让报告 §1 完整 | ✅ 1bc9df4 |
| §4.2.8 Members UI(把 Members tab 从"Phase X"变真) | 半天 | 多人协作基础 | ✅ bde81f9 |
| §5.7 git 凭证 + 代理 UI | 半天 | 完善系统配置 | ✅ 6b8cb83 |
| 真正跑多个 scan + 报告对比(两个 ScanRun 差异) | 2 小时 | Phase 2 §5.4 完整 | 进行中(scan-diff.controller/service/util + 测试,主 session 写) |
| BullMQ 真正并发扫描(Q6) | 1-2 天 | 性能 | 进行中(scan-queue.service.ts 主 session 写) |
| ProjectDetailPage 还剩 Versions / Scans 两个 tab 显示 "Phase X 待上",待接通 | 半天 | 详情页 UI 闭环 | 待办 |
| §5.7 真正接 git 凭证(目前只 UI,不实际 clone) | 1 天 | 让 §5.7 真闭环 | 待办 |

## 已知遗留(不阻塞)

- 子仓库脏工作树已于 2026-06-28 commit `973167f` 清理(子仓库独立演进):`temp/expert-debate/**`(16 docs R29-30 scratch)+ `audit_skill_optimization.md` + `agents/安全专家.agent.md`(alt-name 已被 `dotnet代码审计.agent.md` 取代)+ `darwin-skill/**` + `.claude/settings.local.json` + 子仓库 `CLAUDE.md` 共 27 个文件、11822 行删除
- ProjectDetailPage 还剩 Versions / Scans 两个 tab 显示 "Phase X 待上",Members / Vuln Library 已接通
- §5.7 git 凭证目前只 UI,未实际接 git clone;§5.7 真闭环留待 Phase 2
- `.gitignore` 已加 `*.tsbuildinfo`,但 `apps/api/tsconfig.tsbuildinfo` 和 `apps/web/tsconfig.tsbuildinfo` 还是 tracked(主 session 取消跟踪)
