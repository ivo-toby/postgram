# Archived Entity Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exclude archived entities from all default list/search results across every transport layer, add an explicit opt-in flag at each layer, and add a `pgm-admin purge` command to permanently delete archived entities.

**Architecture:** Add `includeArchived?: boolean` to `ListEntitiesInput`, `ListTasksInput`, and `SearchInput` in the service layer — defaulting to `false`. REST, MCP, and CLI all thread the flag through from their inputs. The UI removes `archived` from the status chips and adds a standalone "Show archived" checkbox. The admin purge command does a direct `DELETE FROM entities WHERE status = 'archived' AND <filters>` — the existing `ON DELETE CASCADE` on `chunks`, `edges`, and `document_sources` handles all related rows automatically.

**Tech Stack:** TypeScript 5.9, Node 22, Hono, `neverthrow`, Zod, React, Vitest, `pg`

---

## File Map

| File | Change |
|------|--------|
| `src/services/entity-service.ts` | Add `includeArchived` to `ListEntitiesInput`; add SQL clause |
| `src/services/task-service.ts` | Add `includeArchived` to `ListTasksInput`; add SQL clause |
| `src/services/search-service.ts` | Add `includeArchived` to `SearchInput`; make archived exclusion conditional |
| `src/transport/rest.ts` | Parse `include_archived` query/body param; pass to services |
| `src/transport/mcp.ts` | Add `include_archived` to `search` and `task_list` tool schemas |
| `cli/src/client.ts` | Add `include_archived` to `listEntities`, `listTasks`, `searchEntities` |
| `cli/src/pgm.ts` | Add `--include-archived` to `list`, `search`, `task list` commands |
| `src/cli/admin/pgm-admin.ts` | Add `purge` command |
| `ui/src/lib/api.ts` | Add `include_archived` to `listEntities`, `searchEntities` |
| `ui/src/components/SearchPage.tsx` | Remove `archived` from status chips; add `showArchived` state + checkbox |
| `ui/src/components/ProjectorPage.tsx` | Pass `include_archived: false` explicitly to `listEntities` call |
| `tests/integration/entity-service.test.ts` | Tests for default exclusion and opt-in flag |
| `tests/integration/task-service.test.ts` | Tests for default exclusion and opt-in flag |
| `tests/integration/search-service.test.ts` | Tests for default exclusion and opt-in flag |
| `tests/integration/cli-admin.test.ts` | Tests for `purge` command |

---

## Task 1: Service layer — `listEntities`

**Files:**
- Modify: `src/services/entity-service.ts:61-69` (ListEntitiesInput type)
- Modify: `src/services/entity-service.ts:406-432` (SQL query and params)
- Modify: `tests/integration/entity-service.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('entity-service', ...)` block in `tests/integration/entity-service.test.ts`:

```typescript
it('excludes archived entities from listEntities by default', async () => {
  if (!database) throw new Error('test database not initialized');
  const auth = makeAuthContext();

  await storeEntity(database.pool, auth, {
    type: 'memory', content: 'active entity', visibility: 'personal'
  });
  const archivedResult = await storeEntity(database.pool, auth, {
    type: 'memory', content: 'archived entity', visibility: 'personal'
  });
  expect(archivedResult.isOk()).toBe(true);
  const archived = archivedResult._unsafeUnwrap();
  await softDeleteEntity(database.pool, auth, archived.id);

  const result = await listEntities(database.pool, auth, {});
  expect(result.isOk()).toBe(true);
  const ids = result._unsafeUnwrap().items.map(e => e.id);
  expect(ids).not.toContain(archived.id);
});

it('includes archived entities when includeArchived is true', async () => {
  if (!database) throw new Error('test database not initialized');
  const auth = makeAuthContext();

  const archivedResult = await storeEntity(database.pool, auth, {
    type: 'memory', content: 'archived entity', visibility: 'personal'
  });
  expect(archivedResult.isOk()).toBe(true);
  const archived = archivedResult._unsafeUnwrap();
  await softDeleteEntity(database.pool, auth, archived.id);

  const result = await listEntities(database.pool, auth, { includeArchived: true });
  expect(result.isOk()).toBe(true);
  const ids = result._unsafeUnwrap().items.map(e => e.id);
  expect(ids).toContain(archived.id);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/integration/entity-service.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: TypeScript error or test failure — `includeArchived` does not exist on `ListEntitiesInput`.

- [ ] **Step 3: Update `ListEntitiesInput` type**

In `src/services/entity-service.ts`, change lines 61–69:

```typescript
type ListEntitiesInput = {
  type?: EntityType | undefined;
  status?: EntityStatus | undefined;
  visibility?: Visibility | undefined;
  owner?: string | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  includeArchived?: boolean | undefined;
};
```

- [ ] **Step 4: Update the SQL query in `listEntities`**

In `src/services/entity-service.ts`, change the SQL and params block (starting at line ~405):

```typescript
      const result = await pool.query<EntityRow>(
        `
          SELECT
            *,
            COUNT(*) OVER()::text AS total_count
          FROM entities
          WHERE ($1::text IS NULL OR type = $1)
            AND ($2::text IS NULL OR status = $2)
            AND ($3::boolean = true OR status IS DISTINCT FROM 'archived')
            AND ($4::text IS NULL OR visibility = $4)
            AND ${ownerSqlCondition('owner', '$5')}
            AND ($6::text[] IS NULL OR tags @> $6)
            AND ($7::text[] IS NULL OR type = ANY($7))
            AND visibility = ANY($8)
          ORDER BY created_at DESC
          LIMIT $9
          OFFSET $10
        `,
        [
          input.type ?? null,
          input.status ?? null,
          input.includeArchived ?? false,
          input.visibility ?? null,
          input.owner ?? null,
          input.tags?.length ? input.tags : null,
          auth.allowedTypes,
          auth.allowedVisibility,
          limit,
          offset
        ]
      );
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run tests/integration/entity-service.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/entity-service.ts tests/integration/entity-service.test.ts
git commit -m "feat(entity-service): exclude archived entities by default in listEntities"
```

---

## Task 2: Service layer — `listTasks`

**Files:**
- Modify: `src/services/task-service.ts:44-49` (ListTasksInput type)
- Modify: `src/services/task-service.ts:171-192` (SQL query)
- Modify: `tests/integration/task-service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/task-service.test.ts` inside the main describe block:

```typescript
it('excludes archived tasks from listTasks by default', async () => {
  if (!database) throw new Error('test database not initialized');
  const auth = makeAuthContext();

  await createTask(database.pool, auth, {
    content: 'active task', visibility: 'personal'
  });
  const archivedResult = await createTask(database.pool, auth, {
    content: 'archived task', visibility: 'personal'
  });
  expect(archivedResult.isOk()).toBe(true);
  const archived = archivedResult._unsafeUnwrap();
  await softDeleteEntity(database.pool, auth, archived.id);

  const result = await listTasks(database.pool, auth, {});
  expect(result.isOk()).toBe(true);
  const ids = result._unsafeUnwrap().items.map(e => e.id);
  expect(ids).not.toContain(archived.id);
});

