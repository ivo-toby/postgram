# Slice brief: cli-t5

Status: draft

## Outcome and boundaries

Create `cli/src/tracking/here.ts` exporting:

```ts
import type { Command } from 'commander';
import type { TrackingClient } from './api.js';
import type { TrackingConfig } from './config.js';
import type { LocalWorkspace } from './local.js';
import type { AgentKind, ReportBody, SessionEvent } from './types.js';

export type HookInput =
  | { kind: 'report'; event: SessionEvent; sessionId: string | null; cwd?: string; transcriptPath?: string | null; reason?: string; hookEvent: string }
  | { kind: 'ignore' }       // a hook_event_name outside the four
  | { kind: 'invalid' };     // empty, not JSON, not an object, or no hook_event_name string
export function parseHookInput(raw: string): HookInput;
export type HereOptions = {
  hook: boolean; quiet: boolean; agent?: string; sessionId?: string; event?: string;
  reason?: string; cwd?: string; transcript?: string;
};
export type HereDeps = {
  config: TrackingConfig | null;          // null: config could not be loaded
  client: TrackingClient | null;          // null: credentials missing
  stdin: () => Promise<string>;
  cwd: string;                            // process.cwd()
  hostname: string;
  homeDir: string;
  now: () => number;                      // Date.now
  bootId: () => Promise<string | null>;
  resolveWorkspace: (cwd: string, budgetMs: number) => Promise<LocalWorkspace>;
  readMarker: (worktree: string) => Promise<string | null>;
  log: (line: string) => Promise<void>;   // appends one failure line
};
export async function runHere(options: HereOptions, deps: HereDeps): Promise<{ stdout: string; exitCode: 0 | 2 }>;
export async function appendHereLog(homeDir: string, message: string, now?: Date): Promise<void>;
export function registerHereCommand(program: Command): void;
```

Rules:

1. `parseHookInput`: SessionStart → start, UserPromptSubmit → activity, Stop → stop, SessionEnd → end. `session_id` (string) → sessionId (else null), `cwd` (string) → cwd, `transcript_path` (string or null) → transcriptPath, `source` (SessionStart) or `reason` (SessionEnd) string → reason.
2. `runHere` with `hook: true`: read stdin. invalid → log `invalid hook input`, return stdout ''. ignore → return ''. Stdin values override flags; agent defaults to claude-code; cwd = stdin cwd ?? options.cwd ?? deps.cwd.
3. Without `hook`: validate flags first and return exitCode 2 (message on stderr, nothing sent) when `--agent` is not an AgentKind or `--event` not a SessionEvent. No sessionId and no event → workspace-only report (no session). Otherwise a session with event default activity, agent default claude-code.
4. Missing config or client → log and return stdout ''.
5. Budget: `start = deps.now()`. `resolveWorkspace(cwd, 800)`; timeout → log `git timeout` and return ''. Marker: `readMarker(workspace.path)`; when it returns an id send `feature_id`. Body: `{ source: 'hook', machine: { alias, hostname, boot_id }, workspace, feature_id?, session? }` with session `{ agent_kind, agent_session_id: sessionId ?? null, event, reason?, cwd: realpath-free cwd value or null, transcript_path: transcriptPath ?? options.transcript ?? null }`. The HTTP timeout is `Math.max(100, config.hereTimeoutMs - (deps.now() - start) - 100)`.
6. Any thrown error from the client → log its message and return ''. exitCode is always 0 except rule 3.
7. Output with hook: '' except when the event is start, the hook event was SessionStart, quiet is false and the response feature is not null: exactly `Postgram: this worktree belongs to feature <first 8 of id> "<title>" (stage: <stage ?? 'building'>).\n`. Without hook: `registered <alias>:<workspace.path> → feature <8-hex> (<stage ?? 'building'>)\n` when linked, else `registered <alias>:<path> (unassigned)\n`; '' after a failure.
8. `appendHereLog`: file `<homeDir>/.pgm/here.log` (create the directory). When it exists with size ≥ 1 048 576 bytes, rename it to `here.log.1` first. Append `<ISO time> <message>\n` (message with newlines replaced by spaces).
9. `registerHereCommand` adds `here` with the options of contracts/cli.md (`--agent`, `--session-id`, `--event`, `--reason`, `--cwd`, `--transcript`, `--hook`, `--quiet`) and usageExit. Its action must not use runTrackingCommand (a failure must not exit 1): it loads the config with loadTrackingConfig, the credentials with resolvePgmConfig inside try/catch (failure → client null), reads stdin with readStdinText from ../shared.js, writes the returned stdout with process.stdout.write and sets process.exitCode to the returned code.

Write the slice test `cli/tests/unit/tracking-here.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/cli.md`, `specs/004-workspace-session-tracking/research.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| parseHookInput for the four events, PreToolUse, "", "not json" and an array | mapped inputs; ignore; invalid | here-hook | cli-t5 |
| Hook SessionStart with stdin cwd and a marker; linked response; quiet | session body with marker feature_id and stdin cwd; the feature line; empty with quiet | here-hook, here-output | cli-t5 |
| Flags: none; --session-id only; --event bogus; --agent bogus | workspace-only; activity claude-code session; exit 2 with nothing sent | here-flags | cli-t5 |
| Git timeout; client throws; client null | nothing sent or empty output, a log line, exit 0 | here-output | cli-t5 |
| Human output linked and unassigned; HTTP timeout from config and elapsed | exact lines; timeoutMs value | here-output | cli-t5 |
| appendHereLog on a fresh home and on a 1 MB file | one line; rotated to here.log.1 then one line | here-log | cli-t5 |

The check `cli-t5` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/here.ts cli/tests/unit/tracking-here.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

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
      "id": "cli-t5-tests",
      "requirementIds": [
        "here-hook",
        "here-flags",
        "here-output",
        "here-log"
      ],
      "question": "Do the tests cover the hook mapping and invalid input, stdin overriding flags, the marker feature id, both output forms including quiet, flag validation with exit 2, every failure path with exit 0 and a log line, the HTTP timeout and log rotation?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/cli.md",
        "specs/004-workspace-session-tracking/research.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-here.test.ts"
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
    "id": "here-hook",
    "text": "pgm here --hook reads the Claude Code hook JSON from stdin, maps SessionStart, UserPromptSubmit, Stop and SessionEnd to start, activity, stop and end with session_id, cwd, transcript_path and source or reason, ignores other events and invalid or empty stdin with exit 0 and no report, and sends the marker feature_id."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "here-flags",
    "text": "Without --hook, pgm here sends a workspace-only report when neither --session-id nor --event is given, otherwise a session with event default activity and agent default claude-code; bad flag values exit 2."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "here-output",
    "text": "In hook mode stdout is empty except one line naming the linked feature on SessionStart unless --quiet; without --hook it prints registered <alias>:<path> followed by the feature short id and stage or (unassigned); every failure is logged and the command exits 0."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "here-log",
    "text": "Failures of pgm here are appended as one line to ~/.pgm/here.log, which is rotated to here.log.1 at 1 MB."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
