# Review: feature-f2 to feature-f5, re-acceptance after removing stray worker files

Verdict: accepted (self-review by the controller agent; ivo approved removing the files and asked to accept phase 1 and 2).

The f2 and f3 apply records included stray files written while run_checks was missing (TinySDD #197): `internal/evidence/.../checks.json`, `.tmp-listing-check`, `__run_checks_now.json`. Removing them made f2 and f3 stale and blocked f4 and f5 (TinySDD #202). The change's source and test files are unchanged.

## Observed in the project (2026-10-31, Docker available)

- Same run as report-reaccept-after-d1.md: 14 files, 185 tests passed, including the protected feature test (8) and every feature slice test.
