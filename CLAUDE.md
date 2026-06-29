# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库当前状态(2026-06-29)

§5.1–§5.7 全章节 + §11 Q6(BullMQ + Redis + Bull-Board)+ §11 Q7(多 Skill Bundle 并存 + replay-with-latest)+ §11 Q13(代理 / git 凭证)+ §5.4 多 ScanRun 对比 + §5.3 API 覆盖端到端 + §6.2 首次登录改密码 + §6.2 真 JWT 解码 + AdminGuard + §5.4 报告 Markdown 渲染 + §5.7 真接 git clone + §5.7 真接 from-github(GitHub REST tarball)+ §11 Q11 Phase 4 Docker 化部署(3 服务 multi-stage build)+ CI/CD pipeline + Vitest coverage v8 provider + thresholds 强制门禁(api 覆盖率 80.18%,已启用且通过)全部落地。**本会话 38 commit(`952452d` → `5da5849`),454 测试通过(shared 6 / api 405 / web 43),0 错 0 警,typecheck 全绿**。本会话第三轮 commit(`3b033b2`→`5da5849`):VulnLibrary tab 真 tab + API 覆盖统计(COMPLETE)+ 核实 ScanDiff 已实现 + MetricsService DI 补缺 + 迁移补偿 + start.bat 自动关窗 + proxy 不保存即测 + AI Key Create 按钮可用 + 413 body-parser + Upload JSON 容错 + AI Key 扫描选择 + Proxy 自定义测试 + bat 脚本 CRLF + 上传 ValidationPipe root cause + ConfigPage proxy 按钮去重 + Skill Bundle 下拉 + Overview 版本列表。端到端可跑通:

- 上传 zip → 触发 BullMQ + Redis 队列 → 115 秒 → 漏洞入库 + 自动聚合到 VulnLibraryEntry
- 多 ScanRun 对比(端到端实测,DB 真写 + redis 真跑 + diff 端点返回完整 ScanDiff)
- API 覆盖统计(recompute-coverage 端点 + DB 真写 PARTIAL/COMPLETE)
- Members grant/revoke/role change(只 owner / lead 能改)
- git 凭证 + 代理 + 真接 git clone(`POST /api/code-versions/from-git` + 错误分类:NO_CREDENTIAL / AUTH_FAILED / AUTH_FORBIDDEN / NETWORK_UNREACHABLE / TIMEOUT / DISK_FULL / GIT_NOT_FOUND)
- **真接 GitHub REST tarball API**(`POST /api/code-versions/from-github` + `GitHubService.downloadTarball` + 自写 minimal tar 解压;凭证优先级 env GITHUB_TOKEN > git_credentials;错误分类:AUTH_FAILED / AUTH_FORBIDDEN / NOT_FOUND / RATE_LIMITED / SERVER_ERROR / NETWORK_UNREACHABLE / TIMEOUT)
- 改密码(§6.2 落地)
- 真 JWT 解码 + AdminGuard(替换 x-user-id mock,`JwtStrategy` + `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')` 拦截 AI Key / Git Credentials / Proxy / Users 写端点)
- Bull-Board 队列可视化(`/admin/queue`,JWT admin OR Basic admin/admin 双通道鉴权,挂 express middleware 不走 NestJS 路由)
- 多 Skill Bundle 并存 + Replay (Latest Skill) 按钮(`POST /api/scan-runs/:id/replay-with-latest` 拿 `getDefault()` bundle 重跑)
- CI pipeline(`.github/workflows/ci.yml`,8 step,PR 自动跑 typecheck/test/lint + coverage v8 artifact)
- 报告 Markdown 渲染(react-markdown + remark-gfm + rehype-highlight + 章节导航 IntersectionObserver)

根目录含:

- `./需求文档.md` —— 1,418 行的产品/技术规格,锁定了 Q1–Q17 共 17 项决策
- `./dotnet-security-audit-skill/` —— **独立 git 仓库**(独立 .git/、独立 main 分支),内含 38 个 .NET 审计 skill + 主 agent.md + 9 份 shared 规范;平台不修改它
- `./apps/api/` —— **NestJS 后端**(modules: admin/queue-board / agents / auth / code-versions / db / git-clone / health / projects / realtime / report / scan / settings / skill-bundles / storage / users / vulns,共 16 个 + db 1)
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
| 鉴权 | `@nestjs/jwt` + `@nestjs/passport` + `passport-jwt`(`JwtAuthGuard` + `RolesGuard` + `@Roles(...)`)|
| 运行时 | Node.js ≥ 20 LTS(本机 24.14.1) |

