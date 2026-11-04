# Slice brief: cli-t3

Status: draft

## Outcome and boundaries

1. In `cli/src/client.ts`: export the existing `request` function and its `RequestOptions` and `RestClientOptions` types, and add `signal?: AbortSignal | undefined` to `RequestOptions`, passed to `fetch` in `init.signal` when defined. Change nothing else in that file; every existing caller keeps working.
2. Create `cli/src/tracking/api.ts` exporting exactly:

```ts
// cli/src/tracking/api.ts
import type { Command } from 'commander';
import { createPgmClient } from '../client.js';
import type { TrackingConfig } from './config.js';
import type { FeatureStage, LookupResponse, MachineView, ReportBody, ReportResponse, WhereResponse, WorkspaceView } from './types.js';
import type { StoredEntityResponse } from '../client.js';
export type TrackingClient = {
  report(body: ReportBody, options?: { timeoutMs?: number }): Promise<ReportResponse>;          // POST /api/workspaces/report
  patchWorkspace(id: string, body: { feature_id?: string | null; missing?: boolean }): Promise<{ workspace: WorkspaceView }>; // PATCH /api/workspaces/:id
  putMachine(alias: string, connectTarget: string | null): Promise<{ machine: MachineView }>;    // PUT /api/machines/:alias {connect_target}
  listMachines(): Promise<{ machines: MachineView[] }>;                                         // GET /api/machines
  putRepository(remote: string, releaseOnMerge: boolean): Promise<{ repository: { remote: string; release_on_merge: boolean } }>; // PUT /api/repositories
  createFeature(input: { content: string; tags?: string[]; visibility?: string }): Promise<StoredEntityResponse>; // POST /api/features
  setStage(id: string, stage: FeatureStage): Promise<StoredEntityResponse & { previous_stage: string | null }>; // POST /api/features/:id/stage
  addPullRequest(id: string, input: { url: string; state?: 'open' | 'merged' | 'closed' }): Promise<StoredEntityResponse & { stage_changed: boolean; from: string; to: string }>; // POST /api/features/:id/pull-requests
  lookup(machine: string, path: string): Promise<LookupResponse>;                               // GET /api/workspaces/lookup?machine=&path=
  listWorkspaces(query: { machine?: string; repo?: string; featureId?: string; unassigned?: boolean; includeEnded?: boolean }): Promise<{ workspaces: WorkspaceView[] }>; // GET /api/workspaces (feature_id, unassigned=true, include_ended=true)
  where(query: { view?: 'stage' | 'actions'; machine?: string; repo?: string; includeReleased?: boolean; includeDone?: boolean; includeEnded?: boolean }): Promise<WhereResponse>; // GET /api/where (include_released/include_done/include_ended=true)
};
export function createTrackingClient(options: { apiUrl: string; apiKey: string }): TrackingClient;
export type TrackingContext = {
  json: boolean;
  config: TrackingConfig;
  client: TrackingClient;
  pgm: ReturnType<typeof createPgmClient>;
  homeDir: string;
};
// Runs a command body: loads TrackingConfig and the credentials (resolvePgmConfig), builds both clients,
// awaits the handler and prints its result (undefined: nothing; string[]: printHuman, or printJson in json mode;
// anything else: printJson). UsageError: message to stderr, process.exitCode = 2. Any other error: handleCliFailure(error, json).
export async function runTrackingCommand(command: Command, handler: (context: TrackingContext) => Promise<unknown>): Promise<void>;
```

Rules: path segments (ids, aliases) go through encodeURIComponent; query values through URLSearchParams, adding only defined values, booleans only when true (as `'true'`). `report` with `timeoutMs` passes `AbortSignal.timeout(timeoutMs)`. Error mapping comes from `request` unchanged. `runTrackingCommand` reads the json flag with `isJsonMode(command)`, then `loadTrackingConfig()`, then `resolvePgmConfig()`; homeDir is `os.homedir()`.

Write the slice test `cli/tests/unit/tracking-api.test.ts` (direct imports are fine). Stub fetch with vi.stubGlobal and assert method, URL, Authorization header and JSON body per method; test the error mapping once and runTrackingCommand with a handler that throws UsageError (exitCode 2, message on stderr) and one that returns string[] (printed lines). For runTrackingCommand point HOME at a temporary directory holding a .pgmrc with api_url and api_key (mode 600) and clear PGM_API_URL and PGM_API_KEY. You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `changes/004-cli-hooks/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| Each client method against a stubbed fetch | documented method, path, query and body; bearer header | api-client | cli-t3 |
| A 404 error envelope | AppError with code NOT_FOUND and the message | api-client | cli-t3 |
| report with timeoutMs | fetch receives an AbortSignal | api-client | cli-t3 |
| runTrackingCommand: UsageError; string[] result; other error in json mode | exitCode 2 and stderr; printed lines; JSON envelope with exitCode 1 | usage-exit | cli-t3 |

The check `cli-t3` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/api.ts cli/src/client.ts cli/tests/unit/tracking-api.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

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
      "id": "cli-t3-tests",
      "requirementIds": [
        "api-client",
        "usage-exit"
      ],
      "question": "Do the tests check every client method (method, path, query, body, auth), the error mapping, the timeout signal, and runTrackingCommand for UsageError, line output and runtime errors?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "changes/004-cli-hooks/proposal.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-api.test.ts"
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
    "id": "api-client",
    "text": "The tracking client calls report, PATCH workspace, PUT machine, GET machines, PUT repositories, POST features, stage and pull-requests, GET lookup, GET workspaces and GET where with the existing bearer auth and error mapping, and supports a per-call timeout."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "usage-exit",
    "text": "Usage errors and commander parse errors of the new commands exit 2 with a message on stderr; runtime errors exit 1 through the existing failure handler and its JSON envelope in --json mode."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