it('includes archived tasks when includeArchived is true', async () => {
  if (!database) throw new Error('test database not initialized');
  const auth = makeAuthContext();

  const archivedResult = await createTask(database.pool, auth, {
    content: 'archived task', visibility: 'personal'
  });
  expect(archivedResult.isOk()).toBe(true);
  const archived = archivedResult._unsafeUnwrap();
  await softDeleteEntity(database.pool, auth, archived.id);

  const result = await listTasks(database.pool, auth, { includeArchived: true });
  expect(result.isOk()).toBe(true);
  const ids = result._unsafeUnwrap().items.map(e => e.id);
  expect(ids).toContain(archived.id);
});
```

You will also need to import `softDeleteEntity` at the top of the test file if not already imported:

```typescript
import { softDeleteEntity } from '../../src/services/entity-service.js';
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/integration/task-service.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: TypeScript compile error — `includeArchived` does not exist on `ListTasksInput`.

- [ ] **Step 3: Update `ListTasksInput` type**

In `src/services/task-service.ts`, change lines 44–49:

```typescript
type ListTasksInput = {
  status?: EntityStatus | undefined;
  context?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  includeArchived?: boolean | undefined;
};
```

- [ ] **Step 4: Update the SQL query in `listTasks`**

In `src/services/task-service.ts`, change the query block (lines ~171–192):

```typescript
      const result = await pool.query<EntityRow>(
        `
          SELECT
            *,
            COUNT(*) OVER()::text AS total_count
          FROM entities
          WHERE type = 'task'
            AND ($1::text IS NULL OR status = $1)
            AND ($2::boolean = true OR status IS DISTINCT FROM 'archived')
            AND ($3::text IS NULL OR metadata->>'context' = $3)
            AND visibility = ANY($4)
          ORDER BY created_at DESC
          LIMIT $5
          OFFSET $6
        `,
        [
          input.status ?? null,
          input.includeArchived ?? false,
          input.context ?? null,
          auth.allowedVisibility,
          limit,
          offset
        ]
      );
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run tests/integration/task-service.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/task-service.ts tests/integration/task-service.test.ts
git commit -m "feat(task-service): exclude archived tasks by default in listTasks"
```

---

## Task 3: Service layer — `searchEntities`

**Files:**
- Modify: `src/services/search-service.ts:56-66` (SearchInput type)
- Modify: `src/services/search-service.ts:189` (WHERE clause)
- Modify: `tests/integration/search-service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/search-service.test.ts` inside the main describe block (check existing test structure — it uses a `runHybridSearch` export or the public `searchEntities`):

