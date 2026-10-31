# Review: report-s8, run worker-2026-10-31T16-42-55-832Z-b7565831

Verdict: revision (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy of the candidate)

- `node changes/004-report-core/slice-check.mjs src/config.ts tests/unit/config-workspace.test.ts`: exit 0; Vitest 6 passed; ESLint 0 problems.
- `tsc -p tsconfig.json --noEmit`: no errors outside the protected feature test.
- Config entry and docker-compose line are correct.

## Required repair

The README row was added to the `### Embeddings` table (README.md around line 699). `WORKSPACE_DORMANT_AFTER_DAYS` is a server setting: move the row to the end of the `### Server` table under `## Environment Variables` (README.md lines 666-686) and keep that table's column format. Remove it from the Embeddings table. Keep the slice test passing. Change nothing else.

Cause: the brief's context cited only the Embeddings table, so this is a preparation gap, not a worker error.
