-- Document loaders: loading state on entities and a table for attachments
-- (the original upload and anything a loader derives from it). loading_status
-- stays NULL for entities that never go through a loader.
ALTER TABLE entities
  ADD COLUMN mime_type text,
  ADD COLUMN loading_status text
    CHECK (loading_status IN ('pending', 'running', 'completed', 'failed')),
  ADD COLUMN loading_error text,
  ADD COLUMN loading_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN loader_name text;

CREATE INDEX idx_entities_loading_status
  ON entities (loading_status)
  WHERE loading_status IS NOT NULL;

CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('original', 'derived')),
  ref         text NOT NULL,
  kind        text NOT NULL
    CHECK (kind IN ('document', 'image', 'audio', 'video', 'binary')),
  mime_type   text NOT NULL,
  filename    text,
  byte_size   bigint NOT NULL CHECK (byte_size >= 0),
  sha256      text NOT NULL,
  storage_uri text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, ref)
);

CREATE INDEX idx_attachments_entity_id ON attachments (entity_id);
CREATE INDEX idx_attachments_sha256 ON attachments (sha256);
CREATE UNIQUE INDEX idx_attachments_one_original
  ON attachments (entity_id)
  WHERE role = 'original';
