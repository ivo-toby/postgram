ALTER TABLE audit_log
  ADD COLUMN admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE INDEX idx_audit_log_admin_user_id
  ON audit_log (admin_user_id);

CREATE TABLE admin_runtime_settings (
  key text PRIMARY KEY
    CHECK (key ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  value jsonb NOT NULL,
  value_type text NOT NULL
    CHECK (value_type IN ('string', 'number', 'boolean', 'object', 'array', 'null')),
  classification text NOT NULL
    CHECK (classification IN (
      'bootstrap_only',
      'runtime_editable',
      'restart_required',
      'dangerous_migration'
    )),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'applied')),
  validation_status text NOT NULL DEFAULT 'unvalidated'
    CHECK (validation_status IN ('unvalidated', 'valid', 'invalid', 'error')),
  validation_message text,
  validation_metadata jsonb NOT NULL DEFAULT '{}',
  validated_at timestamptz,
  applied_version integer NOT NULL DEFAULT 0 CHECK (applied_version >= 0),
  applied_at timestamptz,
  updated_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_runtime_settings_state
  ON admin_runtime_settings (state);

CREATE INDEX idx_admin_runtime_settings_validation_status
  ON admin_runtime_settings (validation_status);

CREATE TRIGGER trg_admin_runtime_settings_updated_at
  BEFORE UPDATE ON admin_runtime_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE admin_runtime_secrets (
  name text PRIMARY KEY
    CHECK (name ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  provider text
    CHECK (provider IS NULL OR provider ~ '^[a-z][a-z0-9-]{0,63}$'),
  purpose text NOT NULL
    CHECK (purpose IN ('embedding', 'extraction', 'provider', 'other')),
  ciphertext text NOT NULL,
  nonce text NOT NULL,
  auth_tag text NOT NULL,
  algorithm text NOT NULL DEFAULT 'aes-256-gcm'
    CHECK (algorithm = 'aes-256-gcm'),
  key_version text NOT NULL DEFAULT 'v1'
    CHECK (key_version ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  validation_status text NOT NULL DEFAULT 'unvalidated'
    CHECK (validation_status IN ('unvalidated', 'valid', 'invalid', 'error')),
  validation_message text,
  validation_metadata jsonb NOT NULL DEFAULT '{}',
  validated_at timestamptz,
  updated_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_runtime_secrets_provider
  ON admin_runtime_secrets (provider);

CREATE INDEX idx_admin_runtime_secrets_validation_status
  ON admin_runtime_secrets (validation_status);

CREATE TRIGGER trg_admin_runtime_secrets_updated_at
  BEFORE UPDATE ON admin_runtime_secrets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
