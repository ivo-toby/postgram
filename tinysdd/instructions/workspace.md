# Worker workspace notes

- The disposable source workspace is mounted at `/work` and is your shell
  cwd. All project files (`src/`, `tests/`, `package.json`, `.env.example`)
  are under `/work`; edit only there.
- `/pi-state` contains only the task prompt. Do not treat it as the
  repository and do not modify it.
- `node_modules` is not present in the workspace. Dependency interfaces are
  supplied as approved facts in the compiled context manifest; do not guess
  or invent them.
- The brief's acceptance checks (`npm test`, `npx tsc --noEmit`,
  `npm run lint`) cannot run inside the workspace. Make the edits, list the
  exact commands the caller should run, and report the checks as unrun.