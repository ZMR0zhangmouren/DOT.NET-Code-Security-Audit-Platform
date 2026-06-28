# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库当前状态(2026-06-28)

§5.1–§5.7 全章节 + §11 Q6(BullMQ + Redis)+ §11 Q13(代理 / git 凭证)+ §5.4 多 ScanRun 对比 + §5.3 API 覆盖端到端 + §6.2 首次登录改密码 + §5.4 报告 Markdown 渲染 + CI/CD pipeline 全部落地;仓库 133 测试通过 / 0 错 0 警 / typecheck 全绿。端到端可跑通:

- 上传 zip → 触发 BullMQ scan → 115 秒 → 漏洞入库 + 自动聚合到 VulnLibraryEntry
- 多 ScanRun 对比(端到端实测,DB 真写 + redis 真跑 + diff 端点返回完整 ScanDiff)
- API 覆盖统计(recompute-coverage 端点 + DB 真写 PARTIAL/COMPLETE)
- Members grant/revoke/role change(只 owner / lead 能改)
- git 凭证 + 代理(系统配置页 + 后端 CRUD)
- 改密码(§6.2 落地)
- CI pipeline(`.github/workflows/ci.yml`,8 step,PR 自动跑 typecheck/test/lint)

根目录含:

- `./需求文档.md` —— 1,418 行的产品/技术规格,锁定了 Q1–Q17 共 17 项决策
- `./dotnet-security-audit-skill/` —— **独立 git 仓库**(独立 .git/、独立 main 分支),内含 38 个 .NET 审计 skill + 主 agent.md + 9 份 shared 规范;平台不修改它
- `./apps/api/` —— **NestJS 后端**(modules: admin/queue-board / agents / auth / code-versions / db / health / projects / realtime / report / scan / settings / skill-bundles / storage / users / vulns,共 15 个)
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

§6.2 首次登录后改密码已落地(`7e3ac05`):POST `/api/auth/change-password` + `/me` 页面 + 密码强度校验(≥8 字符 + 1 数字 + 1 字母)。POST `/api/auth/login` → 返回 JWT(15min,payload 含 `sub` + `role`)→ 前端存 localStorage;真 JWT 解码 + RolesGuard 进行中(`aa6d617c0fc76852f`)。

## 已落地功能(2026-06-28)

