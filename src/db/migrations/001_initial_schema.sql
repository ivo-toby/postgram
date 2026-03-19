CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE embedding_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider text NOT NULL,
  dimensions integer NOT NULL,
  chunk_size integer NOT NULL,
  chunk_overlap integer NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_embedding_models_active
  ON embedding_models (is_active)
  WHERE is_active = true;

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{read}',
  allowed_types text[],
  allowed_visibility text[] NOT NULL DEFAULT '{shared}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX idx_api_keys_prefix
  ON api_keys (key_prefix)
  WHERE is_active = true;

CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('memory', 'person', 'project', 'task', 'interaction', 'document')),
  content text,
  visibility text NOT NULL DEFAULT 'shared' CHECK (visibility IN ('personal', 'work', 'shared')),
  status text CHECK (status IN ('active', 'done', 'archived', 'inbox', 'next', 'waiting', 'scheduled', 'someday')),
  enrichment_status text CHECK (enrichment_status IN ('pending', 'completed', 'failed')),
  version integer NOT NULL DEFAULT 1,
  tags text[] NOT NULL DEFAULT '{}',
  source text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_entities_type ON entities (type);
CREATE INDEX idx_entities_visibility ON entities (visibility);
CREATE INDEX idx_entities_status ON entities (status) WHERE status IS NOT NULL;
CREATE INDEX idx_entities_tags ON entities USING gin (tags);
CREATE INDEX idx_entities_metadata ON entities USING gin (metadata jsonb_path_ops);
CREATE INDEX idx_entities_created_at ON entities (created_at DESC);

CREATE TABLE chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  model_id uuid NOT NULL REFERENCES embedding_models(id),
  token_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, chunk_index)
);

CREATE INDEX idx_chunks_entity_id ON chunks (entity_id);
CREATE INDEX idx_chunks_embedding
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid REFERENCES api_keys(id),
  operation text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_timestamp ON audit_log (timestamp DESC);
CREATE INDEX idx_audit_log_api_key ON audit_log (api_key_id);
CREATE INDEX idx_audit_log_operation ON audit_log (operation);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_entities_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO embedding_models (
  name,
  provider,
  dimensions,
  chunk_size,
  chunk_overlap,
  is_active
)
VALUES (
  'text-embedding-3-small',
  'openai',
  1536,
  300,
  100,
  true
);
