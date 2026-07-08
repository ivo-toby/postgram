FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY cli/package.json ./cli/package.json
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache postgresql17-client tini
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY src/db/migrations ./dist/db/migrations
COPY docker/postgram-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x /app/dist/cli/admin/pgm-admin.js \
 && ln -s /app/dist/cli/admin/pgm-admin.js /usr/local/bin/pgm-admin \
 && chmod +x /app/docker-entrypoint.sh
EXPOSE 3100
USER node
ENTRYPOINT ["tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3100/health || exit 1
