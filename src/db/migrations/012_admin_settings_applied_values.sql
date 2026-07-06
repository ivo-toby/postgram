ALTER TABLE admin_runtime_settings
  ADD COLUMN applied_value jsonb;

UPDATE admin_runtime_settings
SET applied_value = value
WHERE state = 'applied'
  AND applied_value IS NULL;
