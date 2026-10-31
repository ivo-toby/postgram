// Slice check for change 004-report-core: a TinySDD slice may declare only one
// check, so this runs the slice's Vitest files and ESLint over its TypeScript
// files in one command. Exit code is non-zero when either fails.
import { spawnSync } from 'node:child_process';

const files = process.argv.slice(2);
const tests = files.filter((file) => file.endsWith('.test.ts'));
const lintable = files.filter((file) => /\.(?:ts|mjs|js)$/u.test(file));

function run(label, args) {
  console.log(`\n== ${label}: node ${args.join(' ')}`);
  return spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1;
}

const testStatus = tests.length > 0
  ? run('vitest', ['node_modules/vitest/vitest.mjs', 'run', ...tests])
  : 0;
const lintStatus = lintable.length > 0
  ? run('eslint', ['node_modules/eslint/bin/eslint.js', '--max-warnings=0', ...lintable])
  : 0;

process.exit(testStatus === 0 && lintStatus === 0 ? 0 : 1);
