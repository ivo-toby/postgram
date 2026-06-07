# Memory Grooming Scope, Age, and Self-Service Design

## Purpose

Postgram session-context grooming currently requires an operator to pass one
`client_id`, and eligibility is hard-coded to memories older than 7 days unless
`metadata.groom_after` is in the past. This makes operational grooming awkward
when several clients write session context, and it prevents agents from safely
cleaning up their own old working context.

This change adds:

- admin grooming across all clients in one command
- configurable age-based eligibility
- normal CLI and MCP self-grooming for the authenticated client, limited to
  dry-run and archive

Agent-facing LLM promotion remains out of scope for this change and is tracked
in GitHub issue #47.

## Current Behavior

`pgm-admin memory groom` calls `previewSessionContextGrooming` and
`groomSessionContext` with a required `clientId`. The candidate SQL filters to:

- active `type = 'memory'`
- `metadata.memory_role = 'session_context'`
- `metadata.session_scope.client_id = $clientId`
- no `metadata.promoted_to`
- `metadata.groom_after` in the past or `created_at <= now - interval '7 days'`

`--mode promote --yes` is admin-only and uses the configured extraction LLM to
distill selected session context into durable memory. Normal `pgm` and MCP
surfaces can store and search session context, but cannot groom it.

## Goals

1. Operators can groom all clients in a single admin command.
2. Operators and self-grooming callers can choose the minimum age for stale
   session context.
3. Agents can preview and archive their own session-context memories without
   being able to mutate another client's data.
4. Existing default behavior remains production-safe: client-scoped admin
   grooming with a 7-day age window.
5. Promotion remains admin-only until scoped promotion has a separate authority,
   audit, and UX design.

## Non-Goals

- Do not add agent-facing LLM promotion in this change.
- Do not implement grouped consolidation across multiple session-context
  memories.
- Do not change search visibility rules for session context.
- Do not require `metadata.promotable = true` for grooming eligibility.

## Proposed UX

### Admin CLI

Admin grooming accepts either a specific client or all clients:

```bash
./bin/pgm-admin memory groom --client-id coding-agents --mode promote --yes
./bin/pgm-admin memory groom --all-clients --mode promote --yes
```

`--client-id` and `--all-clients` are mutually exclusive. One of them is
required.

`--all-clients` does not merge all session context into one logical grooming
pool. It discovers eligible client scopes and processes each `client_id`
independently. Promotion prompts must contain candidates from only one client
scope, and promoted durable memories must retain that source scope so one
client's distilled working context does not become visible to another client.

Admin grooming accepts an age duration:

```bash
./bin/pgm-admin memory groom --all-clients --older-than 14d --dry-run
./bin/pgm-admin memory groom --client-id ivoMac --older-than 24h --mode archive --yes
```

`--older-than` defaults to `7d`. Supported units are `m`, `h`, and `d`.
`--older-than 0d` means age should not block eligibility; the other
session-context filters still apply.

JSON dry-run output includes the scope and age window:

```json
{
  "dryRun": true,
  "archived": 0,
  "promoted": 0,
  "skipped": 0,
  "mode": "promote",
  "scope": { "kind": "all_clients" },
  "olderThan": "7d",
  "eligible": []
}
```

### Normal CLI

Normal CLI self-grooming is scoped to the authenticated key's `client_id`.

```bash
pgm memory groom --dry-run
pgm memory groom --mode archive --older-than 14d --yes
```

The normal CLI does not accept `--client-id`, `--all-clients`, or
`--mode promote`. If the caller requests promotion, the command fails with a
validation error that points to admin grooming and issue #47.

Useful self-grooming filters:

- `--older-than <duration>` defaults to `7d`
- `--limit <n>` defaults to `50`
- `--topic <topic>` optionally narrows to `metadata.topic`
- `--session-id <id>` optionally narrows to `metadata.session_id`
- `--tag <tag>` can be repeated and requires all supplied tags to be present

### MCP Tool

Add a `groom_session_context` MCP tool with the same self-scope as normal CLI:

```json
{
  "mode": "dry_run",
  "older_than": "7d",
  "limit": 50,
  "topic": "botforge-issue-47",
  "session_id": "optional-session-id",
  "tags": ["botforge"]
}
```

Allowed `mode` values are `dry_run` and `archive`. The MCP transport derives
scope from the authenticated `clientId`; no client id is accepted from the
caller.

The tool returns counts plus eligible candidate summaries for dry runs. Archive
mode returns archived count and the archived ids.

## Service Design

Introduce an explicit grooming scope type:

