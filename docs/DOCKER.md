# Docker 化部署指南(§11 Q11 Phase 4)

> 一键起 `.NET 代码安全审计平台` + Redis(BullMQ 后端)+ nginx(静态前端)+ 反代。
>
> **状态(2026-06-29)**:Docker 化基础设施 100% 落地;`docker compose up -d --build`
> 端到端能拉镜像 + 启动 3 容器;web/redis 健康;api 容器能跑迁移 + seed
> (6 个 SQL 迁移 + admin 用户自动创建),但 NestJS 启动阶段因
> `GitCloneService` 用 `import type` 注入 GitHubService 导致 `Function`
> 注入 token 解析失败 —— 这是源码里的一个 pre-existing bug(`pnpm start`
> 跑 dist 也会失败),**不在本次 Docker 化任务范围内**,留给主 session 修。
> 修法:`apps/api/src/git-clone/git-clone.service.ts:38` 把
> `import type { GitHubService }` 改成 `import { GitHubService }`。
>
> 验证可分两步走:
> 1. 基础设施:`docker compose up -d` → 3 容器都 Up
> 2. 业务验证:迁移 + seed 日志出现;web 端可访问;api 启动失败时看
>    `docker compose logs api`(可见 `Function` 注入错误)

---

## TL;DR

```bash
# 1) 配置密钥(可选,默认值仅 dev 用)
cp .env.example .env
# 编辑 .env:JWT_SECRET / APP_MASTER_KEY / SESSION_SECRET(生产必改)

# 2) 一键起
docker compose up -d --build

# 3) 等 ~30s(首次构建拉镜像 + pnpm install + tsc build)
docker compose ps

# 4) 验证
curl http://127.0.0.1:3030/api/health
# 期望:{"status":"ok","uptimeSec":N,"coverageModeDefault":"api_entry","nodeVersion":"v20.x","dbTables":16,...}

curl -I http://127.0.0.1:8090/
# 期望:HTTP/1.1 200,Content-Type: text/html

# 5) 打开浏览器
start http://127.0.0.1:8090/
# 默认 admin / admin123(第一次登录 §6.2 提示改密码)
```

> 端口说明:web 用 `127.0.0.1:8090` 而非 `8080`,避免与本机 lab-dvwa
> 容器冲突(§6.5 部署锁定只内网,且端口约定为不冲突)。如果需要换端口,
> 改 `docker-compose.yml` 里 `web.ports` + `api.environment.CORS_ORIGINS` 同步。

---

## 架构

| 服务 | 镜像 | 主机端口 | 容器内端口 | 角色 |
|------|------|----------|------------|------|
| api | `apps/api/Dockerfile` (multi-stage) | 127.0.0.1:3030 | 3030 | NestJS 业务后端 |
| web | `apps/web/Dockerfile` (multi-stage) | 127.0.0.1:8090 | 80 | nginx 反代 + React 静态 |
| redis | `redis:7-alpine` | (无主机映射) | 6379 | BullMQ 后端 |

```text
浏览器 → http://127.0.0.1:8090 (nginx,容器 web)
              ├─ /api/*  ──→ http://api:3030 (容器内 DNS,直接走内网)
              ├─ /socket.io/* ──→ http://api:3030 (ws upgrade)
              └─ /* (静态 + SPA fallback → /index.html)

docker compose:
  ┌─ web (nginx) ─┐      ┌─ api (NestJS) ─┐      ┌─ redis ─┐
  │  80 → 127.0.0.1│  ───→│  3030 → 127.0.0.1│      │ 6379   │
  │  反代 /api /ws │      │  SQLite on volume│      │ 无主机 │
  └────────────────┘      │  BullMQ workers  │ ←─── │        │
                          └──────────────────┘      └────────┘
                              audit-net (bridge)
```

---

## 数据持久化

| Volume | 容器内路径 | 用途 |
|--------|-----------|------|
| `dotnet-audit-platform_api_storage` | `/app/apps/api/storage/` | SQLite 库 + ScanRun 产物 + 上传 zip + 报告 |
| `dotnet-audit-platform_redis_data` | `/data` | Redis RDB(AOF 默认关) |
| `./dotnet-security-audit-skill` | bind mount `/app/dotnet-security-audit-skill` (ro) | 嵌入的 skill bundle 子仓库 |

查看 volume:

```bash
docker volume inspect dotnet-audit-platform_api_storage
```

清空数据(慎用):

```bash
docker compose down -v
```

---

## 环境变量

`docker compose up` 前在仓库根放 `.env` 文件即可覆盖默认值:

```env
# 必改(否则 dev fallback)
JWT_SECRET=please-change-me-32-chars-min-len
APP_MASTER_KEY=please-change-me-32-chars-min-len
SESSION_SECRET=please-change-me-32-chars-min-len

# 可选
SCAN_MAX_CONCURRENT=2
BULL_BOARD_BASIC_USER=admin
BULL_BOARD_BASIC_PASSWORD=admin
```

其它用 compose 里的默认值即可;`OPENAI_API_KEY` 留空(在 `/admin/config` UI 里配置)。

---

## 镜像构建细节

### API 多阶段

