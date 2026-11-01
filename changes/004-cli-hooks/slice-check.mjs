// Slice check for change 004-cli-hooks: Vitest on the slice test (run from
// cli/, which has its own vitest config), ESLint on the listed files and tsc
// for the CLI project. The CLI tests need no Docker.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const files = process.argv.slice(2);
const tests = files
  .filter((file) => file.endsWith('.test.ts') && file.startsWith('cli/'))
  .map((file) => file.slice('cli/'.length));
const lintable = files.filter((file) => /\.(?:ts|mjs|js)$/u.test(file));

function run(label, args) {
  process.stdout.write(`\n== ${label}: node ${args.join(' ')}\n`);
  return spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1;
}

const testStatus = tests.length > 0
  ? run('vitest', ['node_modules/vitest/vitest.mjs', 'run', '--root', 'cli', ...tests])
  : 0;
const lintStatus = lintable.length > 0
  ? run('eslint', ['node_modules/eslint/bin/eslint.js', '--max-warnings=0', ...lintable])
  : 0;
const tscStatus = run('tsc', ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'cli/tsconfig.json']);

process.exit(testStatus === 0 && lintStatus === 0 && tscStatus === 0 ? 0 : 1);