```ts
type GroomingScope =
  | { kind: 'client'; clientId: string }
  | { kind: 'all_clients' };
```

Shared grooming input includes:

```ts
type GroomingFilters = {
  olderThanMs: number;
  limit: number;
  topic?: string;
  sessionId?: string;
  tags?: string[];
};
```

The service computes an eligibility cutoff in TypeScript:

```ts
const ageCutoff = new Date(now.getTime() - olderThanMs);
```

SQL then checks:

- `groom_after` is a valid timestamp and is in the past, or
- `created_at <= ageCutoff`

For `olderThanMs = 0`, `ageCutoff` equals `now`, so all existing matching
session-context rows are age-eligible.

The admin path can pass `{ kind: 'all_clients' }`. Self-grooming surfaces always
pass `{ kind: 'client', clientId: auth.clientId }`.

For `all_clients`, the service groups candidates by
`metadata.session_scope.client_id` before any archive or promotion work. The
existing single-memory promotion prompt remains per candidate, but the
transaction and result accounting keep the source `client_id` attached to each
candidate.

Promoted durable memories created from session context carry the source scope:

```json
{
  "memory_role": "durable_memory",
  "session_scope": { "kind": "client", "client_id": "coding-agents" },
  "promoted_from": "source-id",
  "promotion_source_role": "session_context",
  "promotion_client_id": "coding-agents"
}
```

Search and graph expansion must treat scoped durable memories the same way they
treat scoped session context: a caller can see them only when the stored
`metadata.session_scope.client_id` matches the authenticated `clientId`, unless
an explicitly privileged admin/debug path asks to include other clients. Durable
memories without `metadata.session_scope` keep the current global durable-memory
behavior.

## Data Flow

1. CLI or MCP parses scope, age, limit, and optional filters.
2. Surface-level validation rejects unsafe combinations.
3. The service previews eligible session-context memories.
4. Dry-run returns the preview without mutation.
5. Archive mode updates source rows to `status = 'archived'` and records
   `groomed_at`, `groomed_mode`, and `groomed_by`.
6. Admin promotion keeps the existing LLM decision flow, but can now operate on
   one client or all clients and can use a custom age window.
7. When promotion creates durable memory from session context, the source
   `session_scope` is copied to the durable memory metadata and enforced during
   search.

## Safety and Authorization

- Admin CLI is trusted operator surface and can use `--all-clients`.
- Normal CLI and MCP are authenticated user surfaces and cannot pass arbitrary
  client scope.
- Agent-facing self-grooming cannot promote into durable memory in this change.
- `--all-clients` preserves client boundaries; it is operational batching, not a
  cross-client consolidation mode.
- Promoted durable memories derived from session context are client-scoped in
  metadata and in retrieval.
- Archive mutation still requires `--yes` in normal CLI and admin CLI.
- MCP archive mode is already an explicit mutation request, so it does not take
  a separate `yes` flag.
- Audit entries record scope, mode, age duration, filters, archived count,
  promoted count, and skipped count.

## Errors

- Passing both `--client-id` and `--all-clients` fails validation.
- Passing neither `--client-id` nor `--all-clients` in admin grooming fails
  validation.
- Invalid durations fail validation with examples: `30m`, `24h`, `7d`.
- Negative durations fail validation.
- Normal CLI or MCP promotion requests fail validation because promotion is
  admin-only in this change.

## Testing

Service integration tests cover:

- all-client preview returns eligible memories from multiple client scopes
- client-scoped preview returns only the requested client
- custom age window includes younger memories when configured
- `olderThanMs = 0` includes current matching memories
- topic, session id, and tag filters narrow candidates
- archive mode records grooming metadata
- promotion still creates durable memories through the admin path
- all-client promotion creates scoped durable memories per source client
- search does not return scoped durable memories to a different authenticated
  client

CLI integration tests cover:

- admin requires exactly one of `--client-id` or `--all-clients`
- admin accepts `--older-than`
- normal CLI self-grooming cannot pass client scope
- normal CLI self-grooming rejects promote mode

MCP contract tests cover:

- `groom_session_context` dry-run uses authenticated client scope
- `groom_session_context` archive cannot archive another client's memory
- invalid durations and promotion mode return validation errors
- search does not expose another client's durable memory promoted from session
  context

## Rollout

This is backward-compatible for current admin users because the default age
window remains 7 days and `--client-id` still works. Operators who want broad
maintenance can switch cron jobs to `--all-clients`. Agents can start with
dry-run self-grooming before enabling archive workflows.
