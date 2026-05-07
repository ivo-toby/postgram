-- 008_pluggable_loaders.sql
-- Pluggable document loaders: structured ingestion for non-text inputs.
-- See specs/003-pluggable-document-loaders/.

-- Source identity and MIME for entities created via document loaders.
-- Existing rows keep NULLs and continue to work.
ALTER TABLE entities
  ADD COLUMN mime_type text,
  ADD COLUMN source_uri text,
  ADD COLUMN loading_status text
    CHECK (loading_status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  ADD COLUMN loading_error text,
  ADD COLUMN loading_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN loader_name text;

-- Idempotent re-ingest: posting the same URL twice returns the existing entity.
-- Partial unique index so legacy rows with NULL source_uri are unaffected.
CREATE UNIQUE INDEX idx_entities_source_uri
  ON entities (source_uri)
  WHERE source_uri IS NOT NULL;

CREATE INDEX idx_entities_loading_status
  ON entities (loading_status)
  WHERE loading_status IS NOT NULL;

CREATE INDEX idx_entities_mime_type
  ON entities (mime_type)
  WHERE mime_type IS NOT NULL;

-- Per-chunk provenance from the loader's structured output. Defaults make the
-- backfill trivial: existing chunks become block_kind='text' with empty meta.
ALTER TABLE chunks
  ADD COLUMN block_kind text NOT NULL DEFAULT 'text',
  ADD COLUMN block_metadata jsonb NOT NULL DEFAULT '{}';

CREATE INDEX idx_chunks_block_kind ON chunks (block_kind);

-- Binary media extracted by loaders (images on PDF pages, original audio on
-- transcribed entities, etc.). storage_uri is opaque to the database; today
-- it's a filesystem path under attachmentsDir, tomorrow it can be an S3 URI.
CREATE TABLE attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  ref          text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('image', 'audio', 'video', 'binary')),
  mime_type    text NOT NULL,
  byte_size    bigint NOT NULL CHECK (byte_size >= 0),
  sha256       text NOT NULL,
  storage_uri  text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Per-entity dedupe: a logo image present on every page is one row.
  UNIQUE (entity_id, sha256),
  -- Loader-supplied refs are unique within an entity so blocks can resolve them.
  UNIQUE (entity_id, ref)
);

CREATE INDEX idx_attachments_entity_id ON attachments (entity_id);
CREATE INDEX idx_attachments_sha256 ON attachments (sha256);
CREATE INDEX idx_attachments_kind ON attachments (kind);