## Monorepo 布局

```
.
├── apps/
│   ├── api/        # @platform/api  —— NestJS 14 modules
│   │   └── src/
│   │       ├── agents/        # @openai/agents loader + PoC
│   │       ├── auth/          # JWT + argon2id 登录
│   │       ├── code-versions/ # §5.2 zip 上传 + SHA-256 + LOC + §5.7 from-git
│   │       ├── scan/          # §5.3 ScanModule + Runner + tools + processor
│   │       ├── report/        # §5.4 Markdown/JSON/zip
│   │       ├── vulns/         # §5.5 VulnLibraryService + VulnService
│   │       ├── projects/      # §5.1 CRUD
│   │       ├── users/         # 用户管理
│   │       ├── settings/      # AI Key(AES-256-GCM 加密)+ Git Credentials + Proxy
│   │       ├── skill-bundles/ # SkillBundleVersion 只读 + setDefault/publish
│   │       ├── storage/       # 路径工具
│   │       ├── realtime/      # WebSocket Gateway
│   │       ├── health/        # /api/health
│   │       ├── git-clone/     # §5.7 GitCloneService(parseSourceRef + injectHttpsToken + injectSshKey + cloneRepo)
│       ├── admin/         # admin 子树:queue-board(Bull-Board 队列可视化)
│       └── db/            # drizzle schema(17 表)+ DatabaseModule + seed + 6 migration files
│   └── web/        # @platform/web  —— React + Vite(ESM)
│       └── src/
│           ├── pages/         # 12 个页面(Home/Login/Projects/ProjectDetail/Scan/Report/Diff/VulnLibrary/VulnLibraryDetail/Settings/admin/Users/admin/Config)
│           ├── components/    # AppLayout + shadcn/ui
│           ├── hooks/          # useAuth + useScanSocket(均 100% 覆盖)
│           └── lib/            # api client + scanTypes(均 100% 覆盖)
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

§6.2 首次登录后改密码已落地(`7e3ac05`):POST `/api/auth/change-password` + `/me` 页面 + 密码强度校验(≥8 字符 + 1 数字 + 1 字母)。POST `/api/auth/login` → 返回 JWT(15min,payload 含 `sub` + `role`)→ 前端存 localStorage;真 JWT 解码 + RolesGuard 已落地(`2f83a11`)。

## 已落地功能(2026-06-29)

> 本会话自 `b8ddff4`(上一轮休息点)→ `36aee78` 共 **23 commit**(`952452d` 起),以下按时间序映射到 23 行落地。`+N 测试` / `+N commit` 相对基线。

### 一、核心质量门禁

- ✅ **`pnpm install`**(836+ 包;本会话新增 react-markdown / remark-gfm / rehype-highlight / highlight.js / @tailwindcss/typography / @nestjs/bullmq / bullmq / ioredis / @bull-board/express / @bull-board/api)
- ✅ **`pnpm -r typecheck`**(shared / api / web 全绿,`36aee78` 末次验)
- ✅ **`pnpm -r test`**(**431 测试通过**:shared 6 + api 382 + web 43,从 9 → 431,**+422 测试**)
- ✅ **`pnpm lint`**(ESLint **0 错 0 警** + Prettier 干净)
- ✅ **Vitest coverage v8 provider 上线**:`fdb75f3` 三包 `vitest.config.ts` 接 `@vitest/coverage-v8`,`pnpm -r test --coverage` 生成 `coverage/{text,json-summary,html}`;`36aee78` 阈值上抬 —— shared+web **100%**(启用 70/70/60/70 阈值),api 阈值注释保留(57% 实测,Phase 2 e2e 接 supertest 后再启用)

### 二、按 commit 顺序的 23 行落地

| # | Hash | 类型 | 落地内容 |
|---|------|------|----------|
| 1 | `952452d` | [Docs] | CLAUDE.md 同步反映 §5.3/5.4/5.5 完成 |
| 2 | `bde81f9` | [Feat] | §5.5 Vuln Library 真按钮 + §4.2.8 Members UI(替换 "Phase X" 占位) |
| 3 | `1bc9df4` | [Feat] | §5.3 API 覆盖统计 + 报告 §1 checklist 勾选 |
| 4 | `6b8cb83` | [Feat] | §5.7 git 凭证 + 代理 UI(系统配置 `/admin/config`) |
| 5 | `20edc44` | [Housekeeping] | `.gitignore` 加 tsbuildinfo + CLAUDE.md 同步 |
| 6 | `e3bbe96` | [Feat] | §11 Q6 并发扫描(in-memory queue + worker pool) |
| 7 | `99c07d4` | [Feat] | §5.4 多 ScanRun 报告对比(ScanDiff 端点,端到端实测) |
| 8 | `603b443` | [Feat] | §5.3 recompute-coverage 端点 + 修 VulnService DI bug |
| 9 | `7b6e018` | [Docs] | 需求文档.md 消除 §1.2/§2/§4.2/§5.4 前后不一致 + ProxyConfig socks→socks5 |
| 10 | `982730e` | [Chore] | Versions tab 清理 + 修 2 个 pre-existing lint 警告(仓库到完美态) |
| 11 | `1661192` | [Test] | MVP 业务模块测试深度 +54 测试(60 → 119) |
| 12 | `01ed2d5` | [CI] | GitHub Actions CI pipeline(8 step,Node 20 + pnpm cache + `--frozen-lockfile`) |
| 13 | `7e3ac05` | [Feat] | §6.2 首次登录改密码(POST `/api/auth/change-password` + `/me` 页面 + 密码强度校验) |
| 14 | `dcac49a` | [Feat] | §5.4 报告 Markdown 渲染(react-markdown + remark-gfm + rehype-highlight + 章节导航) |
| 15 | `583ff18` | [Feat] | §11 Q6 并发扫描升级到 BullMQ + Redis(替换 in-memory queue,本机 docker run redis:7-alpine 跑通) |
| 16 | `2f83a11` | [Feat] | 真 JWT 解码 + AdminGuard(替换 x-user-id mock,`JwtStrategy` + `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')` 拦截 AI Key / Git Credentials / Proxy / Users 写端点) |
| 17 | `f2dda10` | [Feat] | §11 Q6 Bull-Board 接入(队列可视化 `/admin/queue`,JWT admin OR Basic admin/admin 双通道鉴权,Express middleware 挂载不走 NestJS 路由) |
| 18 | `fdb75f3` | [Test] | Vitest coverage v8 provider 上线(同上) |
| 19 | `f63c9dd` | [Docs] | CLAUDE.md 同步本会话 19 个 commit + 4 阶段 Phase 2 候选 |
| 20 | `0487fb8` | [Schema] | skill_bundle_versions + code_versions schema 扩展(§11 Q7 + §5.7,迁移 0004_skill_bundle_default.sql + 0005_code_version_clone.sql) |
| 21 | `a9f6951` | [Feat] | §11 Q7 双轨 C —— 多 Skill Bundle 并存 + "用最新 Skill 重扫"(setDefault 事务原子 + `POST /api/scan-runs/:id/replay-with-latest` + 33 个新单测) |
| 22 | `2fadec8` | [Feat] | §5.7 真接 git clone(GitCloneService + from-git API,HTTPS token 注入 + SSH key tmp 写 + 8 类错误分类 + 27 个新单测) |
| 23 | `36aee78` | [Test] | 测试覆盖率提升到 70% 阈值(**431 测试,shared/web 100% / api 57%**,32 个新 spec 文件,api 覆盖率 25.45% → 57.57%) |

