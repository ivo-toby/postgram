# Phase 3: Knowledge Graph — Design Spec

**Date:** 2026-03-30
**Scope:** Graph edges between entities, LLM-powered relationship extraction, graph traversal, graph-enhanced search
**Migration:** `004_knowledge_graph.sql`

---

## Overview

Add a knowledge graph layer to postgram. Entities can be connected by typed, directional edges (e.g. "person X involves project Y"). Edges are created manually via `link`/`unlink` tools or automatically by an LLM extraction step that runs after enrichment. The `expand` tool traverses the graph. Search can optionally include 1-hop graph neighbors in results.

**Key decisions:**
- OpenAI `gpt-4o-mini` for extraction (SDK already in project, cheapest fast model)
- Extraction runs as a second stage after enrichment completes (enrichment_status=completed triggers extraction)
- Entity resolution: basic name + vector similarity matching against existing entities
- Graph traversal via Postgres recursive CTE
- `expand_graph` option on search for 1-hop neighbor expansion

---

## Schema

New `edges` table.

```sql
CREATE TABLE edges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation   text NOT NULL,
  confidence float NOT NULL DEFAULT 1.0,
  source     text,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_id, target_id, relation)
);

CREATE INDEX idx_edges_source ON edges (source_id);
CREATE INDEX idx_edges_target ON edges (target_id);
CREATE INDEX idx_edges_relation ON edges (relation);
```

**Design notes:**
- `UNIQUE (source_id, target_id, relation)` prevents duplicate edges
- `ON DELETE CASCADE` on both FKs — archiving an entity removes its edges
- `confidence`: 1.0 for manual edges, LLM-assigned (0.0-1.0) for extracted edges
- `source`: which agent/process created the edge (e.g. `manual`, `llm-extraction`, `talon`)
- Standard relation types: `involves`, `assigned_to`, `part_of`, `blocked_by`, `mentioned_in`, `related_to`
- Custom relation types are allowed — no CHECK constraint on relation

---

## Edge Service

New `src/services/edge-service.ts` with CRUD operations.

### `createEdge`

```typescript
type CreateEdgeInput = {
  sourceId: string;
  targetId: string;
  relation: string;
  confidence?: number;
  source?: string;
  metadata?: Record<string, unknown>;
};
```

Validates both entities exist, enforces auth (write scope, type/visibility access on both entities). Returns the created edge. On duplicate (same source_id + target_id + relation), updates confidence and metadata instead of erroring (upsert).

### `deleteEdge`

Deletes an edge by ID. Requires delete scope.

### `listEdges`

Lists edges for an entity (as source, target, or both). Supports filtering by relation type.

### `expandGraph`

```typescript
type ExpandInput = {
  entityId: string;
  depth?: number;        // default: 1, max: 3
  relationTypes?: string[];  // filter by relation types
};
```

Returns the entity plus all connected entities up to `depth` hops. Uses a Postgres recursive CTE:

```sql
WITH RECURSIVE graph AS (
  SELECT source_id, target_id, relation, confidence, 1 AS depth
  FROM edges
  WHERE source_id = $1 OR target_id = $1

  UNION ALL

  SELECT e.source_id, e.target_id, e.relation, e.confidence, g.depth + 1
  FROM edges e
  JOIN graph g ON (e.source_id = g.target_id OR e.source_id = g.source_id
                   OR e.target_id = g.source_id OR e.target_id = g.target_id)
  WHERE g.depth < $2
)
SELECT DISTINCT * FROM graph;
```

The service then fetches the unique entity IDs from the graph and returns full entities with their connecting edges.

---

## LLM Extraction Pipeline

### When it runs

After the enrichment worker sets `enrichment_status = 'completed'`, the extraction step runs. This is implemented as a second phase in the enrichment worker, not a separate worker.

A new column `extraction_status` on entities tracks this: `null` (not applicable / no content), `pending`, `completed`, `failed`.

When enrichment completes → set `extraction_status = 'pending'`.
The worker picks up entities with `extraction_status = 'pending'` and runs extraction.

### Extraction logic

1. Send the entity content to OpenAI `gpt-4o-mini` with a structured prompt asking it to identify:
   - Referenced entities (people, projects, concepts) with their types
   - Relationships between the stored entity and referenced entities