```typescript
it('excludes archived entities from search by default', async () => {
  if (!database) throw new Error('test database not initialized');
  const auth = makeAuthContext();

  await storeAndEmbed(database.pool, auth, {
    type: 'memory', content: 'unique phrase about parrots', visibility: 'personal'
  });
  const archivedResult = await storeAndEmbed(database.pool, auth, {
    type: 'memory', content: 'unique phrase about parrots archived', visibility: 'personal'
  });
  expect(archivedResult.isOk()).toBe(true);
  const archived = archivedResult._unsafeUnwrap();
  await softDeleteEntity(database.pool, auth, archived.id);

  const result = await searchEntities(database.pool, auth, {
    query: 'parrots'
  }, { embeddingService });
  expect(result.isOk()).toBe(true);
  const ids = result._unsafeUnwrap().results.map(r => r.entityId);
  expect(ids).not.toContain(archived.id);
});

it('includes archived entities in search when includeArchived is true', async () => {
  if (!database) throw new Error('test database not initialized');
  const auth = makeAuthContext();

  const archivedResult = await storeAndEmbed(database.pool, auth, {
    type: 'memory', content: 'unique phrase about parrots archived', visibility: 'personal'
  });
  expect(archivedResult.isOk()).toBe(true);
  const archived = archivedResult._unsafeUnwrap();
  await softDeleteEntity(database.pool, auth, archived.id);

  const result = await searchEntities(database.pool, auth, {
    query: 'parrots', includeArchived: true
  }, { embeddingService });
  expect(result.isOk()).toBe(true);
  const ids = result._unsafeUnwrap().results.map(r => r.entityId);
  expect(ids).toContain(archived.id);
});
```

> Note: Look at the existing test file to find the `storeAndEmbed` helper and `embeddingService` — they are already used in existing tests there.

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/integration/search-service.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: TypeScript error — `includeArchived` does not exist on `SearchInput`.

- [ ] **Step 3: Add `includeArchived` to `SearchInput`**

In `src/services/search-service.ts`, change lines 56–66:

```typescript
type SearchInput = {
  query: string;
  type?: EntityType | undefined;
  tags?: string[] | undefined;
  visibility?: Visibility | undefined;
  owner?: string | undefined;
  limit?: number | undefined;
  threshold?: number | undefined;
  recencyWeight?: number | undefined;
  expandGraph?: boolean | undefined;
  includeArchived?: boolean | undefined;
};
```

- [ ] **Step 4: Make the archived exclusion conditional in `runHybridSearch`**

In `src/services/search-service.ts`, in the `runHybridSearch` function, change the WHERE clause. The current line 189 reads:

```sql
      WHERE e.status IS DISTINCT FROM 'archived'
```

Replace with:

```sql
      WHERE ($10::boolean = true OR e.status IS DISTINCT FROM 'archived')
```

Then add `input.includeArchived ?? false` as the 10th parameter (after `candidateLimit` which is currently `$9`). The full params array passed to `pool.query` needs the new value appended. Find the array that currently ends with `candidateLimit` and add the new param before it — but note $10 must be in the right position. Here is the updated params array:

```typescript
    [
      vectorToSql(ctx.queryEmbedding),   // $1
      input.type ?? null,                 // $2
      input.tags?.length ? input.tags : null, // $3
      auth.allowedTypes,                  // $4
      auth.allowedVisibility,             // $5
      input.visibility ?? null,           // $6
      input.owner ?? null,                // $7
      ctx.queryText,                      // $8
      candidateLimit,                     // $9
      input.includeArchived ?? false      // $10
    ]
```

- [ ] **Step 5: Thread `input` through to `runHybridSearch`**

`runHybridSearch` already receives `input: SearchInput` as a parameter (line 175), so `input.includeArchived` is already accessible inside that function.

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx vitest run tests/integration/search-service.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/services/search-service.ts tests/integration/search-service.test.ts
git commit -m "feat(search-service): exclude archived entities by default in searchEntities"
```

---

## Task 4: REST transport

**Files:**
- Modify: `src/transport/rest.ts:67-77` (searchEntitiesSchema)
- Modify: `src/transport/rest.ts:299-343` (GET /api/entities handler)
- Modify: `src/transport/rest.ts:345-380` (POST /api/search handler)
- Modify: `src/transport/rest.ts:402-427` (GET /api/tasks handler)

No new tests needed here — the REST integration is tested in `tests/contract/rest-api.test.ts` which covers the contract but not the archived-exclusion behavior (that's service-level). The service tests above are sufficient coverage.

- [ ] **Step 1: Add `include_archived` to `searchEntitiesSchema`**

In `src/transport/rest.ts`, change lines 67–77:

```typescript
const searchEntitiesSchema = z.object({
  query: z.string().min(1),
  type: entityTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  visibility: visibilitySchema.optional(),
  owner: ownerSchema.optional(),
  limit: z.number().int().positive().max(50).optional(),
  threshold: z.number().min(0).max(1).optional(),
  recency_weight: z.number().min(0).optional(),
  expand_graph: z.boolean().optional(),
  include_archived: z.boolean().optional()
});
```

- [ ] **Step 2: Thread `include_archived` through the `GET /api/entities` handler**

In `src/transport/rest.ts`, in the `GET /api/entities` handler (line ~299–343), add parsing and pass-through:

```typescript
  app.get('/api/entities', async (c) => {
    const auth = c.get('auth');
    const tags = c.req.query('tags');
    const type = c.req.query('type');
    const status = c.req.query('status');
    const visibility = c.req.query('visibility');
    const owner = c.req.query('owner');
    const includeArchived = c.req.query('include_archived') === 'true';

    if (type && !entityTypeSchema.safeParse(type).success) {
      throw toValidationError('Invalid entity type');
    }

    if (status && !statusSchema.safeParse(status).success) {
      throw toValidationError('Invalid entity status');
    }

    if (visibility && !visibilitySchema.safeParse(visibility).success) {
      throw toValidationError('Invalid visibility');
    }

    if (owner && !ownerSchema.safeParse(owner).success) {
      throw toValidationError('Invalid owner');
    }

    const result = await listEntities(pool, auth, {
      type: type as EntityType | undefined,
      status: status as EntityStatus | undefined,
      visibility: visibility as Visibility | undefined,
      owner,
      tags: tags ? tags.split(',').filter(Boolean) : undefined,
      limit: parseQueryNumber(c.req.query('limit'), 50),
      offset: parseQueryNumber(c.req.query('offset'), 0),
      includeArchived
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      items: result.value.items.map(toStoredEntity),
      total: result.value.total,
      limit: result.value.limit,
      offset: result.value.offset
    });
  });
