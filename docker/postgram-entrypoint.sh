#!/bin/sh
set -eu

SECRETS_DIR="${POSTGRAM_SECRETS_DIR:-/run/postgram-secrets}"

read_secret_file() {
  file="$1"
  if [ ! -s "$file" ]; then
    echo "Missing required Docker secret file: $file" >&2
    exit 78
  fi

  value=""
  IFS= read -r value < "$file" || true
  if [ -z "$value" ]; then
    echo "Docker secret file is empty: $file" >&2
    exit 78
  fi
  printf '%s' "$value"
}

validate_mfa_key() {
  value="$1"
  if [ "${#value}" -lt 32 ]; then
    echo "ADMIN_MFA_SECRET_KEY must be at least 32 characters" >&2
    exit 78
  fi
}

validate_settings_key() {
  value="$1"
  ADMIN_SETTINGS_ENCRYPTION_KEY="$value" node <<'NODE'
const value = process.env.ADMIN_SETTINGS_ENCRYPTION_KEY ?? '';
const raw = value.startsWith('base64:') ? value.slice('base64:'.length) : value;
const encoding = value.startsWith('base64:') ? 'base64' : 'base64url';
const validFormat = value.startsWith('base64:')
  ? /^[A-Za-z0-9+/]{43}=$/.test(raw)
  : /^[A-Za-z0-9_-]{43}$/.test(raw);
if (!validFormat) {
  console.error('ADMIN_SETTINGS_ENCRYPTION_KEY must be a 32-byte base64url value');
  process.exit(78);
}
const decoded = Buffer.from(raw, encoding);
if (decoded.length !== 32) {
  console.error('ADMIN_SETTINGS_ENCRYPTION_KEY must decode to 32 bytes');
  process.exit(78);
}
NODE
}

build_postgres_url() {
  POSTGRAM_URL_USER="$1" \
  POSTGRAM_URL_PASSWORD="$2" \
  POSTGRAM_URL_HOST="$3" \
  POSTGRAM_URL_PORT="$4" \
  POSTGRAM_URL_DB="$5" \
  node <<'NODE'
const user = process.env.POSTGRAM_URL_USER ?? 'postgram';
const password = process.env.POSTGRAM_URL_PASSWORD ?? '';
const rawHost = process.env.POSTGRAM_URL_HOST ?? 'postgres';
const port = process.env.POSTGRAM_URL_PORT ?? '5432';
const database = process.env.POSTGRAM_URL_DB ?? 'postgram';

const host =
  rawHost.includes(':') && !rawHost.startsWith('[') ? `[${rawHost}]` : rawHost;
const auth =
  password.length > 0
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);

process.stdout.write(
  `postgres://${auth}@${host}:${port}/${encodeURIComponent(database)}`
);
NODE
}

if [ -z "${DATABASE_URL:-}" ]; then
  postgres_user="${POSTGRES_USER:-postgram}"
  postgres_db="${POSTGRES_DB:-postgram}"
  postgres_host="${POSTGRES_HOST:-postgres}"
  postgres_port="${POSTGRES_PORT:-5432}"

  if [ "${POSTGRES_PASSWORD+x}" = "x" ]; then
    if [ -n "$POSTGRES_PASSWORD" ] || [ "$postgres_host" != "postgres" ]; then
      postgres_password="$POSTGRES_PASSWORD"
    else
      postgres_password="$(read_secret_file "$SECRETS_DIR/postgres-password")"
    fi
  else
    postgres_password="$(read_secret_file "$SECRETS_DIR/postgres-password")"
  fi

  DATABASE_URL="$(
    build_postgres_url \
      "$postgres_user" \
      "$postgres_password" \
      "$postgres_host" \
      "$postgres_port" \
      "$postgres_db"
  )"
  export DATABASE_URL
fi

if [ -z "${EMBEDDING_PROVIDER:-}" ]; then
  if [ -n "${OPENAI_API_KEY:-}" ]; then
    export EMBEDDING_PROVIDER="openai"
  else
    export EMBEDDING_PROVIDER="ollama"
  fi
fi

if [ -z "${ADMIN_MFA_SECRET_KEY:-}" ]; then
  ADMIN_MFA_SECRET_KEY="$(read_secret_file "$SECRETS_DIR/admin-mfa-secret-key")"
  export ADMIN_MFA_SECRET_KEY
fi
validate_mfa_key "$ADMIN_MFA_SECRET_KEY"

if [ -z "${ADMIN_SETTINGS_ENCRYPTION_KEY:-}" ]; then
  ADMIN_SETTINGS_ENCRYPTION_KEY="$(read_secret_file "$SECRETS_DIR/admin-settings-encryption-key")"
  export ADMIN_SETTINGS_ENCRYPTION_KEY
fi
validate_settings_key "$ADMIN_SETTINGS_ENCRYPTION_KEY"

exec "$@"