- ✅ `pnpm install`(836+ 包,本会话 +5 runtime: react-markdown / remark-gfm / rehype-highlight / highlight.js / @tailwindcss/typography;+3 api: @nestjs/bullmq / bullmq / ioredis)
- ✅ `pnpm -r typecheck`(shared / api / web 全绿)
- ✅ `pnpm -r test`(178 测试通过:shared 6 + api 177 + web 1,从 9 → 178,+169 测试)
- ✅ `pnpm lint`(ESLint **0 错 0 警** + Prettier 干净)
- ✅ **§5.3 Scan 主流程**:从 zip 上传 → BullMQ + Redis 入队 → Agent 调 MiniMax 跑 115 秒 → 4 漏洞入库 + 自动聚合到 VulnLibraryEntry(`583ff18` 升级)
- ✅ **§5.3 API 覆盖统计 + recompute-coverage 端点**:report §1 checklist 的 API 入口覆盖可勾选汇总 + POST `/api/scan-runs/:id/recompute-coverage`(`1bc9df4` + `603b443`)
- ✅ **§5.4 报告导出**:Markdown / JSON / zip 归档包三端点工作
- ✅ **§5.4 多 ScanRun 报告对比**:GET `/api/projects/:id/scans/diff?a=&b=` 返回完整 ScanDiff(onlyInA / onlyInB / inBoth / newInB / fixedInB / worsened / coverage delta)(`99c07d4`,端到端实测过)
- ✅ **§5.4 报告 Markdown 渲染**:react-markdown + remark-gfm + rehype-highlight + 章节导航(slugify + IntersectionObserver 高亮)(`dcac49a`)
- ✅ **§5.5 漏洞库 UI**:列表 + 详情 + 状态流转(open / fixing / fixed / ignored),ProjectDetailPage 上 Vuln Library tab 已从 "Phase X 待上" 变成真 Link(`bde81f9`)
- ✅ **§4.2.8 Members UI**:ProjectDetailPage 上 Members tab 从 "Phase X 待上" 变成真页面 —— 邀请 / 角色 / 移除,只 owner / lead 能 grant(`bde81f9`)
- ✅ **§5.7 git 凭证 + 代理 UI**:`/admin/config` 页面新增 git 凭证(GitHub PAT / SSH key)与代理配置(支持 socks5,enum 已升级) + `proxyConfigs.protocol` 从 `socks` 升 `socks5` 符合 Q13(`6b8cb83` + `7b6e018`)
- ✅ **§5.7 真接 git clone**:`apps/api/src/git-clone/git-clone.service.ts` 调本机 `git` CLI(`--depth=1` + 5min timeout);HTTPS token 注入 `https://user:token@host/path`,SSH key 写 tmp + `GIT_SSH_COMMAND`;`code_versions` 加 `cloned_at` + `clone_error_message` 字段(`0005_code_version_clone.sql` 迁移);`POST /api/code-versions/from-git` 端点 + `from-github` Phase 2 占位;错误分类 `NO_CREDENTIAL / AUTH_FAILED / AUTH_FORBIDDEN / NETWORK_UNREACHABLE / TIMEOUT / DISK_FULL / GIT_NOT_FOUND` → 落地 `clone_error_message`(commit hash 待主 session 补)
- ✅ **§6.2 首次登录改密码**:POST `/api/auth/change-password` + `/me` 个人中心 + 密码强度校验(`7e3ac05`)
- ✅ **§6.2 真 JWT 解码 + 角色门禁**:`@nestjs/passport` PassportStrategy 验签 → `JwtAuthGuard` 全 controller 拦截 → `RolesGuard` + `@Roles('admin')` 拦截 AI Key / Git Credentials / Proxy / Users 写端点;`req.user` 从 `x-user-id` 头 mock 改成 JWT payload(`sub` / `role`);`@CurrentUser()` decorator 注入
- ✅ **§11 Q6 并发扫描升级到 BullMQ + Redis**:从 in-memory FIFO 升到真 BullMQ + Redis(进程崩溃可恢复 + 分布式 worker),本机 docker run redis:7-alpine 容器跑通(`e3bbe96` in-memory + `583ff18` BullMQ)
- ✅ **§11 Q7 双轨 C — 多 Skill Bundle 并存 + 用最新 Skill 重扫**:schema 加 `is_default` / `published_at` 字段(`0004_skill_bundle_default.sql` 迁移);`SkillBundlesService` 扩 `listAll / listActive / getDefault / setDefault(事务原子) / publish / getById`;新增 `POST /api/scan-runs/:id/replay-with-latest` 端点 + `ScanService.replayWithLatest()`(不绑原 run 的 bundle,改拿 `getDefault()`,无默认 → NotFoundException);前端 Scans 列表加 `Replay (Latest Skill)` 按钮(`data-testid="replay-with-latest"`) + ScanPage 加同名按钮
- ✅ **CI/CD pipeline**:`.github/workflows/ci.yml` 8 step,Node 20 + pnpm cache + `--frozen-lockfile` + upload coverage artifact(`01ed2d5`)
- ✅ **需求文档前后统一**:消除 §1.2 / §2.1 / §4.2.5 / §5.4 / §2.5 等 10 处前后不一致(`7b6e018`)
- ✅ **Versions tab 清理**:ProjectDetailPage 删 "Phase 2 · §5.2" 占位 tab(信息已在 Scans tab 内嵌)(`982730e`)
- ✅ **业务模块测试深度**:5 个 service(spec 端到端,从 60 → 119 + 133 = `1661192` 后 commit)
- ✅ GET `/api/health` 返回 `{status, uptimeSec, coverageModeDefault, nodeVersion, dbTables: 16, queueDepth, queueRunning, queueMaxConcurrent}`(`583ff18` 加 queue 字段)
- ✅ Vitest coverage v8 provider 上线:三包 `vitest.config.ts` 接 `@vitest/coverage-v8`,`pnpm -r test --coverage` 生成 `coverage/{text,json-summary,html}`,CI artifact upload 自动激活(thresholds 暂注释,MVP 首跑 < 70% 不卡门禁)

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
| 真正跑多个 scan + 报告对比(两个 ScanRun 差异) | 2 小时 | Phase 2 §5.4 完整 | ✅ 99c07d4(端到端实测过) |
| BullMQ 真正并发扫描(Q6) | 1-2 天 | 性能 | ✅ 583ff18(in-memory → BullMQ + Redis) |
| Versions tab 清理 | 5 分钟 | 详情页 UI 闭环 | ✅ 982730e |
| 首次登录改密码(§6.2) | 半天 | §6.2 硬要求 | ✅ 7e3ac05 |
| 报告 Markdown 渲染(react-markdown) | 半天 | 报告可读性 | ✅ dcac49a |
| CI/CD pipeline(GitHub Actions) | 半天 | PR 自动检查 | ✅ 01ed2d5 |
| 需求文档前后一致 / socks5 升级 | 1 小时 | 仓库自洽 | ✅ 7b6e018 |
| 业务模块测试深度 | 1 天 | 仓库质量 | ✅ 1661192 |
| **真 JWT 解码 + AdminGuard** | 半天 | 替代 x-user-id mock | ✅ 已完成(JwtStrategy + JwtAuthGuard + RolesGuard + @Roles,'admin' 拦截 AI Key / Git Credentials / Proxy / Users 写端点) |
| **Bull-Board 接入(队列可视化)** | 2-3 小时 | 队列可观测 | 进行中(O agent) |
| **Vitest coverage provider 上线** | 1 小时 | 覆盖率可见 | 进行中(P agent) |
| Docker 化部署(§11 Q11 Phase 4) | 1-2 天 | 部署简化 | 待办 |
| 多 Skill Bundle 并存(§11 Q7 双轨 C) | 1 天 | Skill 升级红利 | ✅ 已落地(is_default / published_at 字段 + setDefault 事务原子 + replay-with-latest 端点 + 33 个新单测) |
| §5.7 真正接 git 凭证(目前只 UI,不实际 clone) | 1 天 | §5.7 真闭环 | 待办 |

