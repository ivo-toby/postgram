# Search Edge Affordances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add token-cheap edge summaries to compact Postgram search results and teach agents when to traverse graph context.

**Architecture:** The search service will attach a small `edges` summary after ranking results, using the same visibility, type, owner, archive, and scoped-memory rules as graph expansion. MCP/REST/CLI payload mappers pass the summary through, while compact JSON and TOON render counts and relation names without neighbor content unless `expand_graph` is requested.

**Tech Stack:** TypeScript 5.9, Node.js 22, Hono REST transport, MCP transport, pg, Vitest, Commander CLI.

---

### Task 1: Edge Summary Helper

**Files:**
- Modify: `src/services/search-service.ts`
- Test: `tests/unit/search-scoring.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Add tests that describe the pure aggregation behavior:

```ts
import {
  applyRecencyBoost,
  blendScores,
  buildSearchEdgeSummaries,
  deduplicateResults,
  normalizeBm25Scores
} from '../../src/services/search-service.js';

describe('buildSearchEdgeSummaries', () => {
  it('counts visible edges and sorts relation summaries stably', () => {
    const summaries = buildSearchEdgeSummaries([
      { result_entity_id: 'a', relation: 'mentioned_in' },
      { result_entity_id: 'a', relation: 'depends_on' },
      { result_entity_id: 'a', relation: 'mentioned_in' },
      { result_entity_id: 'a', relation: 'blocked_by' },
      { result_entity_id: 'b', relation: 'related_to' }
    ]);

    expect(summaries.get('a')).toEqual({
      count: 4,
      relations: [
        { relation: 'mentioned_in', count: 2 },
        { relation: 'blocked_by', count: 1 },
        { relation: 'depends_on', count: 1 }
      ]
    });
    expect(summaries.get('b')).toEqual({
      count: 1,
      relations: [{ relation: 'related_to', count: 1 }]
    });
  });

  it('returns an empty map when there are no visible edge rows', () => {
    expect(buildSearchEdgeSummaries([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the helper tests to verify RED**

Run: `npm test -- tests/unit/search-scoring.test.ts`

Expected: FAIL because `buildSearchEdgeSummaries` is not exported.

- [ ] **Step 3: Implement the helper and types**

Add these exported types and helper to `src/services/search-service.ts`:

```ts
export type SearchEdgeSummary = {
  count: number;
  relations: Array<{ relation: string; count: number }>;
};

export type SearchEdgeSummaryRow = {
  result_entity_id: string;
  relation: string;
};

export function buildSearchEdgeSummaries(
  rows: SearchEdgeSummaryRow[]
): Map<string, SearchEdgeSummary> {
  const byEntity = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const relations = byEntity.get(row.result_entity_id) ?? new Map<string, number>();
    relations.set(row.relation, (relations.get(row.relation) ?? 0) + 1);
    byEntity.set(row.result_entity_id, relations);
  }

  const summaries = new Map<string, SearchEdgeSummary>();
  for (const [entityId, relations] of byEntity) {
    const relationSummaries = Array.from(relations.entries())
      .map(([relation, count]) => ({ relation, count }))
      .sort((left, right) => right.count - left.count || left.relation.localeCompare(right.relation));

    summaries.set(entityId, {
      count: relationSummaries.reduce((total, entry) => total + entry.count, 0),
      relations: relationSummaries
    });
  }

  return summaries;
}
```

Extend `SearchResult` with `edges?: SearchEdgeSummary`.

- [ ] **Step 4: Run the helper tests to verify GREEN**

Run: `npm test -- tests/unit/search-scoring.test.ts`

Expected: PASS.

### Task 2: Search Service Edge Summaries

**Files:**
- Modify: `src/services/search-service.ts`
- Test: `tests/contract/mcp-tools.test.ts`

- [ ] **Step 1: Write the failing MCP contract expectations**

Extend the existing full-response/TOON search test to create a second entity,
link it to the search hit, and assert compact search exposes `edges` but not
`related` unless expansion is requested:

```ts
const neighbor = extractStructuredPayload(
  (await client.callTool({
    name: 'store',
    arguments: {
      type: 'project',
      content: 'Postgram edge affordance neighbor'
    }
  })) as ToolResultPayload
) as { entity: { id: string } };

await client.callTool({
  name: 'link',
  arguments: {
    source_id: stored.entity.id,
    target_id: neighbor.entity.id,
    relation: 'depends_on'
  }
});

const compact = extractStructuredPayload(
  (await client.callTool({
    name: 'search',
    arguments: {
      query: 'compact search',
      threshold: 0
    }
  })) as ToolResultPayload
) as {
  results: Array<{
    id: string;
    edges?: { count: number; relations: Array<{ relation: string; count: number }> };
    related?: unknown[];
  }>;
};

const compactHit = compact.results.find((entry) => entry.id === stored.entity.id);
expect(compactHit?.edges).toEqual({
  count: 1,
  relations: [{ relation: 'depends_on', count: 1 }]
});
expect(compactHit).not.toHaveProperty('related');

const expanded = extractStructuredPayload(
  (await client.callTool({
    name: 'search',
    arguments: {
      query: 'compact search',
      threshold: 0,
      expand_graph: true
    }
  })) as ToolResultPayload
) as {
  results: Array<{ id: string; edges?: unknown; related?: Array<{ relation: string }> }>;
};
const expandedHit = expanded.results.find((entry) => entry.id === stored.entity.id);
expect(expandedHit?.related?.map((entry) => entry.relation)).toContain('depends_on');
```

- [ ] **Step 2: Run the MCP contract test to verify RED**

Run: `npm test -- tests/contract/mcp-tools.test.ts -t "supports full-response and TOON search output via MCP arguments"`

Expected: FAIL because compact search does not include `edges`.

- [ ] **Step 3: Attach visible edge summaries in `searchEntities`**

Add a helper that queries visible edges for result IDs:

```ts
async function fetchSearchEdgeSummaries(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  resultEntityIds: string[]
): Promise<Map<string, SearchEdgeSummary>> {
  if (resultEntityIds.length === 0) {
    return new Map();
  }

  const rows = await pool.query<SearchEdgeSummaryRow>(
    `
      SELECT anchor.id AS result_entity_id, e.relation
      FROM unnest($1::uuid[]) AS anchor(id)
      JOIN edges e ON e.source_id = anchor.id OR e.target_id = anchor.id
      JOIN entities src ON src.id = e.source_id
      JOIN entities tgt ON tgt.id = e.target_id
      WHERE src.status IS DISTINCT FROM 'archived'
        AND tgt.status IS DISTINCT FROM 'archived'
        AND ($2::text[] IS NULL OR src.type = ANY($2))
        AND ($2::text[] IS NULL OR tgt.type = ANY($2))
        AND src.visibility = ANY($3)
        AND tgt.visibility = ANY($3)
        AND ${ownerSqlCondition('src.owner', '$4')}
        AND ${ownerSqlCondition('tgt.owner', '$4')}
        AND ${scopedMemoryVisibilitySql('src.metadata', '$5')}
        AND ${scopedMemoryVisibilitySql('tgt.metadata', '$5')}
    `,
    [
      resultEntityIds,
      auth.allowedTypes,
      auth.allowedVisibility,
      input.owner ?? null,
      auth.clientId
    ]
  );

  return buildSearchEdgeSummaries(rows.rows);
}
```

After `runHybridSearch`, call this helper for the ranked result IDs and attach
`result.edges` only when the summary exists.

- [ ] **Step 4: Pass edge summaries through REST and MCP full payloads**

In `src/transport/rest.ts` and `src/transport/mcp.ts`, include:

```ts
...(entry.edges ? { edges: entry.edges } : {}),
```

near the existing `related` mapping.

- [ ] **Step 5: Run the focused MCP contract test to verify GREEN**

Run: `npm test -- tests/contract/mcp-tools.test.ts -t "supports full-response and TOON search output via MCP arguments"`

Expected: PASS.

### Task 3: Compact JSON And TOON Formatting

**Files:**
- Modify: `src/util/search-output.ts`
- Modify: `cli/src/search-output.ts`
- Modify: `cli/src/client.ts`
- Test: `tests/unit/search-output.test.ts`

- [ ] **Step 1: Write failing formatter tests**

Update `fullSearchResponse` in `tests/unit/search-output.test.ts` with:

```ts
edges: {
  count: 3,
  relations: [
    { relation: 'mentioned_in', count: 2 },
    { relation: 'depends_on', count: 1 }
  ]
}
```

Expect compact output to preserve `edges`, and expect TOON to include:

```ts
expect(toon).toContain(
  'results[1]{id,type,score,content,chunk,tags,edges,related}:'
);
expect(toon).toContain('3 edges: mentioned_in=2|depends_on=1');
```

- [ ] **Step 2: Run formatter tests to verify RED**

Run: `npm test -- tests/unit/search-output.test.ts`

Expected: FAIL because compact output and TOON do not include `edges`.

- [ ] **Step 3: Update shared formatter types and serialization**

In both formatter files, add:

```ts
export type CompactSearchEdgeSummary = {
  count: number;
  relations: Array<{ relation: string; count: number }>;
};
```

Add optional `edges` to `FullSearchResponse` entries and `CompactSearchResult`.
Map it through in `compactSearchResponse`.

Update TOON header to:

```ts
`results[${response.results.length}]{id,type,score,content,chunk,tags,edges,related}:`
```

Add a small helper:

```ts
function formatEdgeSummary(edges?: CompactSearchEdgeSummary): string {
  if (!edges || edges.count === 0) {
    return '';
  }

  const relations = edges.relations
    .map((entry) => `${entry.relation}=${entry.count}`)
    .join('|');

  return `${edges.count} edges${relations ? `: ${relations}` : ''}`;
}
```

Use `formatEdgeSummary(result.edges)` in the TOON row before the related-count
column.

- [ ] **Step 4: Update CLI client type**

Add optional `edges` to `cli/src/client.ts` search result entries:

```ts
edges?: {
  count: number;
  relations: Array<{ relation: string; count: number }>;
};
```

- [ ] **Step 5: Run formatter tests to verify GREEN**

Run: `npm test -- tests/unit/search-output.test.ts`

Expected: PASS.

### Task 4: Agent Instructions And Documentation

**Files:**
- Modify: `skill/postgram/SKILL.md`
- Modify: `templates/AGENTS.md`
- Modify: `templates/CLAUDE.md`
- Modify: `README.md`
- Modify: `cli/README.md`

- [ ] **Step 1: Update instruction text**

Teach this retrieval ladder in each agent-facing instruction surface:

```md
Start with compact search. If a result has `edges.count > 0`, inspect
`edges.relations` before deciding whether to traverse. Use `expand_graph` when
the user asks about causes, provenance, decisions, dependencies, blockers,
ownership, involvement, discussion participants, connected context, or when
graph context can disambiguate similar search hits. Do not expand when the user
only needs a direct fact from the compact result.
```

- [ ] **Step 2: Update CLI and README examples**

Document that compact search may include:

```json
"edges": {
  "count": 3,
  "relations": [{ "relation": "mentioned_in", "count": 2 }]
}
```

Clarify that `edges` is a traversal affordance, while `related` appears only
when `expand_graph` is requested.

- [ ] **Step 3: Run doc sanity checks**

Run:

```bash
rg -n "edges\\.count|edges\\.relations|expand_graph|full_response|toon" skill/postgram/SKILL.md templates/AGENTS.md templates/CLAUDE.md README.md cli/README.md
```

Expected: each edited doc contains the new edge-affordance wording and still
mentions token-conscious controls.

### Task 5: Final Verification

**Files:**
- All touched files

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/unit/search-output.test.ts tests/unit/search-scoring.test.ts
npm test -- tests/contract/mcp-tools.test.ts -t "supports full-response and TOON search output via MCP arguments"
```

Expected: PASS.

- [ ] **Step 2: Run typecheck and build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run targeted lint**

Run:

```bash
npx eslint src/services/search-service.ts src/transport/rest.ts src/transport/mcp.ts src/util/search-output.ts cli/src/client.ts cli/src/search-output.ts cli/src/pgm.ts tests/unit/search-output.test.ts tests/unit/search-scoring.test.ts tests/contract/mcp-tools.test.ts
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only planned files changed.
