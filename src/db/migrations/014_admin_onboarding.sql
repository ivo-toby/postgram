CREATE TABLE admin_onboarding_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'skipped', 'completed')),
  current_step text NOT NULL DEFAULT 'setup'
    CHECK (current_step IN (
      'setup',
      'provider_config',
      'secrets',
      'validate_apply',
      'backup_restore',
      'maintenance'
    )),
  completed_steps text[] NOT NULL DEFAULT '{}'
    CHECK (completed_steps <@ ARRAY[
      'setup',
      'provider_config',
      'secrets',
      'validate_apply',
      'backup_restore',
      'maintenance'
    ]::text[]),
  skipped_at timestamptz,
  completed_at timestamptz,
  updated_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      status = 'in_progress'
      AND skipped_at IS NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'skipped'
      AND skipped_at IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'completed'
      AND skipped_at IS NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE TRIGGER trg_admin_onboarding_state_updated_at
  BEFORE UPDATE ON admin_onboarding_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
