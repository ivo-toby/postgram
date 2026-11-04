# Slice brief: cli-t6

Status: draft

## Outcome and boundaries

1. Create `cli/integrations/pi/postgram.ts`: a pi extension with no imports (D9). It declares local types `type Ctx = { cwd: string; sessionManager: { getSessionId(): string } }` and `type Pi = { on(event: string, handler: (event: unknown, ctx: Ctx) => unknown): void; exec(command: string, args: string[], options: { timeout: number }): Promise<unknown> }`, the constants `const PGM_NODE: string = '__PGM_NODE__';` and `const PGM_SCRIPT: string = '__PGM_SCRIPT__';`, and `export default function postgram(pi: Pi): void`. A helper builds `[PGM_SCRIPT, 'here', '--agent', 'pi', '--session-id', ctx.sessionManager.getSessionId(), '--event', event, '--cwd', ctx.cwd, '--quiet']`. Handlers (R3): session_start → start and turn_end → activity (at most once per 60 s, module-level timestamp) and agent_settled → stop, all fire-and-forget `void pi.exec(PGM_NODE, args, { timeout: 5000 }).catch(() => {})`; session_shutdown → end, awaited (`await pi.exec(...).catch(() => undefined)`).
2. Add `"integrations/**/*.ts"` to `include` in `cli/tsconfig.json` and `"integrations"` to `files` in `cli/package.json`. Change nothing else there.
3. Create `cli/src/tracking/hooks.ts` exporting:

```ts
import type { Command } from 'commander';
export type ClaudeSettings = Record<string, unknown>;
export const HOOK_EVENTS: readonly ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'];
export function hookCommand(nodePath: string, scriptPath: string): string;       // shq(node) + ' ' + shq(script) + ' here --hook'
export function isPostgramHook(command: string): boolean;                         // command.includes('pgm') && /\bhere --hook\b/.test(command)
export function installHooks(settings: ClaudeSettings, command: string, keepTranscripts: number | null): ClaudeSettings;
export function uninstallHooks(settings: ClaudeSettings): ClaudeSettings;
export function unifiedDiff(before: string, after: string, label: string): string;
export function renderPiExtension(template: string, nodePath: string, scriptPath: string): string;
export function settingsPath(input: { flag?: string; env: NodeJS.ProcessEnv; homeDir: string }): string;
export function piExtensionPath(env: NodeJS.ProcessEnv, homeDir: string): string;
export type HooksDeps = {
  homeDir: string; env: NodeJS.ProcessEnv; nodePath: string; scriptPath: string;
  piTemplatePath: string; confirm: (question: string) => Promise<boolean>; hasCredentials: () => Promise<boolean>;
};
export async function runHooksInstall(options: { settings?: string; yes: boolean; keepTranscripts?: string; pi: boolean }, deps: HooksDeps): Promise<string[]>;
export async function runHooksUninstall(options: { settings?: string; pi: boolean }, deps: HooksDeps): Promise<string[]>;
export function registerHooksCommands(program: Command): void;
```

Rules:

