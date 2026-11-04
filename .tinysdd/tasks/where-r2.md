# Slice brief: where-r2

Status: draft

## Outcome and boundaries

1. In `src/transport/rest.ts` add `export` to the existing `function toStoredEntity`. Change nothing else in that file.

2. Create `src/transport/feature-routes.ts` exporting exactly:

```ts
export function registerFeatureRoutes(
  app: Hono<{ Variables: { auth: AuthContext } }>,
  pool: Pool
): void;
```

Routes, each reading `const auth = c.get('auth')`, parsing the body with a zod schema (a parse failure throws `new AppError(ErrorCode.VALIDATION, <first issue message>)`, like parseJsonBody in rest.ts; copy that helper), calling the service and throwing `result.error` on failure (the app's error handler maps it):

| Route | Body | Service call | Response |
| --- | --- | --- | --- |
| PUT /api/repositories | `{ remote: string (min 1), release_on_merge: boolean }` | setRepositoryReleaseOnMerge({ remote, releaseOnMerge }) | 200 `{ repository }` |
| POST /api/features | `{ content: string (min 1), tags?: string[], visibility?: 'personal' \| 'work' \| 'shared' }` | createFeature | 201 `{ entity: toStoredEntity(entity) }` |
| POST /api/features/:id/stage | `{ stage: string }` | setFeatureStage({ id: path id, stage }) | 200 `{ entity, previous_stage }` |
| POST /api/features/:id/pull-requests | `{ url: string, state?: string }` | addFeaturePullRequest({ id, url, state }) | 200 `{ entity, stage_changed, from, to }` |

Pass optional fields only when defined (exactOptionalPropertyTypes). Serialize every entity with `toStoredEntity`.

Write the slice test `tests/contract/feature-routes.test.ts` (direct imports are fine). In the slice test build the app yourself: `const app = new Hono<{ Variables: { auth: AuthContext } }>()`, an `app.onError` copied from src/index.ts, `app.use('/api/*', async (c, next) => { c.set('auth', auth); await next(); })`, then `registerFeatureRoutes(app, pool)`, and call `app.request(...)`. You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/where-service.feature.test.ts`, `tests/contract/workspace-api.feature.test.ts`, `tests/contract/workspace-mcp.feature.test.ts`, `changes/004-where-api/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `changes/004-where-api/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| PUT /api/repositories with an scp remote | 200 with the normalized remote and the flag | rest-feature-routes | where-r2 |
| POST /api/features with content, tags, visibility; with empty content | 201 with a task entity in the stored shape, status inbox, feature metadata; 400 VALIDATION | rest-feature-routes, rest-errors | where-r2 |
| POST stage by short id; unknown stage; unknown UUID; ambiguous short id | 200 with entity and previous_stage; 400; 404; 409 with details.candidates | rest-feature-routes, rest-errors | where-r2 |
| POST pull-requests open then merged; a non-GitHub URL | 200 with stage_changed, from, to; 400 | rest-feature-routes, rest-errors | where-r2 |
| Read-only auth on any of these routes | 403 FORBIDDEN in the error envelope | rest-errors | where-r2 |

The check `where-r2` runs `node changes/004-where-api/slice-check.mjs src/transport/feature-routes.ts src/transport/rest.ts tests/contract/feature-routes.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Call run_checks before you finish and fix every ESLint and tsc error it reports. Integration and contract tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "where-r2-tests",
      "requirementIds": [
        "rest-feature-routes",
        "rest-errors"
      ],
      "question": "Do the tests cover every route with its status and body shape, the stored-entity serialization, both feature id forms, and the 400, 403, 404 and 409 envelopes?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "changes/004-where-api/proposal.md"
      ],
      "testPaths": [
        "tests/contract/feature-routes.test.ts"
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
    "id": "rest-feature-routes",
    "text": "PUT /api/repositories, POST /api/features (201), POST /api/features/:id/stage and POST /api/features/:id/pull-requests call the feature services, accept either feature id form in the path and return the rest.md bodies with entities in the existing stored-entity shape."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "rest-errors",
    "text": "Service errors use the existing error envelope and status mapping: VALIDATION 400, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409 with details.candidates; a request without a valid key is 401."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
