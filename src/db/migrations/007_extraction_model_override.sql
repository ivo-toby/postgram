-- Per-entity LLM override for the enrichment worker. Set by
-- `pgm-admin improve-graph --model <m> --provider <p>` to ask the worker to
-- run that specific entity through a different model than the env-configured
-- default. Cleared by the worker on successful extraction. Left in place on
-- failure so retries use the same model.
ALTER TABLE entities
  ADD COLUMN extraction_model_override text,
  ADD COLUMN extraction_provider_override text;
