# Design: 004 phase 4, CLI and hooks

## Shape

All new code is in `cli/src/tracking/` (D1). Pure helpers first, then one
file per command group, then one wiring slice.

| Slice | Files | Test | Depends on |
| --- | --- | --- | --- |
| cli-t1 | tracking/config.ts (`shq`, `slug`, default alias, `~/.pgmrc` tracking keys, resume merge, `writeMachineConfig`) | unit | none |
| cli-t2 | tracking/types.ts, tracking/resume.ts (resume rendering, transcript gone, ages) | unit | t1 |
| cli-t3 | tracking/api.ts, client.ts (export `request`) | unit, stub fetch | none |
| cli-t4 | tracking/local.ts (git state with budget, boot id, marker) | unit, temp git repos | none |
| cli-t5 | tracking/here.ts (hook parsing, report body, log, output, `here` command) | unit | t1, t3, t4 |
| cli-t6 | tracking/hooks.ts, integrations/pi/postgram.ts, tsconfig/package `files` | unit | t1 |
| cli-t7 | tracking/where.ts (disk check, layout, `--json`, `where` command) | unit | t1, t2, t3 |
| cli-t8 | tracking/feature-commands.ts (`feature`, `machine`, `repo`) | unit | t1, t3, t4 |
| cli-t9 | tracking/worktree.ts (`worktree new`) | unit, temp git repo | t1, t3, t4 |
| cli-t10 | tracking/scan-discovery.ts (repos, worktrees, Claude and pi sessions, assignment) | unit, temp dirs | t1, t4 |
| cli-t11 | tracking/scan.ts (proposals, prompt, recording, known workspaces) | unit | t3, t4, t7, t10 |
| cli-w1 | pgm.ts (register calls), cli/README.md section | feature tests | all |

Command files take their effects through a small `deps` object (client,
clock, stdin answers, git runner, file system root) so unit tests run without
a server (D11). The wiring slice builds the real deps.

## Checks

`changes/004-cli-hooks/slice-check.mjs` runs Vitest with `--root cli` on the
slice test, ESLint `--max-warnings=0` on the listed files and `tsc --noEmit`
for `cli/tsconfig.json`. Feature acceptance runs the two protected feature
tests from the repository root with Docker.

## Feature tests (protected, controller-written)

- `tests/contract/cli-tracking.feature.test.ts`: C1-C5 through the real `pgm`
  entrypoint (D12).
- `tests/contract/cli-scan.feature.test.ts`: C6 with fake Claude and pi
  session directories.
