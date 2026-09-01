# ─── PLUTO Core: multi-stage build из корня репозитория ─────────────────────
# docker compose up -d --build

# Этап 1: сборка веб-консоли (React + Vite)
FROM node:20-alpine AS web
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY vite.config.js tsconfig.json index.html ./
COPY src ./src
RUN npm run build

# Этап 2: серверное ядро (Node, без внешних npm-зависимостей)
FROM node:20-alpine
# iputils — настоящий ping (ICMP) для проверок; tzdata — часовой пояс
RUN apk add --no-cache iputils iproute2 tzdata
WORKDIR /app/server
ENV NODE_ENV=production \
    DATA_DIR=/app/server/data \
    HTTP_PORT=8080

COPY server/package.json ./package.json
COPY server/src ./src
COPY --from=web /app/dist ./web

VOLUME /app/server/data
EXPOSE 8080 8081
CMD ["node", "src/server.js"]
