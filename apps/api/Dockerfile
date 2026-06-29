# =============================================================
#  @platform/api  ——  NestJS + Drizzle + better-sqlite3 + argon2 + BullMQ
#  Multi-stage build for small final image.
#
#  Base: node:20-alpine(musl).better-sqlite3 + argon2 在 alpine 上
#  没有官方 prebuilt,需要从源码编译(node-gyp)。
#  策略:deps 阶段装全量依赖并强制从源码编 native 模块,
#  runner 阶段只拷编译好的产物(node_modules .pnpm 仓库 + dist),
#  不重装,避免 pnpm store 缓存命中 glibc prebuild。
# =============================================================

# ---------- 1) base ----------
FROM node:20-alpine AS base
WORKDIR /app

# alpine musl 需要 python3 + make / g++ 编译 native modules
# 还需要 libc6-compat 给某些 glibc 预编译的 .node 提供兼容
RUN apk add --no-cache python3 make g++ libc6-compat wget

# 启用 pnpm
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

# ---------- 2) deps (全量装 + 强制从源码编 native) ----------
FROM base AS deps
WORKDIR /app

# 拷贝 workspace 描述(只这些文件,改源码不重装)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc* ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

# 装全量依赖 + 强制从源码编 alpine musl 版 native 模块
# 关键洞察:`--ignore-scripts` 跳过 prebuild-install,避免它下载 glibc prebuild;
# 然后逐个进 better-sqlite3 / argon2 目录手动跑 node-gyp rebuild --release
# 编出 alpine musl 版的 .node(node-gyp 是 npm 自带的 cli,直接用 npx 调)
# 用 cache mount 加速后续重复构建
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=pip,target=/root/.cache/pip \
    apk add --no-cache linux-headers && \
    pnpm config set store-dir /pnpm/store && \
    CI=true pnpm install --frozen-lockfile --ignore-scripts && \
    # 手动跑每个 native 包的 node-gyp rebuild(alpine musl 版)
    for pkg in 'better-sqlite3@12.11.1' 'argon2@0.44.0'; do \
      dir="/app/node_modules/.pnpm/${pkg}/node_modules/${pkg%@*}"; \
      echo "=== building $pkg at $dir ==="; \
      (cd "$dir" && npx --yes node-gyp rebuild --release 2>&1 | tail -10) || true; \
    done && \
    echo "=== verify ===" && \
    ls -la /app/node_modules/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3/build/Release/ 2>&1 | head -5

# 此时再 copy 源码(源码变不重装 deps,只重 build)
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# 先 build shared(出 dist/),这样 nest build 和后面 COPY --from=deps 都有 JS 可用
# 关键:shared 默认是 ESM(`export const`),但 api 是 CJS(`require()`)。
# 在 deps 阶段覆盖 shared 的 tsconfig,让它编出 CJS,然后再 restore package.json。
# 简化:直接给 shared 喂一个 cjs tsconfig override
RUN cp /app/packages/shared/tsconfig.json /tmp/shared-tsconfig.bak && \
    node -e "\
      const fs = require('fs'); \
      const c = JSON.parse(fs.readFileSync('/app/packages/shared/tsconfig.json','utf8')); \
      c.compilerOptions = c.compilerOptions || {}; \
      c.compilerOptions.module = 'commonjs'; \
      c.compilerOptions.moduleResolution = 'node'; \
      fs.writeFileSync('/app/packages/shared/tsconfig.json', JSON.stringify(c, null, 2)); \
    " && \
    CI=true pnpm --filter @platform/shared build && \
    cp /tmp/shared-tsconfig.bak /app/packages/shared/tsconfig.json

# ---------- 3) build ----------
FROM deps AS build
WORKDIR /app

# shared 先 build(api/web 都引用)
RUN pnpm --filter @platform/shared build

# api 编译(nest build → apps/api/dist)
RUN pnpm --filter @platform/api build

# 把迁移 SQL 拷到 dist 旁(entrypoint 需要读)
RUN mkdir -p ./apps/api/dist/db/migrations && \
    cp -r ./apps/api/src/db/migrations/. ./apps/api/dist/db/migrations/

# ---------- 4) runner ----------
# 用 node:20-alpine,只装运行时必要的东西;node_modules 直接从 deps 拷,
# 里头已经编好 alpine musl 版的 .node(不再重装,避免 pnpm store 命中 glibc prebuild)
FROM node:20-alpine AS runner
WORKDIR /app

# 运行时仍需要 libc6-compat(wget + 给 .node 一些兼容)+ tzdata
RUN apk add --no-cache libc6-compat wget tzdata

ENV NODE_ENV=production
ENV PORT=3030
ENV HOST=127.0.0.1
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

# 拷 deps 阶段装好的 node_modules(里头 .pnpm/<pkg>/node_modules/<pkg>/build/
# 已经有 alpine musl 版的 better_sqlite3.node / argon2.node)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# 关键:workspace 包(shared)的产物 + 元信息要拷
# shared 是 TS 源,被 nest build 编译进 apps/api/dist 的 require() 引用
# symlink 在 apps/api/node_modules/@platform/shared → packages/shared/,
# 镜像里 packages/shared/ 必须有可加载的 JS + package.json 指向它
# 修复:把 shared 的 dist 拷到 packages/shared/ 下,并把 main 字段重写到 dist/index.js
# (不动源码 package.json,只在镜像里 override)
COPY --from=deps /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=deps /app/packages/shared/dist ./packages/shared/dist
# 改 main 字段到 dist/index.js(让 node 找 JS 而不是 TS)
# 关键:Node 20 用 `exports` 字段(若存在),会 override `main` —— 一起改
# 同时改 type 从 module → commonjs(shared 现在是 CJS 编译产物)
RUN node -e "\
  const fs = require('fs'); \
  const orig = JSON.parse(fs.readFileSync('/app/packages/shared/package.json', 'utf8')); \
  const mirror = { ...orig, type: 'commonjs', main: './dist/index.js', types: './dist/index.d.ts', \
    exports: { '.': './dist/index.js' } }; \
  fs.writeFileSync('/app/packages/shared/package.json', JSON.stringify(mirror, null, 2)); \
"

# pnpm 元信息也拷(它记着 store 路径;没有 store 的话 skip)
COPY --from=deps /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=deps /app/package.json /app/package.json

# 拷编译产物(dist 包含 main.js + 所有 module.js)
COPY --from=build /app/apps/api/dist ./apps/api/dist
# 关键:dist 里是 CommonJS 产物(`Object.defineProperty(exports, ...)`),
# 但根 package.json 有 "type": "module",node 会把 .js 当 ESM 解析 → ReferenceError。
# 塞一个 package.json 显式声明 commonjs,override 根的 module 设置。
RUN echo '{"type":"commonjs"}' > /app/apps/api/dist/package.json

# entrypoint 脚本:启动前 ensure storage 目录 + apply migrations + seed
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 暴露端口
EXPOSE 3030

# 健康检查 —— nest 已实现 GET /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3030/api/health || exit 1

WORKDIR /app/apps/api
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