```

- [ ] **Step 3: Thread `include_archived` through the `POST /api/search` handler**

In `src/transport/rest.ts`, in the `POST /api/search` handler (lines ~345–380):

```typescript
    const result = await searchEntities(
      pool,
      auth,
      {
        query: body.query,
        type: body.type,
        tags: body.tags,
        visibility: body.visibility,
        owner: body.owner,
        limit: body.limit,
        threshold: body.threshold,
        recencyWeight: body.recency_weight,
        expandGraph: body.expand_graph,
        includeArchived: body.include_archived
      },
      {
        embeddingService: options.embeddingService
      }
    );
```

- [ ] **Step 4: Thread `include_archived` through the `GET /api/tasks` handler**

In `src/transport/rest.ts`, in the `GET /api/tasks` handler (lines ~402–427):

```typescript
  app.get('/api/tasks', async (c) => {
    const auth = c.get('auth');
    const status = c.req.query('status');
    const includeArchived = c.req.query('include_archived') === 'true';

    if (status && !statusSchema.safeParse(status).success) {
      throw toValidationError('Invalid entity status');
    }

    const result = await listTasks(pool, auth, {
      status: status as EntityStatus | undefined,
      context: c.req.query('context') ?? undefined,
      limit: parseQueryNumber(c.req.query('limit'), 50),
      offset: parseQueryNumber(c.req.query('offset'), 0),
      includeArchived
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      items: result.value.items.map(toStoredEntity),
      total: result.value.total,
      limit: result.value.limit,
      offset: result.value.offset
    });
  });
```

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/transport/rest.ts
git commit -m "feat(rest): add include_archived param to list and search endpoints"
```

---

## Task 5: MCP transport

**Files:**
- Modify: `src/transport/mcp.ts:189-199` (search tool inputSchema)
- Modify: `src/transport/mcp.ts:308-313` (task_list tool inputSchema)

- [ ] **Step 1: Add `include_archived` to the `search` tool**

In `src/transport/mcp.ts`, change the `search` tool inputSchema (lines ~189–199):

```typescript
      inputSchema: {
        query: z.string().min(1),
        type: entityTypeSchema.optional(),
        tags: z.array(z.string()).optional(),
        visibility: visibilitySchema.optional(),
        owner: ownerSchema.optional(),
        limit: z.number().int().positive().optional(),
        threshold: z.number().min(0).max(1).optional(),
        recency_weight: z.number().min(0).optional(),
        expand_graph: z.boolean().optional(),
        include_archived: z.boolean().optional()
      }
```

And thread it through in the service call (lines ~203–216):

```typescript
        searchEntities(
          pool,
          auth,
          {
            query: args.query,
            type: args.type,
            tags: args.tags,
            visibility: args.visibility,
            owner: args.owner,
            limit: args.limit,
            threshold: args.threshold,
            recencyWeight: args.recency_weight,
            expandGraph: args.expand_graph,
            includeArchived: args.include_archived
          },
          {
            embeddingService: options.embeddingService
          }
        ),
```

- [ ] **Step 2: Add `include_archived` to the `task_list` tool**

In `src/transport/mcp.ts`, change the `task_list` tool inputSchema (lines ~308–313):

```typescript
      inputSchema: {
        status: statusSchema.optional(),
        context: z.string().optional(),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        include_archived: z.boolean().optional()
      }
```

And thread through in the service call (lines ~316–322):

```typescript
        listTasks(pool, auth, {
          status: args.status,
          context: args.context,
          limit: args.limit,
          offset: args.offset,
          includeArchived: args.include_archived
        }),
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/transport/mcp.ts
git commit -m "feat(mcp): add include_archived param to search and task_list tools"
```

---

## Task 6: CLI client and pgm commands

**Files:**
- Modify: `cli/src/client.ts:136-150` (searchEntities)
- Modify: `cli/src/client.ts:178-216` (listEntities)
- Modify: `cli/src/client.ts:232-257` (listTasks)
- Modify: `cli/src/pgm.ts:319-346` (search command)
- Modify: `cli/src/pgm.ts:363-411` (list command)
- Modify: `cli/src/pgm.ts:507-524` (task list command)

- [ ] **Step 1: Add `include_archived` to `searchEntities` in `cli/src/client.ts`**

Change the `searchEntities` method (lines ~136–150):

