-- 002_phase1_enhancements.sql
-- Hybrid search: generated tsvector column with 'simple' config (language-agnostic)
ALTER TABLE entities
  ADD COLUMN search_tsvector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX idx_entities_search_tsvector ON entities USING gin (search_tsvector);

-- Enrichment retry: attempt counter with backoff
ALTER TABLE entities
  ADD COLUMN enrichment_attempts integer NOT NULL DEFAULT 0;