### 三、关键端点 / 产物清单(本会话新增)

- `POST /api/scan-runs/:id/recompute-coverage` —— §5.3(`603b443`)
- `GET /api/projects/:id/scans/diff?a=&b=` —— §5.4 多 ScanRun 对比(`99c07d4`)
- `POST /api/auth/change-password` —— §6.2 改密码(`7e3ac05`)
- `POST /api/scan-runs/:id/replay-with-latest` —— §11 Q7 双轨 C(`a9f6951`)
- `POST /api/code-versions/from-git` —— §5.7 真接 git clone(`2fadec8`)
- `POST /api/code-versions/from-github` —— §5.7 真接 GitHub REST tarball API(env GITHUB_TOKEN > git_credentials 优先级;`GitHubService.downloadTarball` 流式 pipe + 自写 minimal tar 解压;401/403/404/429/5xx 错误分类 → NO_CREDENTIAL / AUTH_FAILED / AUTH_FORBIDDEN / NOT_FOUND / RATE_LIMITED / SERVER_ERROR)
- `GET /api/skill-bundle-versions/_` / `_/default` / `:id` + `POST :id/set-default` / `:id/publish` —— §11 Q7(`a9f6951`)
- `/admin/queue` —— §11 Q6 Bull-Board UI(`f2dda10`,Express middleware 挂载)
- `GET /api/admin/queue/health` —— §11 Q6 轻量健康端点(`f2dda10`)
- 报告渲染(react-markdown + 章节导航 IntersectionObserver)—— §5.4(`dcac49a`)
- 队列字段加到 `/api/health`:`queueDepth` / `queueRunning` / `queueMaxConcurrent`(`583ff18`)
- **`agent_traces` 表 + Agent Trace 端点** —— Phase 3 §1.2/2.7(`xxx`)
  - `GET /api/scan-runs/:id/trace` —— 完整 trace 列表(按 traceIndex 升序)
  - `GET /api/scan-runs/:id/trace/summary` —— 顶部 summary(total / token / model)
  - `GET /api/agent-traces/:id` —— 单条 trace
  - ScanRunnerService 主循环在每次 OpenAI response / tool call / tool response 调 `AgentTracesService.recordTrace`,traceIndex 单调递增