```typescript
    searchEntities(input: {
      query: string;
      type?: string | undefined;
      tags?: string[] | undefined;
      visibility?: string | undefined;
      owner?: string | undefined;
      limit?: number | undefined;
      threshold?: number | undefined;
      recency_weight?: number | undefined;
      expand_graph?: boolean | undefined;
      include_archived?: boolean | undefined;
    }) {
      return request<SearchResponse>(options, '/api/search', {
        method: 'POST',
        body: input
      });
    },
```

- [ ] **Step 2: Add `include_archived` to `listEntities` in `cli/src/client.ts`**

Change the `listEntities` method signature (lines ~178–186) and add query param:

```typescript
    listEntities(input: {
      type?: string | undefined;
      status?: string | undefined;
      visibility?: string | undefined;
      owner?: string | undefined;
      tags?: string[] | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
      include_archived?: boolean | undefined;
    } = {}) {
      const params = new URLSearchParams();
      if (input.type) params.set('type', input.type);
      if (input.status) params.set('status', input.status);
      if (input.visibility) params.set('visibility', input.visibility);
      if (input.owner) params.set('owner', input.owner);
      if (input.tags?.length) params.set('tags', input.tags.join(','));
      if (input.limit !== undefined) params.set('limit', String(input.limit));
      if (input.offset !== undefined) params.set('offset', String(input.offset));
      if (input.include_archived) params.set('include_archived', 'true');

      const query = params.toString();
      return request<{
        items: StoredEntityResponse['entity'][];
        total: number;
        limit: number;
        offset: number;
      }>(options, `/api/entities${query ? `?${query}` : ''}`);
    },
```

- [ ] **Step 3: Add `include_archived` to `listTasks` in `cli/src/client.ts`**

Change the `listTasks` method (lines ~232–257):

```typescript
    listTasks(input: {
      status?: string | undefined;
      context?: string | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
      include_archived?: boolean | undefined;
    } = {}) {
      const params = new URLSearchParams();
      if (input.status) params.set('status', input.status);
      if (input.context) params.set('context', input.context);
      if (input.limit !== undefined) params.set('limit', String(input.limit));
      if (input.offset !== undefined) params.set('offset', String(input.offset));
      if (input.include_archived) params.set('include_archived', 'true');

      return request<{
        items: StoredEntityResponse['entity'][];
        total: number;
        limit: number;
        offset: number;
      }>(options, `/api/tasks?${params.toString()}`);
    },
```

- [ ] **Step 4: Add `--include-archived` to `pgm search` command**

In `cli/src/pgm.ts`, change the `search` command (lines ~319–346):

```typescript
program
  .command('search')
  .description('Search stored entities')
  .argument('query', 'search query')
  .option('--type <type>', 'entity type')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--visibility <visibility>', 'entity visibility filter')
  .option('--owner <owner>', 'entity owner filter')
  .option('--limit <limit>', 'result limit', '10')
  .option('--threshold <threshold>', 'similarity threshold', '0.35')
  .option('--recency-weight <recencyWeight>', 'recency weight', '0.1')
  .option('--expand-graph', 'include graph-connected entities in results')
  .option('--include-archived', 'include archived entities in results')
  .action(async (query, options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.searchEntities({
        query,
        type: options.type,
        tags: parseCommaList(options.tags),
        visibility: options.visibility,
        owner: options.owner,
        limit: Number(options.limit),
        threshold: Number(options.threshold),
        recency_weight: Number(options.recencyWeight),
        expand_graph: options.expandGraph === true ? true : undefined,
        include_archived: options.includeArchived === true ? true : undefined
      });

      return json ? body : formatSearchResults(body.results);
    });
  });
```

- [ ] **Step 5: Add `--include-archived` to `pgm list` command**

In `cli/src/pgm.ts`, change the `list` command (lines ~363–411):

```typescript
program
  .command('list')
  .description('List entities')
  .option('--type <type>', 'filter by type')
  .option('--status <status>', 'filter by status')
  .option('--visibility <visibility>', 'filter by visibility')
  .option('--owner <owner>', 'filter by owner')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--limit <limit>', 'result limit', '50')
  .option('--offset <offset>', 'result offset', '0')
  .option('--include-archived', 'include archived entities')
  .action(async (options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.listEntities({
        type: options.type,
        status: options.status,
        visibility: options.visibility,
        owner: options.owner,
        tags: parseCommaList(options.tags),
        limit: Number(options.limit),
        offset: Number(options.offset),
        include_archived: options.includeArchived === true ? true : undefined
      });

      if (json) return body;

      if (body.items.length === 0) return ['No entities'];

      const lines = body.items.flatMap((item) => {
        const preview = item.content
          ? item.content.length > 60
            ? `${item.content.slice(0, 60)}...`
            : item.content
          : '-';
        return [
          `${item.type} ${shortId(item.id)}  ${preview}`,
          `  tags: ${item.tags.join(', ') || '-'} | owner=${item.owner ?? 'shared'} | ${item.visibility} | ${item.created_at.slice(0, 10)}`
        ];
      });

      lines.push('');
      lines.push(
        `${body.total} entities (showing ${body.offset + 1}-${body.offset + body.items.length})`
      );

      return lines;
    });
  });
```

