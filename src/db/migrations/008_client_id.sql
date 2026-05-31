ALTER TABLE api_keys
  ADD COLUMN client_id text;

UPDATE api_keys
SET client_id = name
WHERE client_id IS NULL;

ALTER TABLE api_keys
  ALTER COLUMN client_id SET NOT NULL;

CREATE INDEX idx_api_keys_client_id
  ON api_keys (client_id);