- **`/projects/:id/scans/:runId/trace` 页面** —— 时间线卡片(role 彩色 chip / content 折叠 / tool_calls JSON viewer / token footer)

### 四、基础设施

- ✅ **CI/CD pipeline**:`.github/workflows/ci.yml` 8 step + coverage artifact upload(`01ed2d5` + `fdb75f3`)
- ✅ **CI 8 step**:checkout → setup-node → pnpm cache → install(`--frozen-lockfile`)→ typecheck → test → lint → coverage artifact upload
- ✅ **BullMQ + Redis**:本机 `docker run -d -p 6379:6379 redis:7-alpine`,API 启动时 `app.get(ScanQueueService).getQueue()` 暴露给 Bull-Board
- ✅ **Bull-Board 鉴权**:JWT admin(读 `Authorization: Bearer <jwt>` 验 `sub.role==='admin'`)OR Basic admin/admin(env `BULL_BOARD_BASIC_USER/PASSWORD` 覆盖)
- ✅ **真 JWT 解码**:`JwtStrategy` 验签 + `JwtAuthGuard` 全 controller 拦截(除 `/api/health` / `/api/auth/login`),`RolesGuard` + `@Roles('admin')` 拦截写端点
- ✅ **Vitest coverage**:`@vitest/coverage-v8` 三包接,`coverage/` 目录在 CI 自动 artifact
- ✅ **§11 Q11 Phase 4 Docker 化部署**(打破 Q11 "无 Docker" 锁定,经主 session 确认):`apps/api/Dockerfile` + `apps/web/Dockerfile` multi-stage(node:20-alpine + nginx:1.27-alpine)+ `docker-compose.yml` 3 服务(api / web / redis)+ `apps/api/docker-entrypoint.sh` 自动跑迁移 + seed + `apps/web/nginx.conf` SPA + 反代;`docs/DOCKER.md` 使用说明;`.dockerignore` 锁白名单源码(关键修复:`apps/api/src/storage/` 源代码不能被 `**/storage` 误删);`docker compose up -d --build` 端到端跑通 3 容器 + 6 个 SQL 迁移 + admin seed;`curl http://127.0.0.1:8090/` 返回 React HTML,`curl http://127.0.0.1:3030/api/health` 因源码 pre-existing `import type` DI bug 失败(`apps/api/src/git-clone/git-clone.service.ts:38` 修法:`import type` → `import`,留给主 session 修)

### 五、需求文档 / 仓库自洽

- ✅ **需求文档前后统一**:`7b6e018` 消除 §1.2 / §2.1 / §4.2.5 / §5.4 / §2.5 等 10 处前后不一致
- ✅ **ProxyConfig `socks` → `socks5`** 升级,符合 Q13(`7b6e018`)
- ✅ **数据库 17 表**:`0000_awesome_tarot.sql` 至 `0005_code_version_clone.sql` 共 6 个迁移文件(5 个 schema 迁移 + 1 个 _journal.json)

### Phase 3 #I —— 子仓库 skill 真产出(2026-06-29)

