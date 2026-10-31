-- Records the sha256 of the content an extraction attempt ran against, so
-- re-embedding unchanged content does not re-queue graph extraction.
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS extraction_content_hash text;

-- Existing completed/failed rows are assumed to match their current content.
UPDATE entities
   SET extraction_content_hash = encode(digest(content, 'sha256'), 'hex')
 WHERE extraction_status IN ('completed', 'failed')
   AND content IS NOT NULL
   AND extraction_content_hash IS NULL;
