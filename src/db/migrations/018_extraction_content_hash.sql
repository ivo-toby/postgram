-- Records the sha256 of the content an extraction attempt ran against, so
-- re-embedding unchanged content does not re-queue graph extraction.
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS extraction_content_hash text;

-- Backfill only rows whose embedding reflects their current content. A row
-- with a pending/failed enrichment may have been edited since it was extracted;
-- hashing its new content would hide the edit from extraction. Those rows keep
-- a NULL hash and fall back to the old behaviour (re-queued after embedding).
UPDATE entities
   SET extraction_content_hash = encode(digest(content, 'sha256'), 'hex')
 WHERE extraction_status IN ('completed', 'failed')
   AND enrichment_status = 'completed'
   AND content IS NOT NULL
   AND extraction_content_hash IS NULL;
