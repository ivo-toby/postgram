import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The PDF loader package is resolved the way production resolves it: through
 * `node_modules/@ivotoby/postgram-loader-pdf`, whose `main` is the built
 * output. A fresh checkout has no `dist`, so build it here when it is missing
 * or older than its sources. A current build costs a few stat calls.
 */
const pkgDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../packages/loader-pdf'
);

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs
    );
  }
  return newest;
}

function builtAt(): number {
  try {
    return statSync(path.join(pkgDir, 'dist/index.js')).mtimeMs;
  } catch {
    return 0;
  }
}

export default function setup(): void {
  const sources = Math.max(
    newestMtime(path.join(pkgDir, 'src')),
    statSync(path.join(pkgDir, 'tsconfig.build.json')).mtimeMs,
    statSync(path.join(pkgDir, 'tsconfig.json')).mtimeMs
  );
  if (builtAt() >= sources) return;
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  execFileSync(
    process.execPath,
    [tsc, '-p', path.join(pkgDir, 'tsconfig.build.json')],
    { cwd: pkgDir, stdio: 'inherit' }
  );
}