## 已知遗留(不阻塞)

- ~~子仓库脏工作树~~:已于 2026-06-28 commit `973167f`(子仓库独立演进)清理完
- ~~ProjectDetailPage Versions tab 显示 "Phase 2"~~:`982730e` 已删(Versions 信息在 Scans tab 内嵌)
- ~~2 个 pre-existing lint 警告~~(`settings.service.ts` + `users.service.ts` 的 `node:crypto` import/order):`982730e` 已修;仓库 lint 真正 0 错 0 警
- ~~`.gitignore` 加 `*.tsbuildinfo` + 取消 tracking `tsconfig.tsbuildinfo`~~:`20edc44` 已做
- ~~§5.7 git 凭证只 UI CRUD,未实际接 git clone~~:已真接,见上"已落地功能"
- `apps/api/storage/scan-runs/<id>/` 落盘目录结构当前没真 skill 产物(`route_mapping/` / `framework_audit/` 来自 fixture 测试;真 scan 跑完只有 `quality/scan_summary.json`);Phase 2 skill 真产出后自动补齐
- BullMQ + Redis 部分打破 §11 Q11 "本地部署 / 无 Docker" 锁定:Redis 是 BullMQ 硬依赖,本机需 docker run redis 或装 Redis 服务;Phase 4 可考虑回退 `better-queue`
- 当前 Bull-Board 未接入(Task O 进行中):队列可视化要等 O 完成
- 当前测试覆盖率无 provider(Task P 进行中):v8 provider 装上后 CI 自动激活 coverage artifact
- §6.2 鉴权 MVP 阶段只发了 15min access token;**refresh token + 旋转/吊销 + HttpOnly Cookie** 仍留 Phase 2。当前 `/auth/login` 返回 JWT 给前端自行处理
- 所有受保护端点(除 `/api/health` / `/api/auth/login`)都要带 `Authorization: Bearer <jwt>`;**前端**目前用 `localStorage` 存 accessToken,没接 refresh;Phase 2 接 HttpOnly Cookie 替换 localStorage
- `JwtAuthGuard` + `RolesGuard` 当前**强制要求模块在 `imports` 里带 `AuthModule`**(`AuthModule` exports `PassportModule`);后续要扩到多 controller 时记得加这条 import
