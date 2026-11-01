# Review: cli-t6 (run worker-2026-11-01T17-48-54-782Z-85bf7018)

Verdict: accepted (controller review, delegated by Ivo).

- Fresh copy plus candidate: slice check exit 0 (18 tests, ESLint clean, cli tsc clean including integrations/**).
- hooks.ts: idempotent install keeping foreign hooks, retention never lowered and unchanged by --yes without the flag, confirm and credentials warning, pi install with placeholder replacement, uninstall. The command uses its own runner instead of runTrackingCommand, so it works without credentials (the contract only warns).
- integrations/pi/postgram.ts follows R3 (fire-and-forget start/activity throttled/stop, awaited end) with no pi imports; tsconfig include and package files updated.
