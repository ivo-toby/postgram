# Durable Memory Grooming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only durable-memory groomer that previews and marks durable memories needing follow-up without rewriting or archiving them.

**Architecture:** Extend the existing `memory-grooming-service.ts` with durable-memory candidate selection, LLM classification, and metadata marking. Add `pgm-admin memory groom-durable` as the only operator surface for this first slice, leaving session-context grooming untouched.

**Tech Stack:** TypeScript 5.9, Node.js 22+, PostgreSQL JSONB queries, Vitest integration tests, existing admin CLI helpers.

---

### Task 1: Durable Grooming Service Tests

**Files:**
- Modify: `tests/integration/memory-grooming-service.test.ts`

- [ ] **Step 1: Add failing preview selection tests**

Add imports for `groomDurableMemory`, `previewDurableMemoryGrooming`, and `buildDurableMemoryGroomingPrompt`.

Add tests that seed active durable memories, missing-role memories, session-context memories, documents, archived memories, and already-reviewed memories. Assert preview returns only active durable candidates by default, includes missing-role memories, excludes reviewed rows by default, and includes reviewed rows with `includeReviewed: true`.

- [ ] **Step 2: Run preview tests and verify RED**

Run:

```bash
npm test -- tests/integration/memory-grooming-service.test.ts -t "durable"
```

Expected: fails because durable grooming exports do not exist.

- [ ] **Step 3: Add failing mark-mode tests**

Add tests for:

- `groomDurableMemory(... mode: 'mark', dryRun: false, confirm: false ...)` returns validation error.
- mark mode writes `metadata.durable_grooming` but preserves `status`, `content`, and `type`.
- malformed LLM JSON produces `needs_grooming` with a parse-error reason.

- [ ] **Step 4: Run mark tests and verify RED**

Run:

```bash
npm test -- tests/integration/memory-grooming-service.test.ts -t "durable"
```

Expected: fails because durable grooming implementation does not exist.

### Task 2: Durable Grooming Service Implementation

**Files:**
- Modify: `src/services/memory-grooming-service.ts`

- [ ] **Step 1: Add durable types and schema**

Add:

```ts
export type DurableGroomingOutcome =
  | 'keep'
  | 'needs_grooming'
  | 'archive'
  | 'superseded';

type DurableGroomingDecision = {
  outcome: DurableGroomingOutcome;
  reason: string;
  suggestedAction?: string | undefined;
  suggestedContent?: string | undefined;
  suggestedTags?: string[] | undefined;
};
```

Add a JSON schema requiring `outcome` and `reason`, with optional suggestion fields.

- [ ] **Step 2: Implement durable candidate selection**

Create `buildDurableCandidateQuery` that selects:

- `type = 'memory'`
- active rows
- `COALESCE(metadata->>'memory_role', 'durable_memory') = 'durable_memory'`
- excludes rows with `metadata #>> '{durable_grooming,reviewed_at}'` unless `includeReviewed` is true
- supports age, topic, tags, visibility, and limit filters

- [ ] **Step 3: Implement durable prompt and decision parsing**

Add `buildDurableMemoryGroomingPrompt(candidate)` and parse helpers. Malformed JSON must produce:

```ts
{
  outcome: 'needs_grooming',
  reason: `Invalid durable grooming decision: ${message}`,
  suggestedAction: 'inspect'
}
```

- [ ] **Step 4: Implement preview and mark service functions**

Add `previewDurableMemoryGrooming(pool, input)` and `groomDurableMemory(pool, input)`.

Dry-run returns candidate outcomes without mutation. Mark mode requires `confirm`, calls the LLM, then merges `metadata.durable_grooming` into each row. It must not change `status`, `content`, `visibility`, `owner`, or edges.

- [ ] **Step 5: Run service tests and verify GREEN**

Run:

```bash
npm test -- tests/integration/memory-grooming-service.test.ts -t "durable"
```

Expected: durable tests pass.

### Task 3: Admin CLI Tests

