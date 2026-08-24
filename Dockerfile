# syntax=docker/dockerfile:1

# ---------- 构建阶段：装全量依赖（含 devDependencies），编译 client + server ----------
# node:26-alpine：node:sqlite 是内置模块，musl 无影响。
FROM node:26-alpine AS build
WORKDIR /app

# 先拷 manifest 再 npm ci，利用 docker 层缓存（依赖不变则跳过安装）
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

# 再拷源码并构建
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build -w @sanguosha/client && npm run build -w @sanguosha/server

# ---------- 运行阶段：只带生产依赖 + 构建产物 ----------
# server 编译产物 packages/server/dist 内含 engine 的编译结果（dist/engine），
# 即 engine 是内联进 dist 的相对引用，无需源码或 workspace 链接；
# 外部运行时依赖只有 socket.io（npm ci --omit=dev 安装）。
FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/sgs.db \
    CLIENT_DIST=/app/client/dist
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/dist ./client/dist

# SQLite 数据目录（卷挂载点），以非 root 用户运行
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "packages/server/dist/server/src/index.js"]