2. For each extracted reference:
   - Search existing entities by name (metadata title, content substring) and optionally vector similarity
   - If a match is found (confidence > 0.7): create an edge to the existing entity
   - If no match: skip (don't create phantom entities — they can be created explicitly later)
3. Store edges with `source = 'llm-extraction'` and the LLM-assigned confidence

### Extraction prompt

```
Given this knowledge entity, identify relationships to other entities.

Entity type: {type}
Content: {content}

Return a JSON array of relationships:
[
  {
    "target_name": "name of the referenced entity",
    "target_type": "person|project|task|memory|interaction|document",
    "relation": "involves|assigned_to|part_of|blocked_by|mentioned_in|related_to",
    "confidence": 0.0-1.0
  }
]

Only include clear, explicit relationships. Do not infer or speculate.
Return [] if no relationships are found.
```

### Entity matching

For each extracted target_name:
1. Search entities where `metadata->>'title'` or content ILIKE `%target_name%`
2. If multiple matches, pick the one with highest relevance (prefer exact title match)
3. If no match found: skip this relationship

This is intentionally simple. Full entity resolution with vector similarity matching is deferred to Phase 5.

### Configuration

New env var: `EXTRACTION_ENABLED` (default: `false`). When disabled, extraction is skipped entirely — the enrichment worker just does chunks+embeddings as before. This allows running without the extraction cost.

New env var: `EXTRACTION_MODEL` (default: `gpt-4o-mini`). Configurable model for extraction.

---

## REST Endpoints

### `POST /api/edges` — create edge

```json
{
  "source_id": "uuid",
  "target_id": "uuid",
  "relation": "involves",
  "confidence": 1.0,
  "metadata": {}
}
```
Response: `201 Created` with `{ "edge": Edge }`

### `DELETE /api/edges/:id` — delete edge

Response: `200 OK` with `{ "id": "...", "deleted": true }`

### `GET /api/entities/:id/edges` — list edges

Query params: `relation`, `direction` (source|target|both, default: both)
Response: `200 OK` with `{ "edges": Edge[] }`

### `GET /api/entities/:id/graph` — expand graph

Query params: `depth` (default: 1, max: 3), `relation_types` (comma-separated)
Response: `200 OK` with `{ "root": Entity, "entities": Entity[], "edges": Edge[] }`

### Search enhancement

Add optional `expand_graph` boolean to `POST /api/search`. When true, for each result entity, include 1-hop graph neighbors in a `related` field:

```json
{
  "results": [
    {
      "entity": { ... },
      "chunk_content": "...",
      "score": 0.85,
      "related": [
        { "entity": { ... }, "relation": "involves", "direction": "outgoing" }
      ]
    }
  ]
}
```

---

## MCP Tools

### `link`

```typescript
{
  name: "link",
  description: "Create a relationship between two entities.",
  inputSchema: {
    source_id: z.string(),
    target_id: z.string(),
    relation: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    metadata: z.record(z.unknown()).optional()
  }
}
```

### `unlink`

```typescript
{
  name: "unlink",
  description: "Remove a relationship between entities.",
  inputSchema: {
    id: z.string()
  }
}
```

### `expand`

```typescript
{
  name: "expand",
  description: "Get the graph neighborhood of an entity — connected entities up to N hops.",
  inputSchema: {
    entity_id: z.string(),
    depth: z.number().int().min(1).max(3).optional(),
    relation_types: z.array(z.string()).optional()
  }
}
```

### Search update

Add `expand_graph: z.boolean().optional()` to the existing search tool inputSchema.

---

## CLI Commands

### `pgm link <source-id> <target-id> --relation <type>`

Creates an edge. Flags: `--confidence`, `--metadata`, `--json`.

### `pgm unlink <edge-id>`

Deletes an edge.

### `pgm expand <entity-id>`

Shows graph neighborhood. Flags: `--depth`, `--relation`, `--json`.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/db/migrations/004_knowledge_graph.sql` | edges table + extraction_status column |
| Create | `src/services/edge-service.ts` | createEdge, deleteEdge, listEdges, expandGraph |
| Create | `src/services/extraction-service.ts` | LLM extraction logic, entity matching |
| Modify | `src/services/enrichment-worker.ts` | Add extraction stage after enrichment |
| Modify | `src/transport/rest.ts` | Edge endpoints, graph expand, search expand_graph |
| Modify | `src/transport/mcp.ts` | link, unlink, expand tools; search expand_graph |
| Modify | `src/cli/client.ts` | Edge client methods |
| Modify | `src/cli/pgm.ts` | link, unlink, expand commands |
| Modify | `src/services/search-service.ts` | expand_graph option |
| Modify | `src/config.ts` | EXTRACTION_ENABLED, EXTRACTION_MODEL |
| Create | `tests/unit/extraction.test.ts` | Extraction prompt parsing, entity matching |
| Create | `tests/integration/edge-service.test.ts` | Edge CRUD + graph traversal |
| Create | `tests/integration/extraction-service.test.ts` | Extraction pipeline integration |
| Modify | `tests/contract/rest-api.test.ts` | Edge + graph endpoint tests |
| Modify | `tests/contract/mcp-tools.test.ts` | link, unlink, expand tool tests |
| Modify | `tests/integration/cli-pgm.test.ts` | CLI edge command tests |

---

## Testing Strategy

- **Unit tests:** Extraction response parsing, entity name matching logic
- **Integration tests:** Edge CRUD, graph traversal at depths 1-3, extraction pipeline with mocked LLM, graph-enhanced search
- **Contract tests:** REST edge endpoints, MCP link/unlink/expand tools, search with expand_graph
- **CLI tests:** pgm link, pgm unlink, pgm expand
- **E2E (sprite):** Full stack with real Postgres — create entities, link them, expand graph, search with graph expansion
