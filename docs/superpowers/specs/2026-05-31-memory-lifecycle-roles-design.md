# Postgram Memory Lifecycle Roles - Design Spec

**Date:** 2026-05-31
**Status:** Draft

---

## Overview

Postgram should support two different uses of `memory` entities without adding
a new entity type:

1. **Session context**: short-lived working context used to resume active or
   recent conversations across agents and sessions.
2. **Durable memory**: long-lived knowledge that future agents should treat as
   stable context, such as decisions, preferences, constraints, root causes, and
   completed-work summaries.

The distinction is expressed as metadata on existing `memory` entities. Search
and enrichment become role-aware, so session context can be semantically
retrieved without polluting the knowledge graph.

---

## Problem

Postgram currently acts as durable memory, but some agents also use it as active
working context. These two modes have different quality requirements:

- Session continuity benefits from fast, permissive capture.
- Durable memory needs curation and high signal.
- Graph extraction implies stable semantic relationships and should not run on
  provisional thread context.
- Without cleanup, session-context memories accumulate and become indistinct
  from long-term knowledge.

The goal is to make this boundary explicit while keeping the model simple.

---

## Goals

- Keep `memory` as the only entity type for both modes.
- Add a lightweight role marker that agents can set and query consistently.
- Add a stable client identity for session-context scoping, so key rotation does
  not orphan working context.
- Embed session-context memory so it can be found semantically.
- Skip graph extraction for session-context memory.
- Provide a grooming path that promotes durable facts and archives stale working
  context.
- Preserve existing behavior for current memories that do not specify a role.

---

## Non-Goals

- Do not add a separate `session_context` entity type.
- Do not build a full conversation-history store in this change.
- Do not make every session-context item manually reviewed before storage.
- Do not extract graph edges from session-context memories.
- Do not require a new table unless implementation discovers a strong need.

---

## Memory Roles

Memory role is stored in `metadata.memory_role`.

| Role | Meaning | Default lifecycle |
|------|---------|-------------------|
| `durable_memory` | Stable facts, decisions, preferences, constraints, root causes, completed-work summaries | Long-lived |
| `session_context` | Working context for recent or active conversations | Groomed and eventually archived |

Existing memory entities with no `metadata.memory_role` are treated as
`durable_memory` for backwards compatibility.

Recommended supporting metadata:

| Field | Applies to | Purpose |
|-------|------------|---------|
| `session_id` | `session_context` | Groups working context from one thread/session |
| `session_scope` | `session_context` | Limits working context to the creating client scope |
| `agent_id` | `session_context` | Optional finer grouping for persona/agent within a client |
| `topic` | both | Optional human-readable grouping label |
| `promotable` | `session_context` | Marks likely promotion candidates |
| `promoted_to` | `session_context` | Entity id of durable memory created from this context |
| `groom_after` | `session_context` | Optional timestamp for review eligibility |
| `expires_at` | `session_context` | Optional timestamp after which archival is allowed |

These fields are intentionally metadata, not top-level columns. The feature
should first prove the lifecycle before hardening schema around it.

---

## Session Scope

Durable memory is shared according to Postgram's existing `visibility` and API
key authorization model. Session-context memory needs a narrower default: it is
working context for the client that produced it, not necessarily useful or safe
for every other client on the instance.

Recommended first behavior:

- `durable_memory` remains global within its `visibility` boundary.
- `session_context` is scoped to the creating client by default.
- The scope is recorded in `metadata.session_scope`.
- Search in resume mode only returns session-context memories in the caller's
  scope unless the caller explicitly asks for broader context and is authorized.
- Promotion creates or updates a durable memory that uses the normal global
  visibility model.

A minimal fallback can use the authenticated API key as the client scope:

```json
{
  "memory_role": "session_context",
  "session_scope": {
    "kind": "api_key",
    "api_key_id": "uuid",
    "api_key_name": "codex-desktop"
  }
}
```

This is acceptable as a fallback, but it is not the preferred stable model
because API keys are credentials, not identities. Key rotation would split one
client's session memory across multiple scopes.

The recommended first implementation adds `client_id` to API keys:

