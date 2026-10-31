# Slice brief: report-s2

Status: draft

## Outcome and boundaries

Create `src/util/git-remote.ts` exporting `normalizeRemote(remote: string): string`.

It returns `host/owner/repo`: lowercased, without scheme, user, port, trailing `/` or `.git`. It handles scp form (`git@host:owner/repo.git`), `https://`, `http://`, `ssh://` and `git://` URLs, with or without user and port. Nested paths keep all segments (`gitlab.com/group/sub/repo`).

Decision D7: input that does not parse as a host plus a path (for example a local path `/srv/git/repo.git`) is returned trimmed, lowercased and without a trailing `.git` or `/`. The function never throws.

Write the slice test `tests/unit/git-remote.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/workspace-report.feature.test.ts`, `specs/constitution.md`, `specs/constitution.approval.json`, anything under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| the three rest.md vectors | each returns github.com/ivo-toby/postgram | workspace-upsert | report-s2 |
| http(s) URL with user:password@ and port | credentials and port removed | workspace-upsert | report-s2 |
| local path or garbage | fallback form, no throw | workspace-upsert | report-s2 |

The check `report-s2` runs `node changes/004-report-core/slice-check.mjs src/util/git-remote.ts tests/unit/git-remote.test.ts`: Vitest on the slice test and ESLint with zero allowed problems on the listed TypeScript files. It needs Docker for integration tests and is run by the controller on the host; report what you expect it to show.

## Stop conditions

- Stop and report if a cited excerpt contradicts this brief.
- Stop if the work would need a change to a protected file, a deletion or a write to `entities`.
- Report every file you created or changed.

## Slice test review contract

The JSON block must exactly match slice.json.testReview.

```json
{
  "schemaVersion": 1,
  "workflow": "slice-tests",
  "criteria": [
    {
      "id": "report-s2-tests",
      "requirementIds": [
        "workspace-upsert"
      ],
      "question": "Do the tests cover the three contract vectors, every supported URL form, credential and port stripping, and the D7 fallback?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md"
      ],
      "testPaths": [
        "tests/unit/git-remote.test.ts"
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
    "id": "workspace-upsert",
    "text": "A report upserts the workspace by machine and path with a trailing slash stripped; omitted repo keys keep stored values and null clears them; git null clears the snapshot, an omitted git keeps it and an object replaces it; missing_since is cleared; last_activity_at is now for hook reports and the newest observed time for scan reports."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
