# Search Edge Affordances Design

## Summary

Postgram search already supports progressive context disclosure through compact
results, `expand_graph`, `expand`, `full_response`, and TOON output. The missing
piece is that compact search results do not clearly tell an agent when useful
graph context exists.

Add small edge affordances to compact search results so agents can see that a
result has traversable relationships without receiving neighbor content by
default. Update the agent-facing instructions to teach a deliberate retrieval
ladder: search first, inspect edge affordances, traverse only when the user task
needs relational context, and keep full responses reserved for metadata-heavy
inspection.

## Goals

- Make graph context discoverable from default compact search results.
- Preserve token efficiency by returning relation counts, not neighbor content,
  unless expansion is explicitly requested.
- Teach agents when to call `expand_graph` or `expand` after search.
- Keep existing REST behavior compatible for normal search consumers.
- Keep `full_response` and TOON semantics clear and unchanged.
- Add focused tests for service payload mapping, MCP compact output, CLI compact
  output, and TOON rendering.

## Non-Goals

- Do not make graph expansion the default.
- Do not include related entity content in default compact search results.
- Do not add model-generated heuristics such as `expand_suggested` in the first
  version.
- Do not change semantic search ranking, thresholds, recency scoring, or
  extraction behavior.
- Do not require graph edges for memory recall. Memories remain searchable even
  when they are not graph-extracted.

## Current Context

`src/services/search-service.ts` performs hybrid search and optionally attaches
one-hop `related` entries when `expandGraph` is true. The optional related
entries include the neighbor entity, relation, and direction.

`src/util/search-output.ts` turns full REST-shaped search payloads into compact
agent-facing JSON and TOON. Compact output currently contains result identity,
score, content, matched chunk, tags, and optional `related` entries when graph
expansion has already been requested.

`src/transport/mcp.ts` and `cli/src/pgm.ts` already expose the disclosure
controls:

- compact output by default for MCP and `pgm search --json`
- `expand_graph` / `--expand-graph` for inline one-hop graph neighbors
- `expand` for deliberate graph traversal by entity ID
- `full_response` / `--full-response` for full API-shaped payloads
- `toon` / `--toon` for smallest readable output

The docs and templates already mention compact output and graph expansion, but
the compact payload itself does not advertise that graph traversal is available
for a particular result.

## Result Shape

Add an `edges` summary to compact search results when an entity has visible
edges:

```json
{
  "id": "entity-id",
  "type": "memory",
  "score": 0.82,
  "content": "stored content",
  "chunk": "matched chunk",
  "tags": ["postgram"],
  "edges": {
    "count": 7,
    "relations": [
      { "relation": "depends_on", "count": 2 },
      { "relation": "mentioned_in", "count": 5 }
    ]
  }
}
```

Rules:

- Omit `edges` when the visible edge count is zero.
- `edges.count` is the total number of visible edges connected to the result.
- `edges.relations` is sorted by descending count, then relation name for stable
  output.
- Relation entries contain only `relation` and `count`.
- Do not include neighbor IDs, neighbor content, edge metadata, timestamps, or
  raw source fields in the default compact result.
- Preserve the existing `related` field when `expand_graph` is true.

This keeps the default compact result cheap while making the next available
step explicit.

## Search Service Design

Extend `SearchResult` with an optional edge summary:

```ts
type SearchEdgeSummary = {
  count: number;
  relations: Array<{ relation: string; count: number }>;
};
```

After the ranked search results are selected, query visible edges for the result
entity IDs and build summaries per result. Reuse the same visibility, type,
owner, archived-status, and scoped-memory checks used by graph expansion so the
summary does not advertise edges the caller cannot traverse.

Implementation detail:

- Fetch edges where either endpoint is one of the result IDs.
- Join or filter both endpoint entities so archived and unauthorized neighbors
  are excluded.
- Count each visible edge once for the matching result endpoint.
- Aggregate relation counts per result.
- Attach summaries before optional `expandGraph` related-entity hydration.

The existing `expandGraph` path may reuse the same visible-edge query result to
avoid duplicate edge reads. If that would make the first implementation harder,
keep the paths separate and optimize later.

## Compact Output Design

Update compact output types in both `src/util/search-output.ts` and
`cli/src/search-output.ts`:

