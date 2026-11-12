FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY cli/package.json ./cli/package.json
COPY packages/loader-pdf/package.json ./packages/loader-pdf/package.json
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY packages/loader-pdf/tsconfig.json packages/loader-pdf/tsconfig.build.json ./packages/loader-pdf/
COPY packages/loader-pdf/src ./packages/loader-pdf/src
COPY src ./src
RUN npm run build

FROM node:22-alpine
LABEL io.modelcontextprotocol.server.name="io.github.ivo-toby/postgram"
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/ivo-toby/postgram" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
RUN apk add --no-cache postgresql17-client tini
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
# node_modules/@ivotoby/postgram-loader-pdf links to this directory.
COPY --from=builder /app/packages/loader-pdf/package.json ./packages/loader-pdf/package.json
COPY --from=builder /app/packages/loader-pdf/dist ./packages/loader-pdf/dist
COPY packages/loader-pdf/THIRD_PARTY_LICENSES ./packages/loader-pdf/THIRD_PARTY_LICENSES
COPY --from=builder /app/package.json ./
COPY LICENSE ./LICENSE
COPY src/db/migrations ./dist/db/migrations
COPY docker/postgram-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x /app/dist/cli/admin/pgm-admin.js \
 && ln -s /app/dist/cli/admin/pgm-admin.js /usr/local/bin/pgm-admin \
 && chmod +x /app/docker-entrypoint.sh \
 && mkdir -p /var/lib/postgram/attachments \
 && chown -R node:node /var/lib/postgram
EXPOSE 3100
USER node
ENTRYPOINT ["tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3100/health || exit 1
