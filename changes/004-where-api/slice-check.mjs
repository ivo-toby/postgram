// Slice check for change 004-where-api. A TinySDD slice may declare only
// one check, so this runs Vitest, ESLint and tsc in one command.
//
// The worker sandbox has no network, so Docker-backed integration tests cannot
// run there. They are skipped with a visible notice when Docker is unreachable;
// the controller runs the check on the host with SLICE_CHECK_REQUIRE_DOCKER=1,
// which turns a skip into a failure.
//
// tsc errors inside the protected feature tests are ignored: they import
// functions and options that later slices create.
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import process from 'node:process';
import { setTimeout } from 'node:timers';

const FEATURE_TESTS = [
  'tests/integration/where-service.feature.test.ts',
  'tests/contract/workspace-api.feature.test.ts',
  'tests/contract/workspace-mcp.feature.test.ts'
];
const DOCKER_TEST_DIRS = ['tests/integration/', 'tests/contract/'];
const needsDockerFile = (file) => DOCKER_TEST_DIRS.some((dir) => file.startsWith(dir));
const DOCKER_SOCKET = '/var/run/docker.sock';

const files = process.argv.slice(2);
const tests = files.filter((file) => file.endsWith('.test.ts'));
const lintable = files.filter((file) => /\.(?:ts|mjs|js)$/u.test(file));

function log(line) {
  process.stdout.write(`${line}\n`);
}

function run(label, args, options = {}) {
  log(`\n== ${label}: node ${args.join(' ')}`);
  return spawnSync(process.execPath, args, { stdio: 'inherit', ...options });
}

function dockerReachable() {
  return new Promise((resolve) => {
    const socket = connect(DOCKER_SOCKET);
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    setTimeout(() => done(false), 2000).unref();
  });
}

const needsDocker = tests.some(needsDockerFile);
const docker = needsDocker ? await dockerReachable() : true;
const requireDocker = process.env.SLICE_CHECK_REQUIRE_DOCKER === '1';
let runnable = tests;
let skipped = false;

if (!docker) {
  runnable = tests.filter((file) => !needsDockerFile(file));
  skipped = true;
  log(`\n!! SKIPPED integration tests (Docker unreachable at ${DOCKER_SOCKET}): ${tests.filter((file) => !runnable.includes(file)).join(' ')}`);
  log('!! The controller runs them on the host. Do not treat this skip as a pass of those tests.');
}

const testStatus = runnable.length > 0
  ? run('vitest', ['node_modules/vitest/vitest.mjs', 'run', ...runnable]).status ?? 1
  : 0;
const lintStatus = lintable.length > 0
  ? run('eslint', ['node_modules/eslint/bin/eslint.js', '--max-warnings=0', ...lintable]).status ?? 1
  : 0;

log('\n== tsc: node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json');
const tsc = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json'], { encoding: 'utf8' });
const tscErrors = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`
  .split('\n')
  .filter((line) => /error TS\d+/u.test(line) && !FEATURE_TESTS.some((test) => line.startsWith(test)));
for (const line of tscErrors) {
  log(line);
}
const tscStatus = tscErrors.length === 0 && tsc.error === undefined ? 0 : 1;
log(tscStatus === 0 ? 'tsc: no errors outside the protected feature tests' : `tsc: ${tscErrors.length} error(s)`);

const skipStatus = skipped && requireDocker ? 1 : 0;
process.exit(testStatus === 0 && lintStatus === 0 && tscStatus === 0 && skipStatus === 0 ? 0 : 1);