- [ ] **Step 6: Add `--include-archived` to `pgm task list` command**

In `cli/src/pgm.ts`, change the task `list` command (lines ~507–524):

```typescript
taskCommand
  .command('list')
  .description('List tasks')
  .option('--status <status>', 'filter by status')
  .option('--context <context>', 'filter by context')
  .option('--limit <limit>', 'result limit', '50')
  .option('--offset <offset>', 'result offset', '0')
  .option('--include-archived', 'include archived tasks')
  .action(async (options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.listTasks({
        status: options.status,
        context: options.context,
        limit: Number(options.limit),
        offset: Number(options.offset),
        include_archived: options.includeArchived === true ? true : undefined
      });

      return json ? body : formatTaskList(body.items);
    });
  });
```

- [ ] **Step 7: Run CLI typecheck**

```bash
cd cli && npx tsc --noEmit 2>&1 | head -30 && cd ..
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add cli/src/client.ts cli/src/pgm.ts
git commit -m "feat(cli): add --include-archived flag to list, search, and task list commands"
```

---

## Task 7: Admin purge command

**Files:**
- Modify: `src/cli/admin/pgm-admin.ts` (add `purge` command after the last command)
- Modify: `tests/integration/cli-admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/cli-admin.test.ts` inside the main describe block:

