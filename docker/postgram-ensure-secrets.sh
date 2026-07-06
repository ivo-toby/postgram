#!/bin/sh
set -eu

SECRETS_DIR="${POSTGRAM_SECRETS_DIR:-/run/postgram-secrets}"
SECRET_UID="${POSTGRAM_SECRET_UID:-1000}"
SECRET_GID="${POSTGRAM_SECRET_GID:-1000}"
umask 077
mkdir -p "$SECRETS_DIR"

generate_base64url_secret() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
}

read_first_line() {
  file="$1"
  value=""
  if [ -f "$file" ]; then
    IFS= read -r value < "$file" || true
  fi
  printf '%s' "$value"
}

ensure_secret_file() {
  name="$1"
  file="$SECRETS_DIR/$name"
  if [ ! -s "$file" ]; then
    tmp="$file.tmp.$$"
    generate_base64url_secret > "$tmp"
    printf '\n' >> "$tmp"
    chown "$SECRET_UID:$SECRET_GID" "$tmp" 2>/dev/null || true
    chmod 400 "$tmp"
    mv "$tmp" "$file"
    echo "Generated $name in $SECRETS_DIR" >&2
  else
    chown "$SECRET_UID:$SECRET_GID" "$file" 2>/dev/null || true
    chmod 400 "$file" 2>/dev/null || true
  fi
}

validate_mfa_key() {
  value="$(read_first_line "$SECRETS_DIR/admin-mfa-secret-key")"
  if [ "${#value}" -lt 32 ]; then
    echo "ADMIN_MFA_SECRET_KEY must be at least 32 characters" >&2
    exit 78
  fi
}

validate_settings_key() {
  value="$(read_first_line "$SECRETS_DIR/admin-settings-encryption-key")"
  ADMIN_SETTINGS_ENCRYPTION_KEY="$value" node <<'NODE'
const value = process.env.ADMIN_SETTINGS_ENCRYPTION_KEY ?? '';
const raw = value.startsWith('base64:') ? value.slice('base64:'.length) : value;
const encoding = value.startsWith('base64:') ? 'base64' : 'base64url';
const decoded = Buffer.from(raw, encoding);
if (decoded.length !== 32) {
  console.error('ADMIN_SETTINGS_ENCRYPTION_KEY must decode to 32 bytes');
  process.exit(78);
}
NODE
}

ensure_secret_file "postgres-password"
ensure_secret_file "admin-mfa-secret-key"
ensure_secret_file "admin-settings-encryption-key"
validate_mfa_key
validate_settings_key