```text
base    : node:20-alpine + pnpm@10.33.3 + python3/make/g++ (编译 better-sqlite3)
deps    : pnpm install --frozen-lockfile(全量,含 devDeps 供 build 用)
build   : pnpm --filter @platform/shared build
        + pnpm --filter @platform/api build (nest build → apps/api/dist)
runner  : node:20-alpine + pnpm + prod-only deps + apps/api/dist
        + apps/api/src/db/migrations(供 entrypoint 应用)
        + docker-entrypoint.sh(自动跑迁移 + seed)
```

### Web 多阶段

```text
base    : node:20-alpine + pnpm
deps    : pnpm install --frozen-lockfile
build   : pnpm --filter @platform/shared build
        + pnpm --filter @platform/web build (vite build → apps/web/dist)
runner  : nginx:1.27-alpine + apps/web/dist + apps/web/nginx.conf
```

### .dockerignore 关键排除

- `node_modules` / `**/dist` / `**/coverage` / `**/*.tsbuildinfo`(容器内现装现编)
- `storage` / `**/*.sqlite` / `logs`(运行时产物,进 volume)
- `dotnet-security-audit-skill/`(compose bind-mount,镜像里不固化)
- `.git` / `.claude` / `.github` / `.vscode`

---

## 启动时序

`docker compose up` 内部时序:

1. `redis` 容器先起,`redis-cli ping` 通了才放行
2. `api` 容器 build → 启动 → `docker-entrypoint.sh` 跑:
   - `mkdir -p ./storage/{code-versions,scan-runs,reports}`
   - 读 `dist/db/migrations/*.sql`,按字典序逐个 `db.exec()`,通过 `__migrations` 表记录已应用
   - 跑 `node dist/db/seed.js`(若 admin 已存在则幂等跳过)
   - `exec node dist/main.js` 把 PID 1 交给 nest
3. `web` 容器 build → nginx 启动,转发 `/api` `/socket.io` 到 `api:3030`

---

## 常见操作

```bash
# 看日志
docker compose logs -f api
docker compose logs -f web
docker compose logs -f redis

# 重启单个服务
docker compose restart api

# 进 api 容器调试
docker compose exec api sh
ls /app/apps/api/storage/         # 看到 dev.sqlite + scan-runs/ + reports/
sqlite3 /app/apps/api/storage/dev.sqlite ".tables"

# 重建某个服务
docker compose build api --no-cache
docker compose up -d api

# 完全清场
docker compose down -v            # 停 + 删容器 + 删 volumes
```

---

## 健康检查

| 端点 | 用途 | 期望 |
|------|------|------|
| `http://127.0.0.1:3030/api/health` | API 存活 + DB 表数 + BullMQ 队列深度 | `{status:"ok", dbTables:16, queueDepth:0, ...}` |
| `http://127.0.0.1:8090/healthz` | nginx 自检 | `200 ok` |

docker compose healthcheck 默认 30s 间隔、3 次失败重启;首次启动 `start_period: 30s`(等 tsc 编译完)。

---

## 与本地直跑(start.bat)的关系

`docker compose` 是推荐部署方式;`start.bat` 仍可作为开发 / 调试 fallback:

- 本地直跑:需要本机 Node 20 + pnpm + 本机 Redis(否则 BullMQ 启动会失败)
- Docker 跑:Redis 也容器化,完全自包含,本机只需 Docker

§11 Q11 原锁定"无 Docker,本地部署"已被本次 Phase 4 打破;两条路都支持,Q11 决策记录见 `需求文档.md` §11。

---

## 已知边界(Phase 4 落地,留 Phase 5 升级)

- `OPENAI_API_KEY` 不在 compose 里硬编,进容器后在 `/admin/config` UI 配置(§5.7 落地)
- sub-repo 绑定走 bind-mount(开发期可改子仓库后容器内 `git pull` 重新跑 scan)
- `better-sqlite3` / `argon2` 在 alpine musl 上无官方 prebuilt,Dockerfile 走 `--ignore-scripts` + 手动 `node-gyp rebuild --release` 从源码编(慢但稳);Phase 5 可换 `node:20-bookworm-slim`(glibc,有 prebuilt,镜像 +200MB 但 build 块 2-3 倍)
- 暂未接 HTTPS(§6.5 部署锁定只内网,本机 localhost 不需要);Phase 5 可加 `nginx-proxy + acme-companion` 或前置 Caddy
- 单机部署,K8s / Swarm 暂不接
- **`@platform/shared` 镜像内 override**:源码 `package.json` 的 `main: ./src/index.ts` + `type: module` 在 dev(ts-node) 跑 OK,但 prod 跑 dist 失败。Dockerfile 在 runner 阶段:
  1. 用 override tsconfig 重新 build shared 为 CJS(`module: commonjs, moduleResolution: node`)
  2. 写一个 mirror `package.json` 把 `main` / `exports` / `type` 改到 `dist/index.js` + `type: commonjs`
  3. 不动源码 `packages/shared/package.json`(原 `pnpm dev` 行为不变)
- **api 启动 DI 报错**(pre-existing,不是 Docker 引入):`apps/api/src/git-clone/git-clone.service.ts:38` 用 `import type { GitHubService }` 注入 GitHubService,TypeScript metadata emission 把 class type 当 `Function`,NestJS 找 `Function` provider 失败。`pnpm start` 跑 dist 同样失败(本地复现过)。**修法 1 行**:把 `import type` 改成 `import`(去掉 `type`)。不在本次任务范围,留主 session 修。
