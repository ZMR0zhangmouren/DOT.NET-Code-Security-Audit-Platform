# =============================================================
#  @platform/web  ——  React + Vite → nginx:1.27-alpine
#  Multi-stage build. Final image is just static dist + nginx.
# =============================================================

# ---------- 1) base ----------
FROM node:20-alpine AS base
WORKDIR /app

ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

# ---------- 2) deps ----------
FROM base AS deps
WORKDIR /app

# 拷 workspace 描述,装依赖
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc* ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN --mount=type=cache,id=pnpm-web,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --ignore-scripts

# 拷源码
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# ---------- 3) build ----------
FROM deps AS build
WORKDIR /app

# shared 先 build(被 web 引用)
RUN pnpm --filter @platform/shared build
# web build(tsc --noEmit && vite build)
RUN pnpm --filter @platform/web build

# ---------- 4) runner ----------
FROM nginx:1.27-alpine AS runner

# nginx 基础镜像自带 curl;不另装
# 拷 vite 产物
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# 拷 nginx 配置
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# 暴露 80
EXPOSE 80

# 健康检查 —— web 静态页 / 也可作为 health probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1

# nginx -g 'daemon off;' 是官方默认 CMD,继承即可
CMD ["nginx", "-g", "daemon off;"]
