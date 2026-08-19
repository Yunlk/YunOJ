# 基础镜像前缀（国内默认走 docker.1ms.run 加速；海外/服务器可用
# `docker compose build --build-arg REGISTRY_PREFIX=` 关闭）
ARG REGISTRY_PREFIX=docker.1ms.run/

# ============ 阶段 1：构建前端 ============
FROM ${REGISTRY_PREFIX}node:24-alpine AS frontend
WORKDIR /fe
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ============ 阶段 2：构建后端（嵌入前端产物） ============
FROM ${REGISTRY_PREFIX}golang:1.25-alpine AS backend
WORKDIR /src
# 国内网络走 goproxy.cn 镜像；海外环境可删除此行
ENV GOPROXY=https://goproxy.cn,direct
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
COPY --from=frontend /fe/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ============ 阶段 3：运行镜像（单二进制 + 前端静态资源） ============
FROM ${REGISTRY_PREFIX}alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 1000 yunoj
WORKDIR /app
COPY --from=backend /out/server ./server
ENV DATA_DIR=/data
EXPOSE 8080
USER yunoj
ENTRYPOINT ["./server"]