```sql
ALTER TABLE api_keys
  ADD COLUMN client_id text;

UPDATE api_keys
SET client_id = name
WHERE client_id IS NULL;

ALTER TABLE api_keys
  ALTER COLUMN client_id SET NOT NULL;

CREATE INDEX idx_api_keys_client_id ON api_keys (client_id);
```

`client_id` is a stable identity for the calling tool or installation, such as
`codex-desktop`, `talon-personal`, `talon-caregiver`, or `claude-code-work`.
Multiple API keys may share the same `client_id`, which supports rotation
without orphaning session context.

With `client_id`, session scope becomes:

```json
{
  "memory_role": "session_context",
  "session_scope": {
    "kind": "client",
    "client_id": "codex-desktop"
  },
  "agent_id": "postgram-strategy"
}
```

`agent_id` is intentionally not an authorization boundary in this design. It is
an optional grouping hint for personas, threads, or agent modes inside one
client. Authorization continues to come from API-key scopes and visibility.

Promotion is therefore a scope transition:

`session_context scoped to one client -> durable_memory governed by visibility`

That transition should be deliberate. The groomer must summarize the durable
fact rather than copy raw session context wholesale.

---

## Enrichment Policy

Enrichment should be role-aware.

| Entity | Embedding | Graph extraction |
|--------|-----------|------------------|
| `memory_role=durable_memory` | Yes | Yes, when extraction is enabled |
| `memory_role=session_context` | Yes | No |
| `document` | Yes | Existing behavior |
| `task` | Existing behavior | Existing behavior |

The principle is:

> Embed for recall. Extract graph for knowledge.

Session-context memory needs semantic recall, but graph extraction would create
noisy edges from provisional working notes. Durable memory has earned the right
to participate in the knowledge graph.

---

## Storage Behavior

Agents may store session-context memory aggressively when the content helps a
future turn resume the active thread. Examples:

- "We were discussing Postgram memory lifecycle roles."
- "Open question: whether session-context memory should be embedded."
- "Current direction: embed session context, skip graph extraction, groom later."

Agents should store durable memory more selectively. Examples:

- "Ivo prefers Postgram to support both session continuity and durable memory
  through a lightweight metadata role."
- "Decision: graph extraction should not run on session-context memories."

The API does not need separate endpoints. Existing `store` and `update` calls
accept the metadata fields.

---

## Search Behavior

Search should allow callers to filter by memory role through metadata filters
once metadata filtering exists. Until then, tags may be used as a transitional
query convention, but metadata remains the intended model.

Useful query modes:

- **Resume mode**: search `type=memory`, `memory_role=session_context`, scoped by
  API key/client, recent timestamp, project, session id, or topic.
- **Knowledge mode**: search `type=memory`, `memory_role=durable_memory`.
- **Blended mode**: search both roles, but rank recent session context only when
  the user appears to be continuing an active topic.

Session-context results should be presented as working context, not durable
truth. Agents should avoid citing old session-context memories as authoritative
without corroborating durable memory or source documents.

---

## Grooming Lifecycle

Grooming is promotion, consolidation, and archival, not just deletion.

The groomer should be a Postgram implementation, not a convention every agent
implements independently. Postgram owns the data model, scoping rules, audit
trail, and promotion semantics, so it is the right place to enforce consistent
memory hygiene.

Eligible session-context memories are reviewed by a scheduled or operator-run
Postgram groomer. A simple first version can select:

- `type=memory`
- `metadata.memory_role=session_context`
- `metadata.session_scope` matching the scope being groomed, unless the groomer
  is running with an administrative/global review mode
- `created_at` older than 7 days, or `metadata.groom_after` in the past
- not already archived
- no `metadata.promoted_to`

For each eligible memory, the operator-run groomer supports two initial modes:

1. **Archive**: mark stale working context as archived once it no longer helps
   resume active work.
2. **Promote**: call the configured extraction LLM with a structured prompt,
   asking whether the session-context memory contains durable information and,
   if so, what distilled durable memory should be stored.

The broader design can still grow into grouped decisions:

