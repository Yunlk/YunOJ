ARG REGISTRY_PREFIX=docker.1ms.run/

FROM ${REGISTRY_PREFIX}node:24-alpine AS builder
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM ${REGISTRY_PREFIX}node:24-alpine
WORKDIR /app
COPY --chown=node:node frontend/server.mjs ./server.mjs
COPY --chown=node:node --from=builder /src/dist ./dist
ENV PORT=8080 \
    API_UPSTREAM=http://backend:8080
EXPOSE 8080
USER node
ENTRYPOINT ["node", "server.mjs"]