**Files:**
- Modify: `tests/integration/cli-admin.test.ts`
- Modify: `tests/unit/cli-help.test.ts`

- [ ] **Step 1: Add failing CLI integration tests**

Add tests for:

- `pgm-admin --json memory groom-durable --dry-run --older-than 0d` returns `dryRun: true`, `mode: "review"`, and eligible candidates.
- `pgm-admin --json memory groom-durable --mode mark --yes --older-than 0d` writes `durable_grooming` metadata and audit operation `memory.groom_durable`.
- invalid mode rejects with a validation error.

- [ ] **Step 2: Add failing help test**

Assert admin help output includes `groom-durable`.

- [ ] **Step 3: Run CLI tests and verify RED**

Run:

```bash
npm test -- tests/integration/cli-admin.test.ts -t "groom-durable"
npm test -- tests/unit/cli-help.test.ts
```

Expected: fails because the command is missing.

### Task 4: Admin CLI Implementation

**Files:**
- Modify: `src/cli/admin/pgm-admin.ts`

- [ ] **Step 1: Import durable service functions**

Import `groomDurableMemory`, `previewDurableMemoryGrooming`, and durable input types.

- [ ] **Step 2: Add `memory groom-durable` command**

Add options:

```ts
.option('--older-than <duration>', 'only review memories older than this', '30d')
.option('--mode <mode>', 'review or mark', 'review')
.option('--limit <limit>', 'maximum candidates')
.option('--topic <topic>', 'metadata topic filter')
.option('--tag <tag...>', 'required tag filter')
.option('--visibility <visibility>', 'visibility filter')
.option('--include-reviewed', 'include already reviewed durable memories')
.option('--dry-run', 'preview without mutating')
.option('--yes', 'confirm mutation')
```

Use the existing extraction LLM factory for mark mode. Dry-run may use the LLM when available through the same path; if that is too invasive, dry-run can return candidate rows without LLM classification and mark mode performs classification.

- [ ] **Step 3: Add audit entries**

Dry-run writes `memory.groom_durable.dry_run`. Mark mode writes `memory.groom_durable`.

- [ ] **Step 4: Run CLI tests and verify GREEN**

Run:

```bash
npm test -- tests/integration/cli-admin.test.ts -t "groom-durable"
npm test -- tests/unit/cli-help.test.ts
```

Expected: tests pass.

### Task 5: Documentation and Template Updates

**Files:**
- Modify: `skill/postgram/SKILL.md`
- Modify: `templates/AGENTS.md`
- Modify: `templates/CLAUDE.md`
- Modify: `templates/AGENTS.coding.md`
- Modify: `templates/CLAUDE.coding.md`
- Modify: `README.md`

- [ ] **Step 1: Document the admin-only durable grooming command**

Add a short section showing:

```bash
pgm-admin memory groom-durable --dry-run --older-than 30d
pgm-admin memory groom-durable --mode mark --yes --older-than 30d
```

Clarify that mark mode labels durable memories; it does not rewrite or archive them.

- [ ] **Step 2: Run doc-oriented checks**

Run:

```bash
rg -n "groom-durable|durable_grooming|durable memory grooming" README.md skill templates
git diff --check
```

Expected: command and semantics are documented; diff check passes.

### Task 6: Full Verification

**Files:**
- All changed files

- [ ] **Step 1: Run focused tests**

```bash
npm test -- tests/integration/memory-grooming-service.test.ts tests/integration/cli-admin.test.ts tests/unit/cli-help.test.ts
```

- [ ] **Step 2: Run backend typecheck/build**

```bash
npm run typecheck
npm run build
```

- [ ] **Step 3: Run scoped lint**

```bash
npx eslint src/services/memory-grooming-service.ts src/cli/admin/pgm-admin.ts tests/integration/memory-grooming-service.test.ts tests/integration/cli-admin.test.ts tests/unit/cli-help.test.ts
```

- [ ] **Step 4: Commit implementation**

```bash
git status -sb
git add <changed files>
git commit -m "feat: add durable memory grooming"
```
