CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending_mfa'
    CHECK (status IN ('pending_mfa', 'active', 'disabled')),
  mfa_required boolean NOT NULL DEFAULT true,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_users_status
  ON admin_users (status);

CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  mfa_verified_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_sessions_admin_user_id
  ON admin_sessions (admin_user_id);

CREATE INDEX idx_admin_sessions_active
  ON admin_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE admin_mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  factor_type text NOT NULL CHECK (factor_type IN ('totp')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'disabled')),
  secret_ciphertext text,
  recovery_hashes text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  disabled_at timestamptz
);

CREATE INDEX idx_admin_mfa_factors_admin_user_id
  ON admin_mfa_factors (admin_user_id);

CREATE UNIQUE INDEX idx_admin_mfa_factors_one_verified_totp
  ON admin_mfa_factors (admin_user_id, factor_type)
  WHERE status = 'verified';

CREATE TABLE admin_bootstrap_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_bootstrap_tokens_available
  ON admin_bootstrap_tokens (expires_at)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE admin_auth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  attempt_type text NOT NULL
    CHECK (attempt_type IN ('login', 'bootstrap', 'mfa', 'step_up')),
  identifier text,
  succeeded boolean NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_auth_attempts_type_created
  ON admin_auth_attempts (attempt_type, created_at DESC);

CREATE INDEX idx_admin_auth_attempts_admin_user_id
  ON admin_auth_attempts (admin_user_id);