1. **Promote**: create or update a `durable_memory` entity containing the stable
   decision, preference, constraint, root cause, or completed-work summary.
2. **Consolidate**: merge duplicate or overlapping session-context memories into
   a smaller session-context summary.
3. **Archive**: mark stale working context as archived once it no longer helps
   resume active work.

Promotion is not a verbatim copy by default. The groomer prompt requires the LLM
to distill the
stable claim from the source session context and write that claim as durable
memory. Raw working context is often provisional, overly specific, or scoped to
one client; durable memory should contain only the reusable fact, decision,
preference, constraint, root cause, or completed-work summary.

When promotion happens, the source session-context memories should be updated
with `metadata.promoted_to=<durable_memory_id>`, archived, and linked to the
durable memory with a `promoted_to` edge. If source session context is scoped
more narrowly than the promoted durable memory, the groomer must preserve
visibility and avoid widening access accidentally.

Recommended implementation shape:

- `memory-grooming-service`: selects eligible session-context memories, builds
  the LLM promotion prompt, parses structured promotion/archive decisions, and
  applies updates transactionally.
- `pgm-admin memory groom`: operator-run command with `--dry-run`, `--client-id`,
  `--mode archive|promote`, `--limit`, and `--yes` flags. `--mode promote`
  reuses the extraction LLM configuration.
- Optional later scheduler: periodically runs grooming for configured clients.

The first implementation should favor an admin/operator workflow over an
agent-callable promotion tool. Promotion changes the sharing and authority level
of memory, so it deserves auditability and a deliberate execution path.

---

## Promotion Rules

Promote session context when it contains:

- a decision with rationale
- an explicit user preference
- a discovered constraint
- a bug root cause
- a durable project fact
- a completed-work summary
- a reusable process insight

Do not promote:

- transient planning chatter
- abandoned options
- duplicate restatements
- one-turn reminders that already became tasks
- context that only made sense inside one short conversation

Promotion should prefer updating an existing durable memory when one clearly
exists, rather than creating duplicates.

---

## API and MCP Contract

One new MCP convenience tool is recommended for the first version.

Existing tools should continue to work:

- `store`
- `update`
- `search`
- `task_create` and task tools unchanged

New tool:

### `store_session_context`

Stores short-lived working context as a scoped `memory` entity.

Inputs:

- `content`
- `session_id` (optional)
- `agent_id` (optional)
- `topic` (optional)
- `tags` (optional)
- `visibility` (optional, defaults according to the existing API behavior)
- `promotable` (optional)
- `groom_after` (optional)
- `expires_at` (optional)

Behavior:

- Forces `type=memory`.
- Forces `metadata.memory_role=session_context`.
- Defaults `metadata.session_scope` from authenticated `client_id`.
- Stores optional `session_id`, `agent_id`, `topic`, `promotable`,
  `groom_after`, and `expires_at` in metadata.
- Returns the created entity.

This tool keeps agents from hand-assembling the metadata contract on every
write. It also makes the intended behavior discoverable from the MCP tool list:
session context is a first-class write path, but still uses the existing memory
entity model internally.

The main contract change is documented behavior:

- Agents may set `metadata.memory_role=session_context`.
- Agents may set `metadata.memory_role=durable_memory`.
- When a caller stores `session_context`, Postgram should default
  `metadata.session_scope` from the authenticated `client_id` if the caller did
  not provide one.
- Missing role means durable memory.
- The enrichment worker skips graph extraction for `session_context`.

Future convenience tools may be added later if the pattern proves useful:

- `promote_memory`
- `groom_memory`

`promote_memory` and `groom_memory` are out of scope for the initial MCP
surface. Promotion should start in the Postgram admin/service layer because it
crosses from scoped working context into durable memory.

---

## End-User Documentation

This feature changes how agents and operators should think about memory, so it
must be documented for end users, not only in code comments or internal specs.

Required documentation updates:

- Main README: explain durable memory vs session context, when to use each, and
  why session context is scoped by client.
- CLI README: show how to store durable memory and session-context memory with
  metadata, including a transition note for users without the MCP convenience
  tool.