| 阶段 | 落地 | 文件 |
|---|---|---|
| 子仓库 SKILL.md 改 frontmatter | `tools: [read_file, write_file]` + `outputs: [...]` 段 | `dotnet-security-audit-skill/skills/{dotnet-route-mapper,dotnet-aspnet-core-audit,dotnet-vuln-scanner,dotnet-exploit-chain-audit}/SKILL.md`(独立 commit `b561820`) |
| 平台 vendor SkillExecutor | 4 个 run 方法(route-mapper / framework-audit / vuln-scanner / exploit-chain)真产 JSON + MD | `apps/api/src/skills/skill-executor.service.ts`(新)+ `apps/api/src/skills/skills.module.ts`(新) |
| ScanRunner 集成 | kickoff 后 → 4 个 skill 跑 → 写 SkillExecution 行 + emitLog | `apps/api/src/scan/scan-runner.service.ts`(改)`step logger "skill 'route-mapper' / start / 完成 / 写 routes_*.json (3 entries)"` |
| Report §3 真读产物 | 新增"3. 阶段产物清单" + §3.1 入口覆盖矩阵 + §3.3 Framework 覆盖矩阵 | `apps/api/src/report/report.service.ts`(改)|
| 测试 | 10 个新单测(纯解析函数 5 + 4 个 run 方法 × fixture 1 + 集成 1) | `apps/api/src/skills/skill-executor.service.spec.ts`(新)|

**关键设计取舍**:

- **vendor vs 真 invoke** —— 选 vendor 跑(OpenAI Agents SDK 的 multi-agent + invokeSkill Tool 在 MVP 阶段不稳,先把 4 个关键 skill 的"读 + 写 + 输出"用 vendor 落地;Phase 3 K 任务做 agent_traces 真 invoke 联动)
- **route-mapper 输出 JSON** —— 选 JSON(平台更好 parse,§3.1 入口覆盖矩阵直接吃)
- **agent_traces 表** —— Phase 3 §1.2 已加(parallel agent 完成),本任务只做 trace metadata fallback,不动 schema

**验证**:10/10 skill-executor 测试 + 10/10 report 测试全过,`pnpm -r typecheck` 全绿(shared/api/web),单测 480/481(1 个 agent-traces.service.spec.ts 失败是 parallel agent 的 `orderBy` mock 漏写,跟本任务无关)

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
- **开发约定(用户已确认,2026-06-29):本地推进,不远程推送**。所有 commit 仅留本地 main,不要主动 `git push` 或主动配 git remote;如有跨机器同步需求请走 `git bundle` / patch 文件方式

## 下一步候选(2026-06-29 休息点后)

### Phase 2 已完成(本会话 23 commit 内)

| 候选 | 价值 | 状态 |
|------|------|------|
| ProjectDetailPage 把 "Vuln Library" tab 从"Phase X"变真 tab | 完成 §5.5 UI 闭环 | ✅ `bde81f9` |
| §5.3 API 覆盖统计(让 §1 checklist 入口覆盖打勾) | 让报告 §1 完整 | ✅ `1bc9df4` |
| §4.2.8 Members UI(把 Members tab 从"Phase X"变真) | 多人协作基础 | ✅ `bde81f9` |
| §5.7 git 凭证 + 代理 UI | 完善系统配置 | ✅ `6b8cb83` |
| 真正跑多个 scan + 报告对比(两个 ScanRun 差异) | Phase 2 §5.4 完整 | ✅ `99c07d4`(端到端实测过) |
| BullMQ 真正并发扫描(Q6) | 性能 / 崩溃可恢复 | ✅ `e3bbe96` + `583ff18`(in-memory → BullMQ + Redis) |
| Versions tab 清理 | 详情页 UI 闭环 | ✅ `982730e` |
| 首次登录改密码(§6.2) | §6.2 硬要求 | ✅ `7e3ac05` |
| 报告 Markdown 渲染(react-markdown) | 报告可读性 | ✅ `dcac49a` |
| CI/CD pipeline(GitHub Actions) | PR 自动检查 | ✅ `01ed2d5` |
| 需求文档前后一致 / socks5 升级 | 仓库自洽 | ✅ `7b6e018` |
| 业务模块测试深度 | 仓库质量 | ✅ `1661192`(+54 测试) |
| **真 JWT 解码 + AdminGuard** | 替代 x-user-id mock | ✅ `2f83a11`(JwtStrategy + JwtAuthGuard + RolesGuard + @Roles,'admin' 拦截 AI Key / Git Credentials / Proxy / Users 写端点) |
| **Bull-Board 接入(队列可视化)** | 队列可观测 | ✅ `f2dda10`(`/admin/queue`,JWT admin OR Basic admin/admin 双通道) |
| **Vitest coverage provider 上线** | 覆盖率可见 | ✅ `fdb75f3` + `36aee78`(shared/web 100% 阈值启用,api 57% 阈值注释保留) |
| **多 Skill Bundle 并存(§11 Q7 双轨 C)** | Skill 升级红利 | ✅ `0487fb8` + `a9f6951`(is_default / published_at 字段 + setDefault 事务原子 + replay-with-latest 端点 + 33 个新单测) |
| **§5.7 真接 git clone** | §5.7 真闭环 | ✅ `2fadec8`(GitCloneService + from-git API + 8 类错误分类 + 27 个新单测) |
| **§11 Q11 Phase 4 Docker 化部署** | 1-2 天 | 部署简化 | ✅ 多 stage build + 3 服务 compose + entrypoint 自动迁移 + seed(`apps/api/Dockerfile` / `apps/web/Dockerfile` / `docker-compose.yml` / `apps/api/docker-entrypoint.sh` / `docs/DOCKER.md`);api NestJS 启动因 pre-existing `import type` DI bug 失败,见 DOCKER.md 末尾,留给主 session 修 |

