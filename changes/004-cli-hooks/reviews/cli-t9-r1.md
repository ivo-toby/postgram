# Review: cli-t9 (run worker-2026-11-01T18-39-35-156Z-009eeaff)

Verdict: revision.

Controller check on the host (git available): 13 of 14 tests pass. One test fails:

- "refuses an existing path before creating anything" (`cli/tests/unit/tracking-worktree.test.ts` line 339): `mkdirSync(expected)` throws ENOENT because the parent `<repo>.worktrees` does not exist yet.

In your sandbox git is not runnable, so the git-backed tests return early and you could not see this.

Required fix: use `mkdirSync(expected, { recursive: true })` there. Do not change `cli/src/tracking/worktree.ts`; the implementation is accepted as is. Call run_checks once and finish.
