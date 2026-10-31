FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
LABEL org.opencontainers.image.source="https://github.com/ivo-toby/postgram" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=builder /app/dist /usr/share/nginx/html
COPY LICENSE /usr/share/licenses/postgram-ui/LICENSE
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-postgram-mcp-upstream.sh /docker-entrypoint.d/40-postgram-mcp-upstream.sh
# The entrypoint script regenerates the upstream at start; bake the static
# (resolve-once) variant into the image so a container started without the
# stock entrypoint still has a valid config. `server ... resolve` needs
# nginx >= 1.27.3, so the build first generates and parses the re-resolving
# variant (the default on Docker compose) and fails on an older base image
# instead of crash-looping at start.
RUN chmod 0755 /docker-entrypoint.d/40-postgram-mcp-upstream.sh \
  && NGINX_RESOLVER=127.0.0.11 /docker-entrypoint.d/40-postgram-mcp-upstream.sh \
  && nginx -t \
  && NGINX_RESOLVER=off /docker-entrypoint.d/40-postgram-mcp-upstream.sh
EXPOSE 3000
