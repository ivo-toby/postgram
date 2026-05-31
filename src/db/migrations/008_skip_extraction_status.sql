ALTER TABLE entities
  DROP CONSTRAINT entities_extraction_status_check;

ALTER TABLE entities
  ADD CONSTRAINT entities_extraction_status_check
  CHECK (extraction_status IN ('pending', 'completed', 'failed', 'skipped'));