- MCP contract docs: document `store_session_context`, its inputs, default
  scoping behavior, and the fact that it embeds but skips graph extraction.
- Bundled Postgram skill: instruct agents to use session context for thread
  continuity, durable memory for stable knowledge, and to leave promotion to
  Postgram grooming.
- Admin/operator docs: document `pgm-admin memory groom`, dry-run behavior,
  promotion semantics, and why promotion distills rather than copies raw
  session context.

The user-facing language should avoid implementation jargon where possible:
describe `session_context` as "working context for resuming recent
conversations" and `durable_memory` as "long-term memory future agents should
trust."

---

## Migration

This design requires a small database migration for stable client identity:

- Add `api_keys.client_id text`.
- Backfill existing rows with `name`.
- Make `client_id` non-null.
- Add an index on `client_id`.

Existing memories are interpreted as `durable_memory`. No backfill is necessary.
Optionally, a later maintenance command may set `metadata.memory_role` explicitly
on existing memory entities for clarity. Existing session-context memories, if
any exist before this feature lands, can either keep their API-key scope or be
rewritten to the corresponding `client_id` by an operator command.

---

## Testing

Required coverage:

- Creating an API key accepts or derives a stable `client_id`.
- Rotating an API key by creating a second key with the same `client_id` can
  still find session-context memories from the first key.
- `store_session_context` forces `type=memory`,
  `metadata.memory_role=session_context`, and client-scoped metadata.
- Storing a memory with no role behaves as durable memory.
- Storing a memory with `metadata.memory_role=session_context` still creates
  chunks and embeddings.
- Storing a session-context memory without `metadata.session_scope` populates
  the caller's `client_id`.
- Resume-mode search excludes session-context memories from other clients.
- Session-context memories do not enter the graph extraction path.
- Durable memories continue to use existing graph extraction behavior.
- Search returns session-context memories through normal semantic search.
- Grooming promotion creates or updates distilled durable memory and marks the
  source with `metadata.promoted_to`.
- Grooming does not promote raw session-context content verbatim unless the
  operator explicitly requests that behavior.
- Grooming archival does not delete source context.

Manual sanity checks:

- Store a short session-context memory and verify it can be found semantically.
- Verify no extracted edges appear for that memory after enrichment completes.
- Promote a session-context memory and confirm the durable version is searchable
  as long-term memory.

---

## Open Questions

1. Should `memory_role` eventually become a top-level column if filtering by it
   becomes common enough?
2. Should the default grooming window be 7 days, 14 days, or configurable per
   client?
3. Should session-context search receive an automatic recency boost stronger
   than durable memory search?
4. Should promotion create graph edges (`promoted_from`, `derived_from`) or is
   `metadata.promoted_to` sufficient?
5. Should archived session-context memory remain embeddable/searchable by
   default, or only when `include_archived=true`?
6. Should `client_id` values be free-form strings, admin-managed records, or
   constrained slugs derived from API key creation?
7. Should `agent_id` be entirely caller-supplied metadata, or should Postgram
   provide a first-class field later if it becomes useful?
8. Resolved for the first implementation: promotion grooming uses the
   configured extraction LLM provider.
9. Should `store_session_context` also exist as a REST shortcut, or is MCP plus
   ordinary `POST /api/entities` enough for the first version?

---

## Recommended First Implementation

Implement the smallest useful version:

1. Teach enrichment to inspect `metadata.memory_role`.
2. Add `client_id` to API keys and include it in `AuthContext`.
3. Default session-context scope to `client_id`, falling back to API key id only
   for legacy callers during migration.
4. Add MCP `store_session_context`.
5. Skip graph extraction when the role is `session_context`.
6. Keep chunking and embedding unchanged for session context.
7. Add tests for the enrichment and scoping policy.
8. Update the bundled Postgram skill with the session/durable distinction.
9. Update end-user docs in README, CLI README, and MCP contract docs.
10. Add a minimal admin or CLI grooming command only after a few real
   session-context memories exist and the desired workflow is clearer.

This makes the boundary explicit immediately without over-designing the
grooming system before it has real data to work on.
