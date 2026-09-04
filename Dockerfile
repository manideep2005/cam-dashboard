# ─────────────────────────────────────────────────────────────────────
#  CAMMAP-GIS — production image
#
#  Build:  docker build -t cammap-gis .
#  Run:    docker compose up -d        (recommended, see docker-compose.yml)
#
#  better-sqlite3 ships prebuilt binaries for linux-x64 (glibc), so the
#  runtime uses node:24-slim (Debian) — no source compile needed.
# ─────────────────────────────────────────────────────────────────────

# ── Stage 1: build the frontend ──────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001

# Runtime deps only (express, better-sqlite3, cors, …)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built frontend + server code
COPY --from=build /app/dist ./dist
COPY server ./server
# server/camera-generator.js imports ../src/zoneData.js — keep geometry in sync
COPY src/zoneData.js ./src/zoneData.js

COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3001

CMD ["./entrypoint.sh"]