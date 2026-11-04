# Review: report-s4, run worker-2026-10-31T16-51-52-439Z-83ffb22e

Verdict: revision (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy of the candidate)

- `node changes/004-report-core/slice-check.mjs src/services/workspace-report-schema.ts tests/unit/workspace-report-schema.test.ts`: exit 1; Vitest 31 passed; ESLint 145 errors, all `no-unsafe-*` in the test file.
- `tsc -p tsconfig.json --noEmit`: 5 errors outside the protected feature test (listed below).

## Required repair

1. `tests/unit/workspace-report-schema.test.ts` lines 3-5 import without the `.js` extension. Under `moduleResolution: NodeNext` this is TS2835, and the unresolved types cause every ESLint `no-unsafe-*` error. Use `'../../src/services/workspace-report-schema.js'` and `'../../src/util/errors.js'`, as `tests/unit/git-remote.test.ts` does.
2. `src/services/workspace-report-schema.ts` line 233 (TS2379) and line 236 (TS2322): zod 3 types an `.optional()` key as `key?: T | undefined`. With `exactOptionalPropertyTypes` that does not assign to `ReportWorkspace` / `ReportSession`, whose optional keys are `key?: T`. Do not cast and do not loosen the interfaces with `| undefined`. Build the output objects from the parsed value and copy each optional key only when it is not `undefined` (for example `...(w.repo_remote !== undefined ? { repo_remote: w.repo_remote } : {})`), for the workspace keys `repo_remote`, `repo_root`, `branch`, `git` and the session keys `event`, `reason`, `observed_at`. This keeps the "omitted stays absent" rule.

Keep all 31 tests passing and change nothing else. The worker cannot run tsc or ESLint in its sandbox, so check both repairs by reading the code: every relative import ends in `.js`, and no value typed `T | undefined` is assigned to an optional key typed `T`.

Cause: item 1 is a worker error (the `.js` rule was in the compiled context). Item 2 is a preparation gap: the context named `exactOptionalPropertyTypes` but not its interaction with zod output types.