```ts
type CompactSearchResult = {
  id: string;
  type: string;
  score: number;
  content: string | null;
  chunk: string;
  tags?: string[];
  edges?: {
    count: number;
    relations: Array<{ relation: string; count: number }>;
  };
  related?: CompactRelatedResult[];
};
```

TOON output should include an `edges` column in the result row. Keep the column
compact by rendering only a short summary, for example:

```text
7 edges: depends_on=2|mentioned_in=5
```

When `related` is present, keep the existing nested related block. The row-level
edge summary still helps agents understand whether the inline related entries
are exhaustive for the current one-hop query and what relation mix was present.

## MCP And CLI Behavior

MCP `search` continues to return compact output by default. The compact output
now includes `edges` summaries when available.

CLI `pgm search --json` mirrors MCP compact output. Human-readable default
search output may show a short edge line if the result has edges, but this is
optional for the first implementation. `pgm search --toon` should include the
edge summary because TOON is explicitly agent-facing.

`full_response` / `--full-response` should include the edge summary only if the
service-level search payload includes it. It should not require a second
payload-only transformation.

## Agent Instructions

Update these instruction surfaces:

- `skill/postgram/SKILL.md`
- `templates/AGENTS.md`
- `templates/CLAUDE.md`
- `docs/optimized-system-profile.md`
- README and CLI README sections that describe MCP and CLI compact output

Instruction pattern:

1. Start with compact search.
2. Inspect `edges.count` and `edges.relations`.
3. Traverse only when the user task needs relational context:
   - causes or provenance
   - decisions and rationale
   - dependencies or blockers
   - ownership, assignment, involvement, or discussion participants
   - "what else is connected to this"
   - ambiguous search hits where graph context can disambiguate
4. Use `expand_graph` when the agent wants one-hop context inline with search
   results.
5. Use `expand <id>` when the agent has chosen a specific result and wants
   deliberate traversal with depth or relation filters.
6. Keep `toon` for cheap list-like exploration.
7. Use `full_response` only when metadata, timestamps, raw similarity, source,
   or full REST-shaped fields are required.

The instructions should also say not to expand when the user only needs a
direct fact from the search result. The point is to make graph traversal
discoverable, not automatic.

## Compatibility

REST clients that consume the existing search response receive an additive
optional field. Existing consumers can ignore it.

MCP and CLI compact JSON consumers receive a new optional field. This is an
additive compact-schema change. Tests should make the new field explicit so
future changes do not accidentally remove it.

TOON output gains an extra column. TOON is intended for agent readability rather
than a stable machine-parsed contract, so this is acceptable. Documentation
should still show the new shape.

## Testing

Add or update focused tests:

- Unit tests for relation-count aggregation and stable sorting.
- Unit tests for `compactSearchResponse` including `edges`.
- Unit tests for `searchResponseToToon` including the edge summary.
- MCP contract test showing compact `search` output includes `edges` when the
  result has visible edges and omits neighbor content unless `expand_graph` is
  true.
- MCP contract test showing `expand_graph` still returns `related`.
- CLI output test or smoke test for `pgm search --json` and `pgm search --toon`
  if the existing test harness can exercise DB-backed search.

Verification after implementation:

```bash
npm test -- tests/unit/search-output.test.ts
npm test -- tests/contract/mcp-tools.test.ts
npm run typecheck
npm run build
npx eslint src/services/search-service.ts src/util/search-output.ts src/transport/mcp.ts cli/src/search-output.ts cli/src/pgm.ts tests/unit/search-output.test.ts tests/contract/mcp-tools.test.ts
```

If DB-backed contract tests remain blocked by local Testcontainers/runtime
availability, record that clearly and run all non-DB verification that applies.

## Implementation Notes

Keep the first implementation boring:

- Use deterministic counts, not model-generated advice.
- Keep summary size bounded by the number of relation types, not the number of
  neighbors.
- Do not introduce a new `include_edge_summary` flag unless real consumers need
  it later.
- Prefer one shared helper for building edge summaries so search, MCP, CLI, and
  tests describe the same shape.
- Keep the naming plain. `edges` is preferable to a more abstract phrase like
  `progressive_disclosure`.

This makes Postgram's progressive disclosure explicit without turning every
search into graph retrieval.
