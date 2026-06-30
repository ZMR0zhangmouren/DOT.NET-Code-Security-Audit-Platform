# .NET 代码安全审计平台

> 把已有的 38 个 .NET 审计 Skill,从单点 CLI 工具升级为团队级 Web 平台。
> 基于 [`@openai/agents`](https://www.npmjs.com/package/@openai/agents) 自托管,完全脱离 Copilot CLI / IDE 插件。

<p align="left">
  <a href="#-快速启动"><img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520%20LTS-339933?logo=node.js&logoColor=white"></a>
  <a href="#-测试与质量门禁"><img alt="tests" src="https://img.shields.io/badge/tests-454%20passed-4c1?logo=vitest&logoColor=white"></a>
  <a href="#-测试与质量门禁"><img alt="coverage api" src="https://img.shields.io/badge/api%20coverage-80.18%25-brightgreen"></a>
  <a href="#-测试与质量门禁"><img alt="coverage shared/web" src="https://img.shields.io/badge/shared%2Fweb%20coverage-100%25-brightgreen"></a>
  <a href=".github/workflows/ci.yml"><img alt="ci" src="https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=github-actions&logoColor=white"></a>
  <a href="#-许可证"><img alt="license" src="https://img.shields.io/badge/license-Internal-lightgrey"></a>
</p>

[English Version](./README.en.md)

---

## 🏗️ 项目简介

`.NET` 代码安全审计平台是一套**自托管的白盒代码审计 Web 平台**:用户在浏览器里上传 `.NET` 源码 zip,后端用 OpenAI Agents SDK 加载本地 `./dotnet-security-audit-skill/`(上游开源 .NET 审计 Skill 集合,clone 自 [`ZMR0zhangmouren/dotnet-security-audit-skill`](https://github.com/ZMR0zhangmouren/dotnet-security-audit-skill))的 38 个审计 Skill(基础设施 6 + 框架专项 9 + 漏洞专项 31 + shared 规范 9),按"先分后合"两阶段策略产出可读、可分派、可追踪的漏洞库与报告。

- **🎯 核心目标** —— 把子仓库已有的"审计编排者"**可被 Web 多人协作、被持久化、被审计**,而不是另起一套编排(Q17 硬约束)
- **🚫 非目标** —— 不替换/不修改 `./dotnet-security-audit-skill/`(上游开源项目,由 [`ZMR0zhangmouren/dotnet-security-audit-skill`](https://github.com/ZMR0zhangmouren/dotnet-security-audit-skill) 维护,平台通过 `SkillBundleVersion` 锁定其 commit);不让 Agent 自主修改源码;不脱离 `@openai/agents`(Q14 锁定)

## ✨ 核心特性

| # | 能力 | 说明 |
|---|------|------|
| 1 | **多端点接入** | `zip` 上传 / `from-git`(HTTPS + SSH + 8 类错误分类)/ `from-github`(REST tarball + 凭证优先级 env > git_credentials) |
| 2 | **真实并发扫描** | BullMQ + Redis,默认并发 2,可配 1–10;崩溃可恢复 + Bull-Board 可视化 |
| 3 | **漏洞库 + 实例双层** | `VulnLibraryEntry` 聚合根因,`Vulnerability` 记录实例;跨 ScanRun 自动去重 |
| 4 | **多 ScanRun 对比** | `GET /api/projects/:id/scans/diff?a=&b=` 返回完整 `ScanDiff` |
| 5 | **真 JWT + 角色守卫** | `JwtStrategy` + `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')` 拦截写端点 |
| 6 | **多 Skill Bundle 并存** | `setDefault` 事务原子;`replay-with-latest` 用最新 Skill 重跑旧 ScanRun |
| 7 | **报告 Markdown 渲染** | `react-markdown` + `remark-gfm` + `rehype-highlight` + 章节导航 |
| 8 | **Agent Trace 全链路追踪** | `agent_traces` 表 + `/api/scan-runs/:id/trace` + Timeline 页面 |
| 9 | **覆盖率门禁** | `@vitest/coverage-v8` + shared/web 100% / api 80.18% 阈值启用 |
| 10 | **Docker 化部署** | `apps/api` + `apps/web` 多阶段构建 + `docker-compose.yml` 3 服务 |

## 🚀 快速启动

> **前置**:Node.js ≥ 20 LTS · pnpm 10 · (可选)Docker Desktop 用于 Redis

```powershell
# 1. 安装依赖
pnpm install

# 2. 启动 Redis(扫描队列需要)
docker run -d -p 6379:6379 --name audit-redis redis:7-alpine

# 3. 种子默认管理员账号(admin / admin123)
pnpm --filter @platform/api seed

# 4. 同时启动 API(3030)+ Web(5180)
pnpm dev
```

浏览器访问 <http://127.0.0.1:5180> → 用 `admin` / `admin123` 登录 → 创建一个项目 → 上传 `.NET` 源码 zip → 在 `ScanRun` 详情页看实时日志、阶段产物、最终报告。

> Windows 用户也可直接双击根目录的 `start.bat` / `stop.bat` / `status.bat`。

## 🧱 技术栈

| 角色 | 选型 |
|------|------|
| AI 编排 | `@openai/agents`(OpenAI Agents SDK,TS/JS)+ `openai` SDK |
| 后端 | NestJS 10 + TypeScript 5.7 + Drizzle ORM |
| 前端 | React 18 + Vite 5.4 + shadcn/ui + Tailwind CSS 3 |
| 数据库 | SQLite 3.x(MVP,17 张表)+ Drizzle 迁移 |
| 任务队列 | BullMQ + Redis(扫描并发 / 崩溃恢复)+ Bull-Board |
| 鉴权 | `@nestjs/jwt` + `passport-jwt` + argon2id 哈希 |
| 测试 | Vitest 2 + `@vitest/coverage-v8`(shared/api/web 三 project) |
| Lint | ESLint 9(flat config)+ Prettier 3 |
| 包管理 | pnpm 10(workspace) |
| 部署 | 本地 `pnpm dev` / `start.bat` · Docker 多阶段构建(`docker-compose.yml`) |

## 📂 仓库结构

```
.
├── apps/
│   ├── api/                          # @platform/api —— NestJS 21 个模块
│   │   └── src/
│   │       ├── admin/                #   admin 子树:queue-board(Bull-Board)
│   │       ├── agents/               #   @openai/agents 加载器 + PoC
│   │       ├── agent-traces/         #   ★ Phase 3 全链路追踪
│   │       ├── auth/                 #   JWT + argon2id + 改密码
│   │       ├── code-versions/        #   zip 上传 + SHA-256 + LOC + from-git
│   │       ├── git-clone/            #   §5.7 真接 git clone(8 类错误)
│   │       ├── scan/                 #   ScanModule + Runner + BullMQ worker
│   │       ├── skills/               #   ★ 子仓库 Skill vendor 执行器
│   │       ├── report/               #   Markdown / JSON / zip 报告
│   │       ├── vulns/                #   VulnLibrary + Vulnerability 双层
│   │       ├── projects/             #   CRUD + Members
│   │       ├── users/                #   用户管理
│   │       ├── settings/             #   AI Key(AES-256-GCM)+ 凭证 + 代理
│   │       ├── skill-bundles/        #   多 Bundle 并存 + setDefault
│   │       ├── realtime/             #   WebSocket Gateway
│   │       ├── health/               #   /api/health + 队列状态
│   │       └── db/                   #   Drizzle schema(17 表)+ 迁移
│   └── web/                          # @platform/web —— React + Vite(ESM)
│       └── src/pages/                #   12 页面(Login/Projects/Report/Trace/...)
├── packages/
│   └── shared/                       # @platform/shared —— 跨包枚举与类型
├── dotnet-security-audit-skill/      # ★ 上游开源 .NET 审计 Skill 集合(clone 自 github.com/ZMR0zhangmouren/),平台通过 SkillBundleVersion 锁定 commit,不直接修改
│   ├── agents/dotnet代码审计.agent.md   #   主 Agent 提示词
│   ├── skills/dotnet-audit-pipeline/   #   ★ 总编排方法论
│   ├── skills/{route-mapper,auth-audit,vuln-scanner,...}/
│   └── shared/*.md                    #   9 份共享规范
├── docs/                              # 部署/运维文档(DOCKER.md ...)
├── start.bat / stop.bat / status.bat  # Windows 快捷脚本
├── docker-compose.yml                 # ★ 3 服务(api / web / redis)
├── eslint.config.js · .prettierrc.json · vitest.config.ts
├── pnpm-workspace.yaml · tsconfig.base.json
├── 需求文档.md                          #   1,418 行产品/技术规格(Q1–Q17 锁定)
└── CLAUDE.md                          #   给 AI 助手的项目级工作守则
```

## 🔁 平台架构(ASCII)

```
                       ┌─────────────────────────────────────┐
                       │  Browser  (React + Vite + shadcn/ui) │
                       │  127.0.0.1:5180                      │
                       └────────────────┬────────────────────┘
                                            │  /api  /socket.io
                                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  apps/api  (NestJS 10 · 127.0.0.1:3030)                                  │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ AuthGuard  │→ │ Controllers│→ │  Services   │→ │ Drizzle / SQLite │  │
│  │ JwtStrategy│  │ (16 mods)  │  │ (21 mods)   │  │   17 张表         │  │
│  └────────────┘  └────────────┘  └──────┬──────┘  └──────────────────┘  │
│                                          │                               │
│                                          ▼                               │
│                              ┌──────────────────────┐                    │
│                              │ BullMQ Queue(Redis)  │                    │
│                              │ ScanQueue / Process  │                    │
│                              └──────────┬───────────┘                    │
│                                         │                                │
│                                         ▼                                │
│                        ┌─────────────────────────────────┐                │
│                        │ ScanRunnerService               │                │
│                        │  ├─ kickoff → 4 skills          │                │
│                        │  ├─ invokeSkill (vendor)        │                │
│                        │  └─ AgentTracesService.record   │                │
│                        └──────────┬──────────────────────┘                │
│                                   │ load instructions                      │
│                                   ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  ./dotnet-security-audit-skill/  (上游开源 .NET Skill 集合)         │  │
│  │   agents/dotnet代码审计.agent.md   ←── 主 Agent                      │  │
│  │   skills/dotnet-audit-pipeline/SKILL.md ←── 总编排方法论             │  │
│  │   skills/{route-mapper,framework×9,vuln×31,exploit-chain}/SKILL.md   │  │
│  │   shared/*.md (9 份规范)                                              │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
                            ┌──────────────────────────────┐
                            │ Redis  (docker,127.0.0.1:6379)│
                            └──────────────────────────────┘
```

## 🎯 核心模块

| 模块 | 路由前缀 | 职责 |
|------|---------|------|
| `auth` | `/api/auth/*` | 登录(JWT 15min)、改密码、`/me`、密码强度校验 |
| `projects` | `/api/projects/*` | 项目 CRUD、Members grant/revoke/role |
| `code-versions` | `/api/code-versions/*` | zip 上传、SHA-256、LOC、`from-git`、`from-github` |
| `scan` | `/api/scan-runs/*` | 启动 / 进度 / 取消 / 重跑 / Diff / 覆盖统计 |
| `vulns` | `/api/projects/:id/vuln-library/*` | 漏洞库聚合 + 详情 + 趋势图 |
| `report` | `/api/projects/:id/scans/:runId/report` | Markdown / JSON / zip 导出 |
| `agent-traces` | `/api/scan-runs/:id/trace*` | 完整 trace / summary / 单条 |
| `skill-bundles` | `/api/skill-bundle-versions/*` | 只读 + `setDefault` / `publish` |
| `settings` | `/api/settings/*` | AI Key(AES-256-GCM)、Git Credentials、Proxy |
| `users` | `/api/users/*` | 用户 CRUD(admin only) |
| `realtime` | `/socket.io` | 扫描日志 / 进度 WebSocket |
| `admin/queue-board` | `/admin/queue` | Bull-Board 队列可视化(JWT admin OR Basic) |

## ⚙️ 常用命令

```powershell
# 全栈
pnpm install              # 装依赖
pnpm -r typecheck         # 三个子包 tsc --noEmit
pnpm -r test              # 各包跑 Vitest(api 405 / shared 6 / web 43)
pnpm -r test --coverage   # 生成 v8 覆盖率
pnpm lint                 # ESLint + Prettier --check
pnpm format               # Prettier --write
pnpm -r build             # 编译 api + web + shared

# 单包开发
pnpm --filter @platform/api dev      # nest start --watch
pnpm --filter @platform/web dev      # vite
pnpm --filter @platform/api seed     # 创建默认 admin 账号

# Docker
docker compose up -d --build         # 一键起 3 服务(api / web / redis)
```

## 🧪 测试与质量门禁

| 项 | 状态 | 数值 |
|----|------|------|
| 测试总数 | ✅ | **454 passed**(shared 6 · api 405 · web 43),0 失败 0 警告 |
| 覆盖率 | ✅ | shared / web **100%** + api **80.18%**,阈值已启用并通过 |
| TypeScript | ✅ | `pnpm -r typecheck` 三包全绿 |
| Lint | ✅ | ESLint **0 错 0 警** + Prettier 干净 |
| CI | ✅ | `.github/workflows/ci.yml` 8 step:`checkout → setup-node → pnpm cache → install(--frozen-lockfile) → typecheck → test → lint → coverage artifact` |

## 🐳 Docker 部署

```bash
docker compose up -d --build
```

起三个容器:

- `api` —— `apps/api` 多阶段构建(node:20-alpine + musl better-sqlite3 编译)
- `web` —— `apps/web` 多阶段构建(node:20-alpine build → nginx:1.27-alpine serve)
- `redis` —— `redis:7-alpine`,供 BullMQ 使用

`api` 启动时 `docker-entrypoint.sh` 自动跑 Drizzle 迁移 + seed admin 账号。

详见 [`docs/DOCKER.md`](./docs/DOCKER.md)。

## 🗺️ 路线图

### ✅ 已落地(本仓库当前状态)

- ✅ 多 Skill Bundle 并存 + `replay-with-latest`(§11 Q7)
- ✅ 真接 `from-git`(HTTPS token + SSH key + 8 类错误分类)
- ✅ 真接 `from-github`(REST tarball + 凭证优先级 env > git_credentials)
- ✅ BullMQ + Redis + Bull-Board 可视化
- ✅ 真 JWT 解码 + AdminGuard + `@Roles('admin')` 拦截写端点
- ✅ Agent Trace 全链路追踪(`agent_traces` 表 + 端点 + Timeline 页面)
- ✅ 多 ScanRun 对比 + 报告 Markdown 渲染 + 章节导航
- ✅ Vitest coverage v8 provider + 阈值强制门禁
- ✅ Phase 4 Docker 化部署(多阶段 + compose)
- ✅ refresh-token + HttpOnly Cookie + 旋转/吊销
- ✅ Phase 3 漏洞趋势图(VulnLibrary 按时间聚合)

### 📋 待办候选

- Phase 2 e2e:web 端 React Testing Library 覆盖 `pages/` 12 个页面
- 真 git clone e2e:用公开 repo + 真凭证实测
- Skill 升级自动跑一遍重扫(CI hook)
- 远程备份:用户配置 git remote URL 后 `git push`

完整历史见 [`CLAUDE.md`](./CLAUDE.md) 与 [`需求文档.md`](./需求文档.md)。

## 📜 许可证

Internal / 暂未开源。所有 commit 仅留本地 `main`(参见 [`CLAUDE.md`](./CLAUDE.md) "本地推进,不远程推送")。

---

<sub>由 Claude Code 协助构建 · 2026-06-30</sub>