# Review: jev-shadow-judge — run 1 (glm worker)

Run: `worker-2026-09-21T11-12-19-932Z-523c1dc4` (launch `055c319b`, ollama/glm-5.3-flash:cloud)

## Verdict: revision

## Observed

- Process exit 0, clean assistant stop, 7 tool calls, ~21s, no edits (`changedPaths: []`, `scopeViolations: []`).
- Worker read `/pi-state/task-prompt.txt`, then searched for the repository at `/`, `/node_modules/...`, `/pi-state/package.json` — all ENOENT. It never probed `/work`, the actual workspace mount/cwd.
- Worker stopped per brief stop conditions and reported blockers instead of writing code. Contract followed; discovery failed.

## Root causes (caller-owned)

1. **Workspace path ambiguity**: the injected task prompt references `/pi-state/task-prompt.txt`; the harness never states the repo is at `/work` (cwd). Worker guidance must name the workspace path.
2. **Missing dependency interface**: `@typesafe-ai/sdk` is not in the disposable workspace (node_modules excluded, not yet in package.json). The brief asked the worker to "verify the installed SDK's API shape" — impossible. The interface must be supplied as reviewed manifest facts.

## Fixes before re-dispatch

1. Worker `instructions` resource: workspace is `/work` (cwd); `/pi-state` holds only task prompt; `node_modules` absent — dependency interfaces come from the manifest.
2. Context manifest: add exact `@typesafe-ai/sdk` 0.6.0 interface facts, verified by caller against `index.d.mts` of the published package (npm pack).
3. Brief: SDK-shape verification moved to caller (done); approval line updated.
4. Profile thinking raised low → medium.

## Unrun checks

All acceptance checks unrun — no implementation was produced.