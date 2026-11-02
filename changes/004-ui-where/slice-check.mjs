// Slice check for change 004-ui-where: Vitest on the slice test, ESLint on the
// listed .ts files and tsc for the UI project. No Docker and no database.
// Vitest and tsc are the UI package's own binaries: jsdom, the React plugin
// and @testing-library live in ui/node_modules, and the root Vitest cannot
// resolve them.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const files = process.argv.slice(2);
const tests = files
  .filter((file) => /\.test\.tsx?$/u.test(file) && file.startsWith('ui/'))
  .map((file) => file.slice('ui/'.length));
// ESLint's typed config covers **/*.ts; .tsx files are not linted in this repo.
const lintable = files.filter((file) => /\.(?:ts|mjs|js)$/u.test(file));

function run(label, args) {
  process.stdout.write(`\n== ${label}: node ${args.join(' ')}\n`);
  return spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1;
}

const testStatus = tests.length > 0
  ? run('vitest', ['ui/node_modules/vitest/vitest.mjs', 'run', '--root', 'ui', ...tests])
  : 0;
const lintStatus = lintable.length > 0
  ? run('eslint', ['node_modules/eslint/bin/eslint.js', '--max-warnings=0', ...lintable])
  : 0;
const tscStatus = run('tsc', ['ui/node_modules/typescript/bin/tsc', '--noEmit', '-p', 'ui/tsconfig.json']);

process.exit(testStatus === 0 && lintStatus === 0 && tscStatus === 0 ? 0 : 1);
