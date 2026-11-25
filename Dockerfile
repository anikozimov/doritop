# DORI TOP — production obrazi
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/dori_top.db UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups
WORKDIR /app
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app && mkdir -p /data && chown app:app /data
COPY --from=build --chown=app:app /app /app
USER app
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