### Phase 2/3 待办(新候选)

| 候选 | 工作量 | 价值 | 状态 |
|------|--------|------|------|
| api 测试覆盖率 57% → 70%(启用阈值) | 半天 | 质量门禁 | 待办(`36aee78` 阈值注释保留) |
| ~~§5.7 from-github 占位 → 真支持~~ ✅ | — | — | 已落地(`GitHubService` + 28 个新单测,凭证优先级 env > git_credentials) |
| Docker 化部署(§11 Q11 评估) | 1-2 天 | 部署简化 | 待评估(§11 Q11 锁定 "无 Docker",打破需决策) |
| **§11 Q11 Phase 4 Docker 化部署** | 1-2 天 | 部署简化 | ✅ `9b495fe`(`apps/api/Dockerfile` 多阶段 build + alpine musl better-sqlite3 编译 + `apps/web/Dockerfile` nginx serve + `docker-compose.yml` 3 服务 + `docker-entrypoint.sh` 自动迁移/seed + `docs/DOCKER.md` 使用指南);**api NestJS 启动期 pre-existing `import type` DI bug 已修(`7bf49eb` + `4dd7523`),Docker 化实际可用** |
| **Phase 2 e2e**(api 端 supertest + web 端 RTL) | 2-3 天 | api 覆盖率破 70% | 待办(已有 80.18%,Phase 2 e2e 可推到 95%+) |
| **Phase 3 漏洞趋势图**(VulnLibrary 按时间聚合) | 1-2 天 | 安全可视化 | 待办 |
| refresh-token + 旋转/吊销 + HttpOnly Cookie(替换 localStorage) | 1 天 | §6.2 真闭环 | 待办 |
| Skill 升级自动跑一遍重扫(CI hook) | 2-3 小时 | §11 Q7 自动兑现 | 待办 |
| Phase 5 repo-wide `import type Service` 扫描 | 30 分钟 | 一劳永逸 | ✅ `7bf49eb` + `4dd7523`(roles.guard / projects.controller + scan-queue / scan-processor)|
| pnpm-workspace.yaml `onlyBuiltDependencies` | 5 分钟 | CI 友好 | ✅ `fa71693`(修 better-sqlite3 等 native deps install 失败) |
| 真 git clone e2e(用真公开 repo + 真凭证) | 2 小时 | 兑现 §5.7 真闭环 | 待办(目前 `from-git` / `from-github` 已真实现,只缺实测) |
| 仓库 push origin main | 2 分钟 | 远程备份 | 待办(`git push` 需用户在 CLAUDE.md 给 git remote URL) |

## 已知遗留(不阻塞)

### 已修(本会话 23 commit 内)

