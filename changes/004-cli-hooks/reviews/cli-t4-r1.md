# Review: cli-t4 (run worker-2026-11-01T17-21-53-782Z-78d82a58)

Verdict: revision.

Controller check in a fresh copy: `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/local.ts cli/tests/unit/tracking-local.test.ts` exits 1, 2 of 15 tests fail:

- "resolves root, branch, remote and counts from a subdirectory": dirty_count is 0, expected 1.
- "omits the branch key when branch resolution times out": the git key is missing.

Cause, in `cli/src/tracking/local.ts` `resolveLocalWorkspace`: the status call passes `['status', '--porcelain=v1', '--untracked-files', 'normal']`. `--untracked-files` takes its value only with `=`, so git treats `normal` as a pathspec and counts nothing; the fake runner key also does not match. The brief (R7) requires the single argument `--untracked-files=normal`.

Required fix: pass `['status', '--porcelain=v1', '--untracked-files=normal']`. Keep everything else; the tests are correct. Run run_checks and make all 15 tests pass before finishing.
