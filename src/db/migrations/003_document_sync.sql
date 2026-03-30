-- 003_document_sync.sql
-- Document sync: tracks files synced from local repos
CREATE TABLE document_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  repo        text NOT NULL,
  path        text NOT NULL,
  sha         text NOT NULL,
  last_synced timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'current' CHECK (sync_status IN ('current', 'stale', 'error')),

  UNIQUE (repo, path)
);

CREATE INDEX idx_document_sources_repo ON document_sources (repo);
CREATE INDEX idx_document_sources_entity_id ON document_sources (entity_id);
