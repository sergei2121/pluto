# ─── PLUTO Core: multi-stage build из корня репозитория ─────────────────────
# docker compose up -d --build

# Этап 1: сборка веб-консоли (React + Vite)
FROM node:20-alpine AS web
WORKDIR /app
COPY package.json package-lock.json tsconfig.json vite.config.js index.html ./
COPY src ./src
RUN npm ci && npm run build

# Этап 2: ядро мониторинга
FROM node:20-alpine
# iputils — бинарь ping для ICMP-проверок
RUN apk add --no-cache iputils iproute2 tzdata wget
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    HTTP_PORT=8080 \
    AGENT_PORT=8443

COPY server/package.json ./package.json
# зависимостей у ядра нет — используем только встроенные модули Node

COPY server/src ./src
COPY --from=web /app/dist ./web

VOLUME /data
EXPOSE 8080 8443
CMD ["node", "src/server.js"]