- ~~子仓库脏工作树~~:`973167f` 已清
- ~~ProjectDetailPage Versions tab 显示 "Phase 2"~~:`982730e` 已删
- ~~2 个 pre-existing lint 警告~~(`settings.service.ts` + `users.service.ts` 的 `node:crypto` import/order):`982730e` 已修
- ~~`.gitignore` 加 `*.tsbuildinfo` + 取消 tracking `tsconfig.tsbuildinfo`~~:`20edc44` 已做
- ~~§5.7 git 凭证只 UI CRUD,未实际接 git clone~~:`2fadec8` 已真接
- ~~socks enum 写 `socks`~~:`7b6e018` 升 `socks5` 符合 Q13
- ~~x-user-id mock 鉴权~~:`2f83a11` 替换成 JWT payload
- ~~当前 Bull-Board 未接入~~:`f2dda10` `/admin/queue` 上线
- ~~当前测试覆盖率无 provider~~:`fdb75f3` + `36aee78` v8 provider 上线 + 阈值上抬
- ~~api 覆盖率 57% 阈值未启用~~:`d1901b8` 提升到 80.18% 后 thresholds 强制门禁启用且通过
- ~~better-sqlite3 native binding 缺失(导致 API 启动报 'Could not locate bindings file')~~:`fa71693`(`pnpm-workspace.yaml` 加 `onlyBuiltDependencies`)允许 install 期 build;Windows 中文路径下 node-gyp mojibake 仍编译失败,所以手动下载 Node 24 ABI v137 prebuilt → `node_modules/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3/build/Release/better_sqlite3.node`(1.9MB,untracked / 不进 commit,Phase 5 写 `scripts/install-native-deps.sh`)
- ~~3 个 NestJS DI 'Function not found' bug(API 启动报 'argument Function')~~:`7bf49eb` 修了 `roles.guard.ts`(`import type Reflector` → runtime)+ `projects.controller.ts`(`import type ProjectsService` → runtime)+ `auth.module.ts`(清残留 unused imports)
- ~~scan-queue / scan-processor 同样 `import type` bug(没 DI 注册但 BullMQ 内部 metadata 需要)~~:`4dd7523`(Phase 5 repo-wide 扫的第二批)`fac71693`(pnpm workspace)→`4dd7523` 已是 final commit

### 未修(新 / 遗留)

- **api 覆盖率 57% 未达 70%**:`36aee78` 阈值注释保留 —— 需 Phase 2 接 supertest 跑 e2e 才能破;目前 service 层覆盖 ~70%,controller / guard / middleware / gateway 层未充分测
- **Docker 化待评估(§11 Q11 锁定 "无 Docker",打破需决策)**:BullMQ + Redis 部分打破"无 Docker"前提(本机需 docker run redis);Phase 4 是否回退 `better-queue` 待定
- **refresh-token 黑名单未实现(JWT 不可吊销)**:`2f83a11` 真 JWT 解码上线后,access token 15min 过期,无 refresh + 旋转 + 黑名单;MVP 阶段接受(等 Phase 2)
- **web `pages/` + `components/` 未充分测**:仅 `hooks/` + `lib/` 100% 覆盖;`pages/`(12 页面) + `components/` 仅 `App.spec.tsx` 1 测试;Phase 2 接 React Testing Library
- **`apps/api/storage/scan-runs/<id>/` 落盘目录结构当前没真 skill 产物**(`route_mapping/` / `framework_audit/` 来自 fixture 测试;真 scan 跑完只有 `quality/scan_summary.json`);Phase 2 skill 真产出后自动补齐
- **§6.2 鉴权 MVP 阶段只发了 15min access token**;**refresh token + 旋转/吊销 + HttpOnly Cookie** 仍留 Phase 2;前端用 `localStorage` 存 accessToken,没接 refresh
- **所有受保护端点**(除 `/api/health` / `/api/auth/login`)都要带 `Authorization: Bearer <jwt>`;Phase 2 接 HttpOnly Cookie 替换 localStorage
- **`JwtAuthGuard` + `RolesGuard` 强制要求模块在 `imports` 里带 `AuthModule`**(`AuthModule` exports `PassportModule`);后续要扩到多 controller 时记得加这条 import
- ~~§1.2/2.7 Agent Trace 检索未实装~~:✅ Phase 3 #K 已落地 — `agent_traces` 表 + 持久化 + `/api/scan-runs/:id/trace` 端点 + `/projects/:id/scans/:runId/trace` 页面 + summary
