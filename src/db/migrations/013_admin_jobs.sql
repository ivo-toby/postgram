CREATE TABLE admin_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL
    CHECK (operation ~ '^[a-z][a-z0-9_.:_-]{1,127}$'),
  mode text NOT NULL
    CHECK (mode IN ('dry_run', 'apply')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued',
      'running',
      'cancel_requested',
      'succeeded',
      'failed',
      'cancelled'
    )),
  idempotency_key text
    CHECK (
      idempotency_key IS NULL
      OR (
        length(idempotency_key) BETWEEN 1 AND 256
        AND idempotency_key ~ '^[a-z][a-z0-9_.-]{0,63}:[a-z0-9][a-z0-9_.:-]{0,191}$'
      )
    ),
  request_fingerprint text
    CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[a-f0-9]{64}$'),
  CHECK (mode <> 'apply' OR idempotency_key IS NOT NULL),
  requested_scope jsonb NOT NULL DEFAULT '{}',
  request_summary jsonb NOT NULL DEFAULT '{}',
  result_summary jsonb NOT NULL DEFAULT '{}',
  progress_current integer NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
  progress_total integer CHECK (progress_total IS NULL OR progress_total >= 0),
  progress_message text CHECK (progress_message IS NULL OR length(progress_message) <= 500),
  created_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  started_at timestamptz,
  cancel_requested_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_admin_jobs_idempotency_key
  ON admin_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_admin_jobs_status_created
  ON admin_jobs (status, created_at DESC);

CREATE INDEX idx_admin_jobs_operation_created
  ON admin_jobs (operation, created_at DESC);

CREATE INDEX idx_admin_jobs_created_by_admin_user_id
  ON admin_jobs (created_by_admin_user_id);

CREATE TRIGGER trg_admin_jobs_updated_at
  BEFORE UPDATE ON admin_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE admin_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES admin_jobs(id) ON DELETE CASCADE,
  admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  event_type text NOT NULL
    CHECK (event_type IN (
      'create',
      'start',
      'progress',
      'cancel_request',
      'succeed',
      'fail',
      'cancel'
    )),
  from_status text
    CHECK (from_status IS NULL OR from_status IN (
      'queued',
      'running',
      'cancel_requested',
      'succeeded',
      'failed',
      'cancelled'
    )),
  to_status text
    CHECK (to_status IS NULL OR to_status IN (
      'queued',
      'running',
      'cancel_requested',
      'succeeded',
      'failed',
      'cancelled'
    )),
  progress jsonb NOT NULL DEFAULT '{}',
  summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_job_events_job_created
  ON admin_job_events (job_id, created_at ASC);

CREATE INDEX idx_admin_job_events_admin_user_id
  ON admin_job_events (admin_user_id);
