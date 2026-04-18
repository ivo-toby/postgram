# Quickstart: Local Embedding Provider Support

Two scenarios: fresh install on Ollama, and migrating an existing OpenAI deployment.

## Scenario A — Fresh install with local embeddings

1. Pull the model on your Ollama host: `ollama pull bge-m3`.
2. Set env (embedding host independent from extraction host):

    ```dotenv
    EMBEDDING_PROVIDER=ollama
    EMBEDDING_MODEL=bge-m3
    EMBEDDING_DIMENSIONS=1024
    EMBEDDING_BASE_URL=https://embeddings.example.com   # your embedding host
    # EMBEDDING_API_KEY=...                             # optional

    # LLM extraction can point somewhere else entirely (or stay disabled)
    EXTRACTION_ENABLED=false
    # or, if you want extraction:
    # EXTRACTION_ENABLED=true
    # EXTRACTION_PROVIDER=ollama
    # OLLAMA_BASE_URL=https://inference.example.com
    ```

3. Start the server. `OPENAI_API_KEY` is not required in this configuration.
4. Startup log shows: `embedding provider active provider=ollama model=bge-m3 dimensions=1024 host=https://embeddings.example.com`.
5. Ingest entities and run searches through the usual REST/MCP endpoints. Enrichment uses the configured embedding host.

## Scenario B — Migrate an existing OpenAI deployment

1. Pull the target model on the destination host.
2. Update env (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_BASE_URL`). Do NOT restart the server yet.
3. Dry-run:

    ```bash
    docker exec postgram pgm-admin embeddings migrate --target-dimensions 1024 --dry-run
    ```

    Reports chunks to discard and entities to mark pending. No writes.

4. Run the migration (maintenance-window operation — takes an exclusive schema lock on `chunks` during the `ALTER TABLE` and index rebuild; search is unavailable for migrated entities until the enrichment worker backfills):

    ```bash
    docker exec postgram pgm-admin embeddings migrate --target-dimensions 1024 --yes
    ```

    Discards chunks, alters the column to `vector(1024)`, inserts a new active `embedding_models` row, marks entities with content `pending`, writes an audit row.

5. Restart the server. The enrichment worker regenerates chunks and embeddings in the background. Search returns results once enrichment catches up.

## Rollback

To go back to OpenAI: reverse env (`EMBEDDING_PROVIDER=openai`, `EMBEDDING_DIMENSIONS=1536`, re-add `OPENAI_API_KEY`), then re-run the migrate command with `--target-dimensions 1536 --yes`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Server refuses to start: dimension mismatch | Config and storage disagree | Run `pgm-admin embeddings migrate --target-dimensions <configured> --yes` |
| Migrate refuses: missing `--yes` | Destructive path without confirmation | Add `--yes` or use `--dry-run` |
| Migrate refuses: env/flag mismatch | `EMBEDDING_DIMENSIONS` does not equal `--target-dimensions` | Align env and flag before retrying |
| Enrichment stuck after migrate | Embedding host unreachable | Restore connectivity; enrichment retries with existing backoff |
| OpenAI config keeps working after upgrade | Expected — no config change required | — |

## Verification

```bash
npm run lint
npm run build
npm run test
```

The existing REST/MCP contract suite must still pass unchanged (FR-013 regression).
