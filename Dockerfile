# ── Stage 1: 构建 ──────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache bash ffmpeg
RUN npm install -g pnpm@9

WORKDIR /app

# Next.js 把 NEXT_PUBLIC_* 变量在构建时固化进产物，必须 build 时通过
# --build-arg NEXT_PUBLIC_APP_URL=... 传入，否则产物里是空，运行时读不到
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# 先安装依赖（利用 layer 缓存）
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# 复制源码并构建
COPY . .
RUN pnpm run build

# ── Stage 2: 生产运行 ──────────────────────────────────────
FROM node:20-alpine AS production

RUN apk add --no-cache bash ffmpeg

WORKDIR /app

ENV NODE_ENV=production
ENV COZE_PROJECT_ENV=PROD

# 复制构建产物和运行时所需文件
COPY --from=builder /app/.next           ./.next
COPY --from=builder /app/dist            ./dist
COPY --from=builder /app/public          ./public
COPY --from=builder /app/src             ./src
COPY --from=builder /app/scripts         ./scripts
COPY --from=builder /app/node_modules    ./node_modules
COPY --from=builder /app/package.json    ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/tsconfig.json   ./tsconfig.json

EXPOSE 5000

# 使用兼容启动脚本（注入 globalThis.AsyncLocalStorage，兼容 Next 16 + 高版本 Node）
CMD ["node", "scripts/start-node24.cjs"]
