# Review: where-q1, run worker-2026-11-01T13-38-38-733Z-f8d32e81

Verdict: accepted (self-review by the controller agent, delegated by ivo).

Worker: titan-qwen38-pi (titan/llamacpp/qwen3.8-pi-q4km-128k), 495 s. The first
run on randal-qwen36 (worker-2026-11-01T13-01-37-035Z-49ba421b) timed out after
30 min: the server dropped to about 3 tokens/s and stalled during the write. The
second (worker-2026-11-01T13-37-46-649Z-5f971010) failed with a 500 from the
gateway while titan was still booting. Neither was a spec or model-quality problem.

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: tests/unit/where-rules.test.ts 19 passed. ESLint: no problems. tsc: no
  errors outside the protected feature tests.
- Scope: the 2 planned paths created, no extra paths, no violations.
- Inside the worker sandbox Vitest fails with `getaddrinfo ENOTFOUND localhost`
  (TinySDD #215), so the worker's own run_checks could not show test results.

## Review

- The exports match the brief signatures. The group tables match rest.md for both
  views, including the label texts and the released position.
- toWhereFeature defaults a missing or invalid stage to building with null
  stage_source and stage_set_at (D2), and keeps only PR entries with a url, a
  valid state and updated_at.
- Hiding rules: done/archived unless includeDone; released unless stage view
  with includeReleased (D3). The workspaces of hidden or unknown features appear
  nowhere.
- Ordering: newest workspace DESC with no-workspace features last, then
  stage_set_at DESC with null last, then id ASC. Workspaces sort by
  last_activity_at DESC, then id ASC. Sorting happens on filtered copies, and a
  test confirms the inputs are not mutated.
- The tests cover every acceptance row of the brief.