- `installHooks` is pure (deep copy, never mutate the input). For each HOOK_EVENTS entry: remove every hook whose command isPostgramHook from every matcher entry, drop entries whose hooks array became empty, then append `{ hooks: [{ type: 'command', command, timeout: 5 }] }` (no matcher). Other events and keys stay. When `keepTranscripts` is a number and `cleanupPeriodDays` is not a number ≥ it, set `cleanupPeriodDays = keepTranscripts`.
- `uninstallHooks`: remove postgram hooks and drop emptied entries in every event; keep the event key even when its array becomes empty.
- `unifiedDiff`: a header `--- <label>` / `+++ <label>`, then every line of before not in after prefixed `-`, every line of after not in before prefixed `+`, by a simple LCS line diff; '' when equal.
- `renderPiExtension` replaces `'__PGM_NODE__'` and `'__PGM_SCRIPT__'` (including the quotes) with `JSON.stringify(nodePath)` and `JSON.stringify(scriptPath)`.
- `settingsPath`: flag, else `$CLAUDE_CONFIG_DIR/settings.json`, else `<home>/.claude/settings.json`. `piExtensionPath`: `${PI_CODING_AGENT_DIR ?? <home>/.pi/agent}/extensions/postgram.ts`.
- `runHooksInstall`: `--keep-transcripts` must be a positive integer, else UsageError. With `pi`: write `renderPiExtension(readFile(piTemplatePath))` to piExtensionPath (create directories, overwrite) and return `['installed pi extension <path>']`; Claude settings are not read or written. Otherwise read the settings (missing: `{}`; invalid JSON: UsageError), keep = keepTranscripts flag as number, else (yes ? null : 365); next = installHooks(settings, hookCommand(nodePath, scriptPath), keep); print unifiedDiff of the pretty JSON to stderr; unless yes, `confirm('Write <path>?')` false → throw UsageError('aborted'). Write pretty JSON with a final newline (create the directory). When hasCredentials() is false, warn on stderr that hooks may not inherit PGM_API_*. Return `['installed hooks in <path>']`.
- `runHooksUninstall`: with pi remove the extension file (no error when absent); else rewrite the settings with uninstallHooks (missing file: nothing to do). Return one line.
- `registerHooksCommands` adds `hooks install` and `hooks uninstall` with the flags of contracts/cli.md. Real deps: nodePath `process.execPath`, scriptPath `realpathSync(process.argv[1])`, piTemplatePath `fileURLToPath(new URL('../../integrations/pi/postgram.ts', import.meta.url))`, confirm via readline on stderr (y or yes), hasCredentials reads ~/.pgmrc for non-empty api_url and api_key.

Write the slice test `cli/tests/unit/tracking-hooks.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/cli.md`, `specs/004-workspace-session-tracking/research.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| installHooks on empty settings, on settings with another Stop hook and an old postgram entry, twice in a row | four entries with timeout 5; other hook kept; no duplicate | hooks-install | cli-t6 |
| installHooks retention: null, 365 with 500 stored, 900 with 500 stored, 365 with none | unchanged; 500; 900; 365 | hooks-retention | cli-t6 |
| uninstallHooks | only postgram entries removed | hooks-uninstall | cli-t6 |
| runHooksInstall with yes in a temp home; without yes and confirm false; without credentials | file written; UsageError aborted and nothing written; warning | hooks-install | cli-t6 |
| runHooksInstall pi and runHooksUninstall pi with the real template | placeholders replaced, Claude settings untouched; file removed | hooks-pi | cli-t6 |
| hookCommand and isPostgramHook on quoted paths | exact command; true only for pgm here --hook | hooks-install | cli-t6 |

The check `cli-t6` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/hooks.ts cli/integrations/pi/postgram.ts cli/tests/unit/tracking-hooks.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

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
      "id": "cli-t6-tests",
      "requirementIds": [
        "hooks-install",
        "hooks-retention",
        "hooks-pi",
        "hooks-uninstall"
      ],
      "question": "Do the tests cover idempotent install with foreign hooks kept, every retention case, uninstall, the confirm and credentials paths, the pi install with placeholder replacement and its removal, and the exact hook command?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/cli.md",
        "specs/004-workspace-session-tracking/research.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-hooks.test.ts"
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
    "id": "hooks-install",
    "text": "pgm hooks install writes one command hook with timeout 5 and no matcher per SessionStart, UserPromptSubmit, Stop and SessionEnd using the absolute node and script paths, replaces an existing postgram here --hook entry instead of duplicating it, keeps other hooks, shows a diff and asks unless --yes, and warns when ~/.pgmrc lacks credentials."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "hooks-retention",
    "text": "cleanupPeriodDays is set to --keep-transcripts, or proposed as 365 interactively without the flag, never lowered, and left unchanged by --yes without --keep-transcripts."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "hooks-pi",
    "text": "pgm hooks install --pi copies the CLI package pi extension to the pi extensions directory with the node and script placeholders replaced, leaves Claude settings untouched, and uninstall --pi removes that file."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "hooks-uninstall",
    "text": "pgm hooks uninstall removes only the postgram here --hook entries."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
