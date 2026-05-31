# Skip Extraction Flag Design

## Summary

Add an explicit way to store content that should be embedded for search but never processed by graph extraction. The first consumer is bulk import of Claude Desktop conversations, where broad LLM extraction would be expensive and noisy but semantic search over the content is still useful.

The feature introduces a terminal `extraction_status = 'skipped'` state and a `skip_extraction` input flag on store surfaces. `skipped` means the entity has intentionally opted out of extraction. Normal workers and admin queue commands must not turn it back into `pending`.

## Goals

- Let MCP, REST, and CLI callers store entities that remain searchable through embeddings.
- Prevent those entities from ever entering LLM graph extraction by accident.
- Make skipped extraction visible in queue/status reporting.
- Keep the implementation small and aligned with the current enrichment/extraction split.

## Non-Goals

- Do not add policy-based extraction selection.
- Do not implement Claude Desktop import in this change.
- Do not add an override flag for reextracting skipped entities.
- Do not change embedding behavior for skipped entities.

## Current Behavior

`storeEntity` inserts content-bearing entities with `enrichment_status = 'pending'`. When extraction is enabled, the enrichment worker embeds the content and then sets `extraction_status = 'pending'` for most entities. The extraction worker only processes rows where `extraction_status = 'pending'`.

This means a store-time flag cannot only affect the initial insert. The enrichment worker must preserve the skip intent when it completes embedding, otherwise the row will still be queued for extraction.

## Proposed Behavior

Add `skip_extraction` to public store APIs and `skipExtraction` to the internal service input.

When `skipExtraction` is true:

- The entity is inserted normally.
- If it has content, `enrichment_status` remains `pending`.
- `extraction_status` is set to `skipped`.
- The enrichment worker preserves `skipped` after embedding completes.
- The extraction worker ignores the row because it only reads `pending`.
- Admin queue commands that mark entities for extraction exclude skipped rows and do not reset them.

When `skipExtraction` is false or omitted, existing behavior stays the same.

## Status Semantics

- `pending`: queued for extraction.
- `completed`: extraction ran successfully.
- `failed`: extraction attempted and failed.
- `skipped`: intentionally opted out; never extract through normal or admin queue paths.
- `null`: extraction not initialized, extraction disabled at the time, metadata-only rows, or legacy rows.

`skipped` is not a transient delay state. Callers that want delayed extraction should not use this flag.

## API Surface

### MCP

The `store` tool accepts:

```json
{
  "skip_extraction": true
}
```

The field is optional and defaults to `false`.

### REST

`POST /api/entities` accepts the same optional `skip_extraction` field for parity with MCP.

### CLI

The user-facing store command accepts:

```bash
pgm store --skip-extraction ...
```

The flag maps to the REST `skip_extraction` request field.

## Database Changes

Add a migration that expands the `entities.extraction_status` check constraint to include `skipped`.

No backfill is required. Existing rows keep their current status.

## Worker Changes

The enrichment worker currently sets `extraction_status = 'pending'` after successful embedding when extraction is enabled. It should instead preserve a pre-existing `skipped` status:

- if `extraction_status = 'skipped'`, leave it as `skipped`;
- else if the row is auto-created, keep the existing auto-created skip behavior;
- else set `extraction_status = 'pending'`.

The extraction worker already selects only `pending` rows, so no behavioral change is needed there beyond tests documenting that `skipped` rows are ignored.

## Admin Command Behavior

`pgm-admin reextract` and `pgm-admin improve-graph` must treat skipped rows as out of scope:

- Bulk selections exclude `extraction_status = 'skipped'`.
- `--id <uuid>` must not reset a skipped row to `pending`; it should report zero marked or a clear skipped-row message consistent with existing guardrail reporting.
- `--show-skipped` should include a `skipped_extraction` category if the command already reports skipped categories.

This protects the hard opt-out from accidental later maintenance commands.

## Queue Reporting

Queue status should count skipped extraction rows separately when extraction reporting is enabled:

```json
{
  "extraction": {
    "pending": 0,
    "completed": 0,
    "failed": 0,
    "skipped": 42
  }
}
```

Failure listings remain limited to failed rows.

## Testing

Add tests for:

- `storeEntity` persists `extraction_status = 'skipped'` when `skipExtraction` is true.
- Enrichment still creates chunks for skipped entities and leaves `extraction_status = 'skipped'`.
- MCP `store` accepts `skip_extraction`.
- REST `POST /api/entities` accepts `skip_extraction`.
- CLI `pgm store --skip-extraction` sends the flag.
- `pgm-admin reextract` and `pgm-admin improve-graph` do not queue skipped rows, including targeted `--id` cases.
- Queue status reports skipped extraction counts.

## Rollout Notes

This is backward-compatible for existing callers because the new input is optional and defaults to current behavior. The only schema change is widening an existing check constraint.

The future Claude Desktop importer can use `--skip-extraction` by default for conversation entities while still allowing embeddings to make the archive searchable.
