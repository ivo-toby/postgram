# MCP Input Coercion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MCP tool schemas accept semantically valid stringified numbers, booleans, and string arrays while continuing to reject malformed values.

**Architecture:** Add shared Zod preprocessors in `src/transport/mcp.ts` and replace MCP scalar/array input schema fields with those helpers. Prove behavior through real MCP contract tests in `tests/contract/mcp-tools.test.ts`.

**Tech Stack:** TypeScript 5.9, Node.js 22+, Zod 3, Vitest, `@modelcontextprotocol/sdk`.

---

## File Structure

- Modify `src/transport/mcp.ts`: add reusable schema helpers and apply them to MCP input schemas.
- Modify `tests/contract/mcp-tools.test.ts`: add RED contract coverage for string-coerced values and malformed string rejection.

### Task 1: RED Contract Coverage

**Files:**
- Modify: `tests/contract/mcp-tools.test.ts`

- [ ] **Step 1: Add a failing test for stringified MCP arguments**

Insert this test near the existing search/full-response MCP tests:

```ts
  it('coerces stringified scalar and string-array MCP arguments', async () => {
    const { client, close } = await createClient();

    try {
      const stored = extractStructuredPayload(
        (await client.callTool({
          name: 'store',
          arguments: {
            type: 'memory',
            content: 'string coerced mcp arguments should work',
            tags: '["coerced","mcp"]',
            skip_extraction: 'true',
            full_response: 'true'
          }
        })) as ToolResultPayload
      ) as {
        entity: {
          id: string;
          version: number;
          tags: string[];
          extraction_status?: string;
        };
      };

      expect(stored.entity.tags).toEqual(['coerced', 'mcp']);

      await createEnrichmentWorker({
        pool: database!.pool,
        embeddingService
      }).runOnce();

      const search = extractStructuredPayload(
        (await client.callTool({
          name: 'search',
          arguments: {
            query: 'string coerced arguments',
            tags: '["coerced"]',
            limit: '3',
            threshold: '0',
            recency_weight: '0',
            expand_graph: 'false',
            include_archived: 'false',
            full_response: 'false',
            toon: 'false'
          }
        })) as ToolResultPayload
      ) as { results: Array<{ id: string; tags: string[] }> };

      expect(search.results.map((entry) => entry.id)).toContain(stored.entity.id);

      const task = extractStructuredPayload(
        (await client.callTool({
          name: 'task_create',
          arguments: {
            content: 'string coercion task',
            tags: '["task-coerced"]',
            full_response: 'true'
          }
        })) as ToolResultPayload
      ) as { entity: { id: string; version: number } };

      const tasks = extractStructuredPayload(
        (await client.callTool({
          name: 'task_list',
          arguments: {
            limit: '5',
            offset: '0',
            include_archived: 'false',
            full_response: 'false',
            toon: 'false'
          }
        })) as ToolResultPayload
      ) as { items: Array<{ id: string }> };
      expect(tasks.items.map((item) => item.id)).toContain(task.entity.id);

      const updatedTask = extractStructuredPayload(
        (await client.callTool({
          name: 'task_update',
          arguments: {
            id: task.entity.id,
            version: String(task.entity.version),
            tags: '["updated-coerced"]',
            full_response: 'true'
          }
        })) as ToolResultPayload
      ) as { entity: { version: number; tags: string[] } };
      expect(updatedTask.entity.tags).toEqual(['updated-coerced']);

      const link = extractStructuredPayload(
        (await client.callTool({
          name: 'link',
          arguments: {
            source_id: stored.entity.id,
            target_id: task.entity.id,
            relation: 'mentions',
            confidence: '0.75',
            full_response: 'true'
          }
        })) as ToolResultPayload
      ) as { edge: { id: string; confidence: number } };
      expect(link.edge.confidence).toBe(0.75);

      const expanded = extractStructuredPayload(
        (await client.callTool({
          name: 'expand',
          arguments: {
            entity_id: stored.entity.id,
            depth: '1',
            relation_types: '["mentions"]',
            full_response: 'false',
            toon: 'false'
          }
        })) as ToolResultPayload
      ) as { edges: Array<{ id: string }> };
      expect(expanded.edges.map((edge) => edge.id)).toContain(link.edge.id);

      const queue = extractStructuredPayload(
        (await client.callTool({
          name: 'queue',
          arguments: {
            include_failures: 'true',
            failure_limit: '1'
          }
        })) as ToolResultPayload
      );
      expect(queue).toHaveProperty('pending');
    } finally {
      await close();
    }
  }, 120_000);
```