```typescript
describe('purge command', () => {
  it('permanently deletes archived entities', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const dbUrl = getDatabaseUrl(database);

    // Create and archive two entities
    const r1 = await storeEntity(database.pool, auth, {
      type: 'memory', content: 'to be purged', visibility: 'personal'
    });
    const r2 = await storeEntity(database.pool, auth, {
      type: 'memory', content: 'also purged', visibility: 'personal'
    });
    expect(r1.isOk()).toBe(true);
    expect(r2.isOk()).toBe(true);
    const e1 = r1._unsafeUnwrap();
    const e2 = r2._unsafeUnwrap();

    // Archive both
    await database.pool.query(
      "UPDATE entities SET status = 'archived' WHERE id = ANY($1)",
      [[e1.id, e2.id]]
    );

    // Purge
    const { stdout } = await runAdmin(['purge', '--all'], { DATABASE_URL: dbUrl });
    expect(stdout).toMatch(/Permanently deleted 2/);

    // Confirm they're gone
    const check = await database.pool.query(
      'SELECT id FROM entities WHERE id = ANY($1)', [[e1.id, e2.id]]
    );
    expect(check.rows).toHaveLength(0);
  });

  it('respects --type filter', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const dbUrl = getDatabaseUrl(database);

    const r1 = await storeEntity(database.pool, auth, {
      type: 'memory', content: 'memory entity', visibility: 'personal'
    });
    const r2 = await storeEntity(database.pool, auth, {
      type: 'document', content: 'document entity', visibility: 'personal'
    });
    expect(r1.isOk()).toBe(true);
    expect(r2.isOk()).toBe(true);
    const e1 = r1._unsafeUnwrap();
    const e2 = r2._unsafeUnwrap();

    await database.pool.query(
      "UPDATE entities SET status = 'archived' WHERE id = ANY($1)",
      [[e1.id, e2.id]]
    );

    const { stdout } = await runAdmin(['purge', '--all', '--type', 'memory'], { DATABASE_URL: dbUrl });
    expect(stdout).toMatch(/Permanently deleted 1/);

    const check = await database.pool.query(
      'SELECT id, type FROM entities WHERE id = ANY($1)', [[e1.id, e2.id]]
    );
    expect(check.rows).toHaveLength(1);
    expect(check.rows[0].type).toBe('document');
  });

  it('dry-run does not delete anything', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const dbUrl = getDatabaseUrl(database);

    const r1 = await storeEntity(database.pool, auth, {
      type: 'memory', content: 'dry run target', visibility: 'personal'
    });
    expect(r1.isOk()).toBe(true);
    const e1 = r1._unsafeUnwrap();

    await database.pool.query(
      "UPDATE entities SET status = 'archived' WHERE id = $1", [e1.id]
    );

    const { stdout } = await runAdmin(['purge', '--all', '--dry-run'], { DATABASE_URL: dbUrl });
    expect(stdout).toMatch(/Would delete 1/);

    const check = await database.pool.query('SELECT id FROM entities WHERE id = $1', [e1.id]);
    expect(check.rows).toHaveLength(1);
  });

  it('requires --all or --type or --older-than to confirm scope', async () => {
    if (!database) throw new Error('test database not initialized');
    const dbUrl = getDatabaseUrl(database);

    await expect(runAdmin(['purge'], { DATABASE_URL: dbUrl })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/integration/cli-admin.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: tests fail — `purge` command does not exist yet.

- [ ] **Step 3: Implement the `purge` command**

In `src/cli/admin/pgm-admin.ts`, add this after the last `program` command (after the `reextract` command):

```typescript
function parseDuration(value: string): string {
  const match = /^(\d+)(d|w)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration '${value}'. Use format like '30d' or '4w'.`);
  }
  const [, amount, unit] = match;
  if (unit === 'd') return `${amount} days`;
  return `${Number(amount) * 7} days`;
}

program
  .command('purge')
  .description('Permanently delete archived entities (with all related chunks, edges, document_sources)')
  .option('--all', 'purge all archived entities')
  .option('--type <type>', 'limit purge to this entity type')
  .option('--older-than <duration>', 'only purge archived items older than this (e.g. 30d, 4w)')
  .option('--owner <owner>', 'limit purge to this owner')
  .option('--dry-run', 'print what would be deleted without deleting')
  .action(async (options, command) => {
    const json = isJsonMode(command);

    if (!options.all && !options.type && !options.olderThan) {
      await handleCliFailure(
        new Error('Specify --all, --type <type>, or --older-than <duration> to confirm scope'),
        json
      );
      return;
    }

    await runWithPool(json, async (pool) => {
      const conditions: string[] = ["status = 'archived'"];
      const params: unknown[] = [];

      if (options.type) {
        params.push(options.type);
        conditions.push(`type = $${params.length}`);
      }

      if (options.owner) {
        params.push(options.owner);
        conditions.push(`owner = $${params.length}`);
      }

      if (options.olderThan) {
        const interval = parseDuration(options.olderThan);
        params.push(interval);
        conditions.push(`updated_at < NOW() - $${params.length}::interval`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM entities WHERE ${whereClause}`,
        params
      );
      const count = Number(countResult.rows[0]?.count ?? 0);

      if (options.dryRun) {
        await appendAuditEntry(pool, {
          operation: 'purge.dry_run',
          details: {
            wouldDelete: count,
            type: options.type ?? 'all',
            olderThan: options.olderThan ?? null,
            owner: options.owner ?? null
          }
        });

        return json
          ? { dryRun: true, wouldDelete: count }
          : [`Would delete ${count} archived entit${count === 1 ? 'y' : 'ies'} (dry run — no changes made)`];
      }

      const deleteResult = await pool.query(
        `DELETE FROM entities WHERE ${whereClause}`,
        params
      );
      const deleted = deleteResult.rowCount ?? 0;

      await appendAuditEntry(pool, {
        operation: 'purge',
        details: {
          deleted,
          type: options.type ?? 'all',
          olderThan: options.olderThan ?? null,
          owner: options.owner ?? null
        }
      });

      return json
        ? { deleted }
        : [`Permanently deleted ${deleted} archived entit${deleted === 1 ? 'y' : 'ies'}`];
    });
  });
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/integration/cli-admin.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/admin/pgm-admin.ts tests/integration/cli-admin.test.ts
git commit -m "feat(admin): add purge command to permanently delete archived entities"
```

---

## Task 8: UI — `api.ts` and `SearchPage.tsx`

**Files:**
- Modify: `ui/src/lib/api.ts:54-71` (listEntities)
- Modify: `ui/src/lib/api.ts:107-118` (searchEntities)
- Modify: `ui/src/components/SearchPage.tsx:12` (ALL_STATUSES)
- Modify: `ui/src/components/SearchPage.tsx:24-50` (Filters type and initialFilters)
- Modify: `ui/src/components/SearchPage.tsx:92-146` (fetchPage)
- Modify: `ui/src/components/SearchPage.tsx:268-275` (activeFilterCount)
- Modify: `ui/src/components/SearchPage.tsx:370-387` (status filter section)
- Modify: `ui/src/components/ProjectorPage.tsx:184` (listEntities call)

No automated tests for the UI layer — verify by running the dev server.

- [ ] **Step 1: Add `include_archived` to `listEntities` in `ui/src/lib/api.ts`**

Change the `listEntities` method (lines ~54–71):

```typescript
    listEntities(params: {
      type?: string;
      status?: string;
      visibility?: string;
      owner?: string;
      tags?: string[];
      limit?: number;
      offset?: number;
      include_archived?: boolean;
    }) {
      const qs = new URLSearchParams();
      if (params.type) qs.set('type', params.type);
      if (params.status) qs.set('status', params.status);
      if (params.visibility) qs.set('visibility', params.visibility);
      if (params.owner) qs.set('owner', params.owner);
      if (params.tags?.length) qs.set('tags', params.tags.join(','));
      qs.set('limit', String(params.limit ?? 100));
      qs.set('offset', String(params.offset ?? 0));
      if (params.include_archived) qs.set('include_archived', 'true');
      return r<ListResponse<Entity>>(`/api/entities?${qs}`);
    },
```

- [ ] **Step 2: Add `include_archived` to `searchEntities` in `ui/src/lib/api.ts`**

Change the `searchEntities` method (lines ~107–118):

```typescript
    searchEntities(input: {
      query: string;
      type?: string;
      tags?: string[];
      visibility?: string;
      owner?: string;
      limit?: number;
      threshold?: number;
      recency_weight?: number;
      expand_graph?: boolean;
      include_archived?: boolean;
    }) {
      return r<{ results: SearchResult[] }>('/api/search', { method: 'POST', body: input });
    },
