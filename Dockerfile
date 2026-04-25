# 使用 Node.js 20 作为基础镜像
FROM node:20-alpine AS base

# 安装 bash（Alpine 默认没有 bash）
RUN apk add --no-cache bash

# 安装 pnpm
RUN npm install -g pnpm@9

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建应用
RUN pnpm run build

# 生产环境镜像
FROM node:20-alpine AS production

# 安装 pnpm
RUN npm install -g pnpm@9

# 设置工作目录
WORKDIR /app

# 设置环境变量
ENV NODE_ENV=production

# 复制 package.json 和 pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# 只安装生产依赖
RUN pnpm install --frozen-lockfile --prod

# 从构建阶段复制 .next 目录
COPY --from=base /app/.next ./.next
COPY --from=base /app/public ./public
COPY --from=base /app/src ./src

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["pnpm", "start"]
