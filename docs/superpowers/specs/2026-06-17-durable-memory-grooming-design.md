# Durable Memory Grooming Design

## Problem

Postgram now treats memory entities as semantic recall by default: both
`session_context` and `durable_memory` are embedded, while graph extraction is
opt-in for memory. Session-context grooming already exists, but durable memory
can still accumulate stale execution details, duplicated decisions, obsolete
status, and mixed "stable outcome plus noisy breadcrumbs" content.

Durable memory needs its own grooming path. It must be visibly distinct from
session-context grooming because durable memory is already authoritative enough
for future agents to trust. The first durable-memory groomer should therefore
observe and label memory quality before it rewrites or archives durable truth.

## Goals

- Add an operator-run durable-memory grooming workflow.
- Review active durable memories and classify their grooming state.
- Mark memories that need follow-up without rewriting, merging, or archiving
  them automatically.
- Preserve still-true durable decisions and stable outcomes.
- Distinguish "durable but needs grooming" from "durable and retained."
- Keep session-context grooming behavior unchanged.

## Non-Goals

- No automatic durable-memory rewrite in this first slice.
- No automatic durable-memory archive in this first slice.
- No UI workflow in this first slice.
- No MCP self-grooming tool for durable memory in this first slice.
- No graph/entity/KB extraction from memory summaries.

## Approach

Add an admin-only durable grooming workflow alongside existing session-context
grooming:

```bash
pgm-admin memory groom-durable --dry-run
pgm-admin memory groom-durable --mode mark --yes
```

The workflow selects active `type='memory'` entities whose
`metadata.memory_role` is missing or `durable_memory`. Missing `memory_role`
continues to mean durable memory for backwards compatibility.

Dry-run previews eligible durable memories and, when an LLM is available,
classifies each candidate. Mark mode persists the classification into metadata
without changing `status`, `content`, `tags`, `visibility`, owner, or edges.

## Classification Model

The durable groomer returns one of these outcomes for each candidate:

- `keep`: durable memory remains useful as-is.
- `needs_grooming`: memory is still valuable but contains stale execution
  detail, duplicated wording, mixed concerns, or should be distilled later.
- `archive`: memory appears obsolete or fully superseded, but this first slice
  only marks that recommendation.
- `superseded`: memory appears replaced by newer durable memory, but this first
  slice only marks that recommendation.

All classifications include a concise reason. Classifications may include
suggested replacement content or suggested tags, but the first slice stores
those as suggestions only.

## Metadata

Mark mode writes a `durable_grooming` object into entity metadata:

```json
{
  "durable_grooming": {
    "status": "needs_grooming",
    "reason": "Contains a stable outcome mixed with stale PR-monitor details.",
    "reviewed_at": "2026-06-17T00:00:00.000Z",
    "reviewed_by": "pgm-admin memory groom-durable",
    "suggested_action": "distill",
    "suggested_content": "Optional LLM suggestion",
    "suggested_tags": ["optional", "tags"]
  }
}
```

Dry-run does not mutate rows. Mark mode requires `--yes`.

## Candidate Selection

Candidates must satisfy:

- `type = 'memory'`
- `status IS DISTINCT FROM 'archived'`
- `COALESCE(metadata->>'memory_role', 'durable_memory') = 'durable_memory'`

Filters:

- `--older-than <duration>` defaults to `30d`
- `--limit <n>` optional; omitted means no cap
- `--topic <topic>` filters `metadata.topic`
- `--tag <tag>` may be repeated and maps to `tags @> [...]`
- `--visibility <personal|work|shared>` filters visibility
- `--include-reviewed` includes memories already carrying
  `metadata.durable_grooming.reviewed_at`; by default reviewed memories are
  skipped so repeat runs focus on fresh work.

Ordering is deterministic: `created_at ASC, id ASC`.

## LLM Prompt

The prompt frames durable memory as long-lived project/user knowledge and asks
the LLM to classify whether the memory remains useful as-is, needs grooming, is
obsolete, or appears superseded. The prompt must emphasize:

- Preserve durable decisions, constraints, root causes, and verified outcomes.
- Do not recommend archiving solely because a memory is old.
- Prefer `needs_grooming` when stable truth is mixed with stale execution noise.
- Use `archive` only when the memory no longer appears useful.
- Return strict JSON matching the schema.

Malformed LLM output should not abort the full run. The candidate is marked as
`needs_grooming` with a parse-error reason so an operator can inspect it.

## Service API

Extend `memory-grooming-service.ts` with durable-specific functions:

- `previewDurableMemoryGrooming(pool, input)`
- `groomDurableMemory(pool, input)`
- `buildDurableMemoryGroomingPrompt(candidate)`

Keep session-context functions intact. Shared helper extraction is allowed only
where it reduces real duplication without changing existing behavior.

Result shape:

```ts
type DurableMemoryGroomingResult = {
  reviewed: number;
  marked: number;
  dryRun: boolean;
  outcomes: Array<{
    id: string;
    outcome: 'keep' | 'needs_grooming' | 'archive' | 'superseded';
    reason: string;
    suggestedContent?: string;
    suggestedTags?: string[];
  }>;
};
```

## CLI

Add an admin command:

```bash
pgm-admin memory groom-durable \
  --dry-run \
  --older-than 30d \
  --limit 25 \
  --topic postgram \
  --tag completed-work
```

```bash
pgm-admin memory groom-durable \
  --mode mark \
  --yes \
  --older-than 30d
```

Dry-run prints a compact summary in human mode and full structured data in
`--json` mode. Mark mode writes audit operation
`memory.groom_durable`.

## Error Handling

- Invalid `--limit`, `--older-than`, `--mode`, or `--visibility` returns a
  validation error.
- `--yes` is required for mark mode.
- Mark mode requires an extraction LLM provider because the first
  implementation uses the same LLM configuration as promotion grooming.
- Per-candidate malformed LLM JSON becomes a `needs_grooming` outcome instead
  of aborting the full run.
- Database failures abort the run and return the existing app error shape.

## Testing

Add integration tests for:

- Preview selects only active durable memory and treats missing `memory_role` as
  durable.
- Preview excludes session-context memory, documents, archived durable memory,
  and already-reviewed durable memory by default.
- `--include-reviewed` includes already-reviewed durable memory.
- Filters work for topic, tags, visibility, age, and limit.
- Mark mode requires confirmation.
- Mark mode writes `metadata.durable_grooming` and does not change status or
  content.
- LLM parse failures mark the candidate as `needs_grooming`.
- Admin CLI dry-run and mark mode return expected JSON and audit entries.

## Future Work

Later branches may add:

- UI filtering for `durable_grooming.status`.
- Admin archive mode for rows explicitly marked `archive`.
- Admin rewrite mode for rows explicitly marked `needs_grooming`.
- Duplicate/supersession linking between durable memories.
- Scheduled durable-memory review.
