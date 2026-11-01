# Slice brief: cli-w1

Status: draft

## Outcome and boundaries

1. In `cli/src/pgm.ts`: import the six register functions and call each once with `program` right before `await program.parseAsync(process.argv);`. Change nothing else.
2. In `cli/README.md`: add a short "Workspace tracking" section listing `pgm here`, `pgm hooks install|uninstall`, `pgm where`, `pgm feature …`, `pgm machine …`, `pgm repo set`, `pgm worktree new` and `pgm scan` with one line each, and the new ~/.pgmrc keys (machine, scan_roots, worktree_root, here_timeout_ms, resume).

Write the slice test `cli/tests/unit/tracking-wiring.test.ts` (direct imports are fine). Run the real entrypoint through tsx like pgm-version.test.ts: `--help` lists here, hooks, where, feature, machine, repo, worktree and scan next to the existing store and task; `where --bogus` exits 2; `here --hook` with an empty stdin and HOME pointing at an empty temporary directory exits 0 with empty stdout. You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/cli.md`, `cli/src/pgm.ts`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| pgm --help | lists the eight new commands and the existing ones | cli-wiring | cli-w1 |
| pgm where --bogus | exit 2 | cli-wiring | cli-w1 |
| pgm here --hook with empty stdin and no config | exit 0, empty stdout | cli-wiring | cli-w1 |

The check `cli-w1` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/pgm.ts cli/tests/unit/tracking-wiring.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

## Stop conditions

- Stop and report if a cited excerpt contradicts this brief.
- Stop if the work would need a change to a protected file, a file of an accepted slice, or a deletion.
- Report every file you created or changed.

## Slice test review contract

The JSON block must exactly match slice.json.testReview.

```json
{
  "schemaVersion": 1,
  "workflow": "slice-tests",
  "criteria": [
    {
      "id": "cli-w1-tests",
      "requirementIds": [
        "cli-wiring"
      ],
      "question": "Do the tests prove through the real entrypoint that the eight commands are registered next to the existing ones, that a usage error exits 2, and that a hook call without config exits 0 silently?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/cli.md",
        "cli/src/pgm.ts"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-wiring.test.ts"
      ]
    }
  ]
}
```

## Approved slice requirements

The JSON array must exactly match the requirement records referenced by
slice.json.testReview.

```json
[
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "cli-wiring",
    "text": "The pgm entrypoint registers here, hooks, where, feature, machine, repo, worktree and scan without changing existing commands."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