```

- [ ] **Step 3: Update `SearchPage.tsx` — remove `archived` from chips, add `showArchived` state**

In `ui/src/components/SearchPage.tsx`:

**Line 12** — remove `'archived'` from `ALL_STATUSES`:

```typescript
const ALL_STATUSES = ['active', 'done', 'inbox', 'next', 'waiting', 'scheduled', 'someday'];
```

**Lines 24–36** — add `showArchived` to the `Filters` type:

```typescript
type Filters = {
  query: string;
  mode: SearchMode;
  types: Set<string>;
  statuses: Set<string>;
  visibility: string;
  owner: string;
  tags: string[];
  tagInput: string;
  threshold: number;
  recencyWeight: number;
  expandGraph: boolean;
  showArchived: boolean;
};
```

**Lines 38–50** — add `showArchived: false` to `initialFilters`:

```typescript
const initialFilters: Filters = {
  query: '',
  mode: 'semantic',
  types: new Set(),
  statuses: new Set(),
  visibility: '',
  owner: '',
  tags: [],
  tagInput: '',
  threshold: 0,
  recencyWeight: 0,
  expandGraph: true,
  showArchived: false,
};
```

- [ ] **Step 4: Thread `showArchived` into `fetchPage` calls in `SearchPage.tsx`**

In the `fetchPage` function (lines ~92–146), add `include_archived` to both the semantic search call and the list call:

For the semantic search branch (lines ~96–116):

```typescript
      const res = await api.searchEntities({
        query: f.query,
        ...(primaryType ? { type: primaryType } : {}),
        ...(f.tags.length ? { tags: f.tags } : {}),
        ...(f.visibility ? { visibility: f.visibility } : {}),
        ...(f.owner.trim() ? { owner: f.owner.trim() } : {}),
        limit: SEMANTIC_MAX,
        ...(f.threshold > 0 ? { threshold: f.threshold } : {}),
        ...(f.recencyWeight > 0 ? { recency_weight: f.recencyWeight } : {}),
        expand_graph: f.expandGraph,
        ...(f.showArchived ? { include_archived: true } : {})
      });
```

For the list branch (lines ~119–129):

```typescript
      const res = await api.listEntities({
        ...(primaryType ? { type: primaryType } : {}),
        ...(primaryStatus ? { status: primaryStatus } : {}),
        ...(f.visibility ? { visibility: f.visibility } : {}),
        ...(f.owner.trim() ? { owner: f.owner.trim() } : {}),
        ...(f.tags.length ? { tags: f.tags } : {}),
        limit: PAGE_SIZE,
        offset,
        ...(f.showArchived ? { include_archived: true } : {})
      });
```

- [ ] **Step 5: Update `activeFilterCount` to include `showArchived`**

In `SearchPage.tsx` (lines ~268–275):

```typescript
  const activeFilterCount =
    filters.types.size +
    filters.statuses.size +
    filters.tags.length +
    (filters.visibility ? 1 : 0) +
    (filters.owner.trim() ? 1 : 0) +
    (filters.threshold > 0 ? 1 : 0) +
    (filters.recencyWeight > 0 ? 1 : 0) +
    (filters.showArchived ? 1 : 0);
```

- [ ] **Step 6: Replace the status section in the filter panel with chips + "Show archived" checkbox**

In `SearchPage.tsx`, replace the `<Section title="Status">` block (lines ~370–387):

```tsx
              <Section title="Status">
                <div className="flex flex-wrap gap-1.5">
                  {ALL_STATUSES.map(s => {
                    const active = filters.statuses.has(s);
                    return (
                      <button
                        key={s}
                        onClick={() => toggleInSet('statuses', s)}
                        className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                          active ? 'bg-blue-500/20 border-blue-500 text-blue-300' : 'border-gray-700 text-gray-400 hover:text-white'
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-400 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.showArchived}
                    onChange={e => update('showArchived', e.target.checked)}
                    className="accent-blue-500"
                  />
                  Show archived
                </label>
              </Section>
```

- [ ] **Step 7: Update `ProjectorPage.tsx` to pass `include_archived: false` explicitly**

In `ui/src/components/ProjectorPage.tsx`, change line ~184:

```typescript
          const res = await api.listEntities({ limit: ENTITY_PAGE_SIZE, offset, include_archived: false });
```

> This makes the exclusion explicit in the projector. The projector does not have a "show archived" toggle — archived entities are intentionally excluded from the embedding visualization.

- [ ] **Step 8: Run UI typecheck**

```bash
cd ui && npx tsc --noEmit 2>&1 | head -30 && cd ..
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add ui/src/lib/api.ts ui/src/components/SearchPage.tsx ui/src/components/ProjectorPage.tsx
git commit -m "feat(ui): exclude archived entities by default, add Show archived toggle"
```

---

## Task 9: Full test run and typecheck

- [ ] **Step 1: Run all unit and integration tests**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -40
```

Expected: all tests pass.

- [ ] **Step 2: Run server typecheck**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Run CLI typecheck**

```bash
cd cli && npx tsc --noEmit 2>&1 | head -30 && cd ..
```

Expected: no errors.

- [ ] **Step 4: Run UI typecheck**

```bash
cd ui && npx tsc --noEmit 2>&1 | head -30 && cd ..
```

Expected: no errors.

- [ ] **Step 5: Commit (if any fixes were needed)**

```bash
git add -p
git commit -m "fix: typecheck and test cleanup for archived-visibility feature"
```
