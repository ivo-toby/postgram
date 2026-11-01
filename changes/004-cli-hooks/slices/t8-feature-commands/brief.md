# Slice brief: cli-t8

Status: draft

## Outcome and boundaries

Create `cli/src/tracking/feature-commands.ts` exporting:

```ts
import type { Command } from 'commander';
import type { TrackingClient } from './api.js';
import type { TrackingConfig } from './config.js';
import type { LocalWorkspace } from './local.js';
export type FeatureDeps = {
  client: TrackingClient; config: TrackingConfig; json: boolean; cwd: string; hostname: string; homeDir: string;
  bootId: () => Promise<string | null>;
  resolveWorkspace: (cwd: string) => Promise<LocalWorkspace>;
  writeMarker: (worktree: string, featureId: string) => Promise<void>;
  removeMarker: (worktree: string) => Promise<void>;
  exists: (path: string) => boolean;
  warn: (line: string) => void;
};
export async function runFeatureAdd(title: string, options: { tags?: string; visibility?: string }, deps: FeatureDeps): Promise<unknown>;
export async function runFeatureStage(id: string, stage: string, deps: FeatureDeps): Promise<unknown>;
export async function runFeaturePr(id: string, url: string, options: { state?: string }, deps: FeatureDeps): Promise<unknown>;
export async function runFeatureLink(id: string | null, options: { path?: string; workspace?: string }, deps: FeatureDeps): Promise<unknown>; // id null = unlink
export async function runMachineSet(options: { alias?: string; connect?: string }, deps: FeatureDeps & { writeConfig: typeof import('./config.js').writeMachineConfig }): Promise<unknown>;
export async function runMachineList(deps: FeatureDeps): Promise<unknown>;
export async function runRepoSet(remote: string, options: { releaseOnMerge?: string }, deps: FeatureDeps): Promise<unknown>;
export function registerFeatureCommands(program: Command): void; // feature add|stage|pr|link|unlink, machine set|list, repo set
```

Rules (json mode returns the server response; human mode returns string[]):

1. add: `client.createFeature({ content: title, tags?, visibility? })` (tags from a comma list); human output is the full new id as the only line.
2. stage: stage must be one of FEATURE_STAGES, else UsageError. Human: `<8-hex> <previous_stage ?? '-'> → <stage>`.
3. pr: state one of open, merged, closed (default open), else UsageError. Human: `<8-hex> PR <state>, stage <to>`.
4. link/unlink without `--workspace`: `resolveWorkspace(path ?? cwd)` (timeout → AppError INTERNAL 'git timeout'); `lookup(alias, workspace.path)`; when no workspace matches or its path differs from the resolved path, send a workspace-only report `{ source: 'hook', machine, workspace }` and use its workspace. Then `patchWorkspace(id, { feature_id: featureId })` (featureId may be a short id; null unlinks). Then `writeMarker(path, patched.workspace.feature_id)` on link or `removeMarker(path)` on unlink. Human: `linked <path> → <8-hex>` / `unlinked <path>`.
5. With `--workspace <uuid>`: patch it directly; when the returned machine equals config.alias and exists(path), update the marker as above; otherwise touch no marker and warn `warning: <machine> may have a feature marker; its next registration will restore the marker's link`.
6. machine set: `writeConfig({ alias?, connectTarget: connect? })`; when previousAlias is a string different from the new alias, warn that history stays under the old alias. Report `{ source: 'hook', machine: { alias, hostname, boot_id } }` (no workspace), then `putMachine(alias, connectTarget)`. Human: `machine <alias> → <connect_target>`.
7. machine list: human lines `<alias>  <connect_target ?? alias>  <last_seen_at>`.
8. repo set: `--release-on-merge` must be exactly 'true' or 'false', else UsageError. Human: `<remote> release_on_merge=<bool>`.
9. registerFeatureCommands uses usageExit on every command and runTrackingCommand for every action, with real deps (resolveLocalWorkspace, readBootId, writeMarker with new Date(), removeMarker, existsSync, process.stderr warn, writeMachineConfig).

Write the slice test `cli/tests/unit/tracking-feature-commands.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/cli.md`, `specs/004-workspace-session-tracking/contracts/rest.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| add human and json; stage valid and invalid; pr default state and invalid state | id line or body; UsageError on bad values; client calls | feature-commands | cli-t8 |
| link in an unknown workspace; link in a known one; unlink | report then patch then marker; patch then marker; marker removed | feature-link-marker | cli-t8 |
| link --workspace local and existing; remote | marker written; warning and no marker | feature-link-marker | cli-t8 |
| machine set with alias change; machine list | config written, report without workspace, putMachine, warning; lines | machine-commands | cli-t8 |
| repo set true and maybe | putRepository(remote, true); UsageError | repo-command | cli-t8 |

The check `cli-t8` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/feature-commands.ts cli/tests/unit/tracking-feature-commands.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

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
      "id": "cli-t8-tests",
      "requirementIds": [
        "feature-commands",
        "feature-link-marker",
        "machine-commands",
        "repo-command"
      ],
      "question": "Do the tests cover add, stage and pr including value validation, link and unlink locally (report when unknown, patch, marker) and by workspace id (local marker or warning), machine set and list, and repo set validation?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/cli.md",
        "specs/004-workspace-session-tracking/contracts/rest.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-feature-commands.test.ts"
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
    "id": "feature-commands",
    "text": "pgm feature add prints the new id, stage and pr call the feature endpoints with either id form, and pr defaults to state open."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "feature-link-marker",
    "text": "pgm feature link and unlink resolve the local workspace by lookup (reporting it first when unknown), PATCH its feature_id and rewrite or delete the marker; with --workspace they PATCH that workspace and update the marker only when it is local and exists, else warn."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "machine-commands",
    "text": "pgm machine set writes ~/.pgmrc, reports the machine without a workspace and sets its connect target, warning when the alias changes; pgm machine list prints the machines."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "repo-command",
    "text": "pgm repo set <remote> --release-on-merge true|false sets the repository flag; any other value exits 2."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
