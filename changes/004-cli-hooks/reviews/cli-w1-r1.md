# Review: cli-w1 (run worker-2026-11-01T19-36-07-025Z-664b2ef7)

Verdict: revision.

Controller check: slice check exit 0 (Vitest 3/3, ESLint and tsc clean). The `pgm.ts` wiring is correct and is accepted as is. Do not change `cli/src/pgm.ts` or the test.

The new README section names commands that do not exist. Fix only `cli/README.md`, using the signatures in `specs/004-workspace-session-tracking/contracts/cli.md`:

- `pgm feature add "my feature"   # create a feature (also: list, set, rm)` is wrong. The subcommands are `add "<title>"`, `stage <id> <stage>`, `pr <id> <url> [--state open|merged|closed]`, `link <id> [--path <dir> | --workspace <uuid>]` and `unlink`.
- `pgm machine alias codebox` does not exist. Use `pgm machine set [--alias <alias>] [--connect <target>]` and `pgm machine list`.
- `pgm repo set postgram` is wrong. Use `pgm repo set <remote> --release-on-merge true|false`.
- `pgm hooks install` installs the Claude Code hooks; `--pi` installs the pi extension. Say that instead of "(claude, pi)".
- `pgm worktree new <feature>` takes a UUID, an 8-hex short id or a title, and `--create` creates the feature.
- `pgm scan` needs `--root <dir>` or `scan_roots`; mention `--yes-exact` and `--dry-run`.

Keep the ~/.pgmrc table. Call run_checks once and finish.
