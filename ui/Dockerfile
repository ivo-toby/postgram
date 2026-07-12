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
EXPOSE 3000
