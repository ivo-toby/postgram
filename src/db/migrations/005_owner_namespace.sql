ALTER TABLE entities
  ADD COLUMN owner text;

CREATE INDEX idx_entities_owner ON entities (owner);
