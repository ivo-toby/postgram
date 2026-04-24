# Ignore Files for Sync Command

**Date:** 2026-04-24  
**Status:** Approved

## Problem

The `pgm sync` command walks a directory tree and indexes all `.md` files. There is no way for users to exclude specific directories from indexing without modifying hardcoded configuration.

## Solution

Support two presence-based ignore markers. If either file exists in a directory, `pgm sync` skips that directory and its entire subtree.

- `.pgmignore` — explicit opt-out marker for postgram
- `.noindex` — generic no-index convention (used by some tools)

No pattern matching. Presence of the file is the signal.

## Behavior

- Checked at every directory level, including the root sync directory.
- Either marker is sufficient — both are equivalent.
- Skipping is total: no files from that directory or any subdirectory are included in the manifest.
- Sibling directories are unaffected.

## Implementation

Single change: `cli/src/pgm.ts`, inside the `walk()` function.

At the top of `walk()`, before reading directory entries, check for the presence of `.pgmignore` or `.noindex` in `dirPath`. If found, return immediately.

```ts
async function walk(dirPath: string, prefix: string): Promise<void> {
  for (const marker of ['.pgmignore', '.noindex']) {
    try {
      await fsAccess(path.join(dirPath, marker));
      return; // directory is marked as ignored
    } catch {
      // marker not present, continue
    }
  }
  // existing logic unchanged
}
```

No new dependencies. Uses the existing `fs/promises` import (`access`).

## Tests

Four cases:

1. Directory containing `.pgmignore` — no files from it are included.
2. Directory containing `.noindex` — no files from it are included.
3. Nested: parent has a marker, child directory is also skipped.
4. Sibling: one directory has a marker, its sibling is still indexed normally.

## Files Changed

- `cli/src/pgm.ts` — `walk()` function, ~5 lines added
- `cli/src/pgm.test.ts` (or equivalent) — 4 new test cases
