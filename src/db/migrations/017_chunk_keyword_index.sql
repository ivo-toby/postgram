-- 017_chunk_keyword_index.sql
-- Chunk-level keyword retrieval uses this expression index.  The migration
-- runner executes each migration in one transaction, so CREATE INDEX keeps
-- reads available while taking the normal write lock on chunks until commit.
-- CREATE INDEX CONCURRENTLY cannot run inside that runner; schedule this
-- migration when chunk writes can briefly wait for the index build.
CREATE INDEX idx_chunks_content_tsvector
  ON chunks USING gin (to_tsvector('simple', content));
