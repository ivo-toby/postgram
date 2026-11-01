# Review: cli-t8 (run worker-2026-11-01T18-15-31-457Z-c2500d09)

Verdict: revision.

The slice check passes in a fresh copy (20 tests), but the `feature stage` command is wired wrongly in `registerFeatureCommands` (`cli/src/tracking/feature-commands.ts`):

```ts
).action(async (id: string, stage: string, command: Command) => {
```

Commander 14 calls an action with the declared arguments, then the options object, then the command: `(id, stage, options, command)`. Here `command` receives the options object, so `runTrackingCommand` calls `isJsonMode` on a plain object and `pgm feature stage <id> <stage>` throws.

Required fix:

1. Change that action to `async (id: string, stage: string, _options: unknown, command: Command) =>`. The other actions are correct.
2. Add one test to `cli/tests/unit/tracking-feature-commands.test.ts` that builds `const program = new Command(); program.option('--json'); registerFeatureCommands(program);` and checks that the `feature stage` subcommand's action receives a Command as its last argument. One way: stub `runTrackingCommand` with `vi.mock('../../src/tracking/api.js', ...)`, keeping the real exports via `importActual`, then call `await program.parseAsync(['node', 'pgm', 'feature', 'stage', 'abcd1234', 'review'])` and assert the stub was called with a Command instance. Call run_checks and keep all tests passing.