- [ ] **Step 2: Add a failing test for malformed string rejection**

Insert this test next to the coercion test:

```ts
  it('rejects malformed stringified MCP arguments', async () => {
    const { client, close } = await createClient();

    try {
      const badLimit = (await client.callTool({
        name: 'search',
        arguments: {
          query: 'bad coercion',
          limit: 'three'
        }
      })) as ToolResultPayload;
      expect(badLimit.isError).toBe(true);

      const badBool = (await client.callTool({
        name: 'store',
        arguments: {
          type: 'memory',
          content: 'bad bool',
          skip_extraction: 'yes'
        }
      })) as ToolResultPayload;
      expect(badBool.isError).toBe(true);

      const badTags = (await client.callTool({
        name: 'store',
        arguments: {
          type: 'memory',
          content: 'bad tags',
          tags: '["ok", 3]'
        }
      })) as ToolResultPayload;
      expect(badTags.isError).toBe(true);
    } finally {
      await close();
    }
  }, 120_000);
```

- [ ] **Step 3: Run RED**

Run: `rtk npm test -- tests/contract/mcp-tools.test.ts -t "stringified MCP arguments|malformed stringified MCP arguments"`

Expected: the coercion test fails with Zod validation errors such as `Expected array, received string`, `Expected boolean, received string`, or `Expected number, received string`.

### Task 2: Shared MCP Schema Coercion

**Files:**
- Modify: `src/transport/mcp.ts`

- [ ] **Step 1: Add shared helpers near existing shared schemas**

```ts
const numericSchema = () => z.coerce.number();

const boolishSchema = () =>
  z.preprocess((value) => {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return value;
  }, z.boolean());

const stringArraySchema = () =>
  z.preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }

    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }, z.array(z.string()));
```

- [ ] **Step 2: Replace MCP schema fields**

Use `stringArraySchema()` for `tags`, `relation_types`, and similar top-level string arrays. Use `boolishSchema()` for booleans including `full_response`, `toon`, `skip_extraction`, `promotable`, `expand_graph`, `include_archived`, and `include_failures`. Use `numericSchema()` for user-provided numbers including `limit`, `offset`, `version`, `threshold`, `recency_weight`, `confidence`, `depth`, and `failure_limit`.

- [ ] **Step 3: Run GREEN**

Run: `rtk npm test -- tests/contract/mcp-tools.test.ts -t "stringified MCP arguments|malformed stringified MCP arguments"`

Expected: both new tests pass.

### Task 3: Verification

**Files:**
- Modify: `src/transport/mcp.ts`
- Modify: `tests/contract/mcp-tools.test.ts`

- [ ] **Step 1: Run focused MCP contract tests**

Run: `rtk npm test -- tests/contract/mcp-tools.test.ts -t "MCP tools"`

Expected: all MCP contract tests pass.

- [ ] **Step 2: Run typecheck**

Run: `rtk npm run typecheck`

Expected: TypeScript completes with no errors.

- [ ] **Step 3: Run whitespace check**

Run: `rtk git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 4: Commit implementation**

Run:

```bash
rtk git add src/transport/mcp.ts tests/contract/mcp-tools.test.ts docs/superpowers/plans/2026-06-11-mcp-input-coercion.md
rtk git commit -m "fix: coerce stringified MCP tool arguments"
```
