FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY cli/package.json ./cli/package.json
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY src/db/migrations ./dist/db/migrations
EXPOSE 3100
USER node
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3100/health || exit 1
