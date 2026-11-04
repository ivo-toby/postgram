-- 018_workspace_tracking.sql
-- Workspace and agent session tracking (spec 004, phase 1 schema).
-- Adds machines, workspaces, agent_sessions and repositories. The
-- `entities` table is unchanged; workspaces link to a feature task via
-- feature_id with ON DELETE SET NULL.

CREATE TABLE machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias text NOT NULL UNIQUE CHECK (alias ~ '^[a-z0-9._-]{1,64}$'),
  hostname text NOT NULL,
  connect_target text,
  boot_id text,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES machines(id),
  path text NOT NULL,
  repo_remote text,
  repo_root text,
  branch text,
  git_dirty_count int,
  git_unpushed_count int,
  git_has_upstream boolean,
  git_state_at timestamptz,
  feature_id uuid REFERENCES entities(id) ON DELETE SET NULL,
  missing_since timestamptz,
  last_activity_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (machine_id, path)
);

CREATE INDEX idx_workspaces_feature_id ON workspaces (feature_id);

CREATE INDEX idx_workspaces_repo_remote ON workspaces (repo_remote);

CREATE TABLE agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_kind text NOT NULL CHECK (agent_kind IN ('claude-code', 'pi', 'talon', 'other')),
  agent_session_id text,
  status text NOT NULL CHECK (status IN ('running', 'idle', 'ended', 'interrupted')),
  boot_id text,
  cwd text,
  transcript_path text,
  started_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason text
);

CREATE UNIQUE INDEX idx_agent_sessions_workspace_kind_session
  ON agent_sessions (workspace_id, agent_kind, agent_session_id)
  WHERE agent_session_id IS NOT NULL;

CREATE INDEX idx_agent_sessions_status ON agent_sessions (status);

CREATE INDEX idx_agent_sessions_workspace_last_activity
  ON agent_sessions (workspace_id, last_activity_at DESC);

CREATE TABLE repositories (
  remote text PRIMARY KEY,
  release_on_merge boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
