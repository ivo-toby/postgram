# Slice brief: cli-t2

Status: draft

## Outcome and boundaries

Create `cli/src/tracking/resume.ts` exporting exactly:

```ts
// cli/src/tracking/resume.ts
import type { ResumeTemplates } from './config.js';
import type { WorkspaceView } from './types.js';
export function resumeDirectory(workspace: WorkspaceView): string;
export function isTranscriptGone(workspace: WorkspaceView, localAlias: string, exists: (file: string) => boolean): boolean;
export function renderResume(workspace: WorkspaceView, input: { localAlias: string; templates: ResumeTemplates; transcriptGone: boolean }): string;
export function formatAge(fromIso: string, now: Date): string;
```

Rules (contracts/cli.md "Resume rendering"):

1. `resumeDirectory`: `resume_session.cwd` when it equals `path` or starts with `path + '/'`; otherwise `path`.
2. `isTranscriptGone`: true only when `workspace.machine === localAlias`, `resume_session` is not null, its `agent_kind` is `'claude-code'`, its `transcript_path` is not null and `exists(transcript_path)` is false.
3. `renderResume`: kind for without_id = `resume_session?.agent_kind ?? sessions[0]?.agent_kind ?? 'claude-code'`. Template = `templates[resume_session.agent_kind].with_id` with every `{session_id}` replaced by `shq(agent_session_id)`, when resume_session is not null, that with_id is not null and transcriptGone is false; otherwise `templates[kind].without_id`. `local = 'cd ' + shq(resumeDirectory(w)) + (tpl ? ' && ' + tpl : '')`. Return `local` when `workspace.machine === localAlias`, else `'ssh -t ' + connect_target + ' ' + shq(local)`.
4. `formatAge`: elapsed = now − Date.parse(fromIso), negative counts as 0. Under 1 hour: `<floor minutes>m`; under 48 hours: `<floor hours>h`; otherwise `<floor days>d`.

Write the slice test `cli/tests/unit/tracking-resume.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/cli.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| Local claude-code session id 8f3c, path /w/a | cd '/w/a' && claude --resume '8f3c' | resume-render | cli-t2 |
| Remote codebox, path /home/ivo/wt/a b, id x'y | the exact contract string | resume-render | cli-t2 |
| Local talon session; no sessions at all; cwd under path; cwd outside path | cd only; claude default; cd into cwd; cd into path | resume-render | cli-t2 |
| Transcript gone locally; same workspace on another machine; non-claude kind; null transcript_path | true then without_id; false otherwise | resume-transcript | cli-t2 |
| formatAge at 59 minutes, 3 hours, 47 hours, 48 hours, 12 days and a future time | 59m, 3h, 47h, 2d, 12d, 0m | age-format | cli-t2 |

The check `cli-t2` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/resume.ts cli/tests/unit/tracking-resume.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

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
      "id": "cli-t2-tests",
      "requirementIds": [
        "resume-render",
        "resume-transcript",
        "age-format"
      ],
      "question": "Do the tests pin every row of the contract resume table, the directory rule, the without_id fallback order, transcript-gone limited to local claude-code sessions, and the age boundaries?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/cli.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-resume.test.ts"
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
    "id": "resume-render",
    "text": "The resume command cds into resume_session.cwd when it equals or lies under the workspace path, else the path; uses with_id with the shell-quoted session id when available, else without_id of the session agent kind, else only cd; and wraps the command in ssh -t <connect_target> with shell quoting for a workspace on another machine."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "resume-transcript",
    "text": "A transcript is gone only for a workspace on the local machine whose resume session is claude-code with a non-null transcript_path that does not exist; then the resume falls back to without_id."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "age-format",
    "text": "Ages render as whole minutes under one hour, whole hours under 48 hours and whole days otherwise, for example 3h or 12d."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
