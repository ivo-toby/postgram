#!/usr/bin/with-contenv bashio
set -euo pipefail

PGDATA="/data/postgres"
PGSOCKET="/run/postgresql"
POSTGRES_USER="postgram"
POSTGRES_DB="postgram"

mkdir -p "${PGDATA}" "${PGSOCKET}"
chown -R postgres:postgres "${PGDATA}" "${PGSOCKET}"

if [ ! -s "${PGDATA}/PG_VERSION" ]; then
  bashio::log.info "Initialising PostgreSQL..."
  su postgres -c "initdb -D '${PGDATA}' --auth=trust --encoding=UTF8"
fi

bashio::log.info "Starting PostgreSQL..."
su postgres -c "pg_ctl -D '${PGDATA}' -o \"-k ${PGSOCKET} -h 127.0.0.1\" -w start"

su postgres -c "psql -h '${PGSOCKET}' -d postgres -tc \"SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'\" | grep -q 1 || createuser -h '${PGSOCKET}' '${POSTGRES_USER}'"
su postgres -c "psql -h '${PGSOCKET}' -d postgres -tc \"SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'\" | grep -q 1 || createdb -h '${PGSOCKET}' -O '${POSTGRES_USER}' '${POSTGRES_DB}'"
su postgres -c "psql -h '${PGSOCKET}' -d '${POSTGRES_DB}' -c 'CREATE EXTENSION IF NOT EXISTS vector;'"

OPENAI_API_KEY="$(bashio::config 'openai_api_key')"
if [ -z "${OPENAI_API_KEY}" ]; then
  bashio::exit.nok "openai_api_key is required."
fi

export DATABASE_URL="postgresql://postgram@127.0.0.1:5432/postgram"
export POSTGRES_HOST="127.0.0.1"
export POSTGRES_PORT="5432"
export POSTGRES_DB="${POSTGRES_DB}"
export POSTGRES_USER="${POSTGRES_USER}"
export OPENAI_API_KEY
export EMBEDDING_PROVIDER="openai"
export EMBEDDING_MODEL="text-embedding-3-small"
export EMBEDDING_DIMENSIONS="1536"
export LOG_LEVEL="$(bashio::config 'log_level')"
export PORT="3100"
export EXTRACTION_ENABLED="$(bashio::config 'extraction_enabled')"
export EXTRACTION_PROVIDER="openai"
export EXTRACTION_MODEL="$(bashio::config 'extraction_model')"

if [ ! -f /data/admin_mfa_secret ]; then
  head -c 48 /dev/urandom | base64 > /data/admin_mfa_secret
fi
if [ ! -f /data/admin_settings_key ]; then
  head -c 48 /dev/urandom | base64 > /data/admin_settings_key
fi
export ADMIN_MFA_SECRET_KEY="$(cat /data/admin_mfa_secret)"
export ADMIN_SETTINGS_ENCRYPTION_KEY="$(cat /data/admin_settings_key)"

bashio::log.info "Starting upstream Postgram API/MCP on port 3100..."
cd /opt/postgram
node dist/index.js &
POSTGRAM_PID=$!

bashio::log.info "Starting Postgram web interface on port 3000..."
nginx -g 'daemon off;' &
NGINX_PID=$!

cleanup() {
  bashio::log.info "Stopping Postgram..."
  kill "${POSTGRAM_PID}" "${NGINX_PID}" 2>/dev/null || true
  su postgres -c "pg_ctl -D '${PGDATA}' -m fast stop" 2>/dev/null || true
}
trap cleanup EXIT TERM INT

set +e
wait -n "${POSTGRAM_PID}" "${NGINX_PID}"
STATUS=$?
set -e
bashio::log.error "A Postgram service exited unexpectedly (status ${STATUS})."
exit "${STATUS}"
