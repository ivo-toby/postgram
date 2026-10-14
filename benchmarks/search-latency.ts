import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import type { Pool, PoolClient } from 'pg';

import type { AuthContext } from '../src/auth/types.js';
import {
  createEmbeddingService,
  vectorToSql
} from '../src/services/embedding-service.js';
import { searchEntities } from '../src/services/search-service.js';
import {
  createTestDatabase,
  resetTestDatabase
} from '../tests/helpers/postgres.js';

const ENTITY_COUNT = 5_000;
const CHUNK_COUNT = 6_000;
const WARMUP_RUNS = 5;
const SAMPLE_RUNS = 20;
const LONG_KEYWORD_QUERY = [
  'rare-keyword-42',
  ...Array.from({ length: 17 }, (_, index) => `rare-term-${index}`)
].join(' ');
const PASTED_QUERY_CORE_TERMS = [
  'postgres',
  'search',
  'latency',
  'benchmark',
  'entity',
  'migration',
  'index',
  'database',
  'vector',
  'keyword',
  'candidate',
  'authorization',
  'visibility',
  'ranking',
  'recall',
  'memory',
  'project',
  'document',
  'task',
  'semantic',
  'query',
  'embedding',
  'cache',
  'provider'
] as const;

function alphabeticSuffix(index: number): string {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

const PASTED_QUERY_TAIL_TERMS = Array.from(
  { length: 276 },
  (_, index) => `rarecompoundterm${alphabeticSuffix(index)}`
);
const PASTED_QUERY_TERMS = [
  ...PASTED_QUERY_CORE_TERMS,
  ...PASTED_QUERY_TAIL_TERMS
];
const PASTED_QUERY = PASTED_QUERY_TERMS.join(' ');
const PASTED_QUERY_INPUT_WORD_COUNT = PASTED_QUERY_TERMS.length;
const PASTED_QUERY_INPUT_DISTINCT_TERM_COUNT = new Set(PASTED_QUERY_TERMS).size;
const PASTED_QUERY_RETAINED_TERM_CAP = 24;

type CapturedQuery = { text: string; values: unknown[] };
type ExplainStrategy = 'hnsw' | 'exact';
type Profile = {
  p50_ms: number;
  p95_ms: number;
  min_ms: number;
  max_ms: number;
};
type ProfileStats = {
  embeddingCalls: number;
  strategy: string | null;
};

const auth: AuthContext = {
  apiKeyId: '00000000-0000-0000-0000-00000000b001',
  keyName: 'benchmark-key',
  clientId: 'benchmark-key',
  scopes: ['read'],
  allowedTypes: null,
  allowedVisibility: ['personal', 'work', 'shared']
};

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

function summarize(samples: number[]): Profile {
  const sorted = samples.slice().sort((left, right) => left - right);
  return {
    p50_ms: Number(percentile(sorted, 0.5).toFixed(2)),
    p95_ms: Number(percentile(sorted, 0.95).toFixed(2)),
    min_ms: Number((sorted[0] ?? 0).toFixed(2)),
    max_ms: Number((sorted.at(-1) ?? 0).toFixed(2))
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectVectorStrategy(text: string): ExplainStrategy | null {
  if (text.includes('OFFSET 0')) return 'hnsw';
  if (text.includes('(c.embedding <=> $1::vector) + 0')) return 'exact';
  return null;
}

async function seed(pool: Pool): Promise<void> {
  await resetTestDatabase(pool);
  await pool.query(
    `
      INSERT INTO entities (
        id,
        type,
        content,
        visibility,
        status,
        enrichment_status,
        tags,
        metadata,
        created_at,
        updated_at
      )
      SELECT
        gen_random_uuid(),
        'memory',
        'postgres search latency benchmark entity ' || value || ' ' ||
          repeat('knowledge memory context ', 40),
        CASE
          WHEN value % 3 = 0 THEN 'shared'
          WHEN value % 3 = 1 THEN 'personal'
          ELSE 'work'
        END,
        'active',
        'completed',
        ARRAY['benchmark', 'bucket-' || (value % 10)],
        '{}'::jsonb,
        now() - (value || ' minutes')::interval,
        now()
      FROM generate_series(1, $1::integer) AS value
    `,
    [ENTITY_COUNT]
  );

  await pool.query(
    `
      INSERT INTO chunks (
        entity_id,
        chunk_index,
        content,
        embedding,
        model_id,
        token_count
      )
      SELECT
        e.id,
        0,
        left(e.content, 500),
        (
          ARRAY[
            ((e.value % 17) + 1)::real / 17,
            ((e.value % 31) + 1)::real / 31
          ]::real[] || array_fill(0.01::real, ARRAY[1534])
        )::vector,
        (SELECT id FROM embedding_models WHERE is_active = true),
        100
      FROM (
        SELECT
          entities.*,
          row_number() OVER (ORDER BY id) AS value
        FROM entities
      ) e
    `
  );

  await pool.query(
    `
      INSERT INTO chunks (
        entity_id,
        chunk_index,
        content,
        embedding,
        model_id,
        token_count
      )
      SELECT
        e.id,
        1,
        right(e.content, 500),
        (
          ARRAY[
            ((e.value % 19) + 1)::real / 19,
            ((e.value % 29) + 1)::real / 29
          ]::real[] || array_fill(0.011::real, ARRAY[1534])
        )::vector,
        (SELECT id FROM embedding_models WHERE is_active = true),
        100
      FROM (
        SELECT
          entities.*,
          row_number() OVER (ORDER BY id) AS value
        FROM entities
      ) e
      ORDER BY e.id
      LIMIT $1
    `,
    [CHUNK_COUNT - ENTITY_COUNT]
  );
  await pool.query('ANALYZE entities');
  await pool.query('ANALYZE chunks');
}

function captureSearchQueries(pool: Pool): {
  pool: Pool;
  captured: {
    exact?: CapturedQuery;
    hnsw?: CapturedQuery;
    longKeyword?: CapturedQuery;
    pastedQuery?: CapturedQuery;
  };
  counts: { total: number };
} {
  const captured: {
    exact?: CapturedQuery;
    hnsw?: CapturedQuery;
    longKeyword?: CapturedQuery;
    pastedQuery?: CapturedQuery;
  } = {};
  const counts = { total: 0 };
  const capture = (text: string, values?: unknown[]): void => {
    counts.total += 1;
    if (text.includes('ROW_NUMBER() OVER')) {
      const strategy = detectVectorStrategy(text);
      if (strategy) {
        captured[strategy] ??= { text, values: values ?? [] };
        if (values?.some((value) => value === LONG_KEYWORD_QUERY)) {
          captured.longKeyword = { text, values: values ?? [] };
        }
        if (values?.some((value) => value === PASTED_QUERY)) {
          captured.pastedQuery = { text, values: values ?? [] };
        }
      }
    }
  };
  const instrumentClient = (client: PoolClient): PoolClient =>
    new Proxy(client, {
      get(target, property, receiver) {
        if (property === 'query') {
          return (text: string, values?: unknown[]) => {
            capture(text, values);
            return target.query(text, values);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function'
          ? (value.bind(target) as unknown)
          : value;
      }
    });
  const instrumented = new Proxy(pool, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (text: string, values?: unknown[]) => {
          capture(text, values);
          return target.query(text, values);
        };
      }
      if (property === 'connect') {
        return async () => instrumentClient(await target.connect());
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function'
        ? (value.bind(target) as unknown)
        : value;
    }
  });
  return { pool: instrumented, captured, counts };
}

/**
 * The embedding provider is stubbed with a fixed delay so the gate measures
 * what this repository controls: SQL time, and how often that provider delay is
 * paid at all. It deliberately does NOT claim to measure real provider latency
 * — that varies by provider and host, and a green gate here says nothing about
 * it. `embeddingCallDelayMs` is set well above any plausible SQL time so a
 * regression in cache hit rate shows up as a latency cliff rather than noise.
 */
const EMBEDDING_CALL_DELAY_MS = 250;

function benchmarkVector(): number[] {
  const vector = new Array<number>(1536).fill(0.01);
  vector[0] = 1;
  vector[1] = 0.5;
  return vector;
}

const LONG_KEYWORD_FIXTURE_ID = '00000000-0000-0000-0000-00000000b042';
const FALLBACK_FIXTURE_ID = '00000000-0000-0000-0000-00000000b043';
const FALLBACK_TAG = 'latency-fallback';

async function seedLongKeywordFixture(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO entities (
       id,
       type,
       content,
       visibility,
       status,
       enrichment_status,
       tags,
       metadata
     )
     VALUES ($1, 'memory', $2, 'shared', 'active', 'completed', '{}', '{}')`,
    [LONG_KEYWORD_FIXTURE_ID, LONG_KEYWORD_QUERY]
  );
  await pool.query(
    `INSERT INTO chunks (
       entity_id,
       chunk_index,
       content,
       embedding,
       model_id,
       token_count
     )
     VALUES (
       $1,
       0,
       $2,
       $3::vector,
       (SELECT id FROM embedding_models WHERE is_active = true),
       20
     )`,
    [
      LONG_KEYWORD_FIXTURE_ID,
      LONG_KEYWORD_QUERY,
      vectorToSql(benchmarkVector())
    ]
  );
}

async function removeLongKeywordFixture(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM entities WHERE id = $1', [
    LONG_KEYWORD_FIXTURE_ID
  ]);
  await pool.query('ANALYZE entities');
  await pool.query('ANALYZE chunks');
}

async function seedFallbackFixture(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO entities (
       id,
       type,
       content,
       visibility,
       status,
       enrichment_status,
       tags,
       metadata
     )
     VALUES ($1, 'memory', 'underfilled hnsw fallback probe', 'shared',
       'active', 'completed', $2, '{}')`,
    [FALLBACK_FIXTURE_ID, [FALLBACK_TAG]]
  );
  await pool.query(
    `INSERT INTO chunks (
       entity_id,
       chunk_index,
       content,
       embedding,
       model_id,
       token_count
     )
     VALUES (
       $1,
       0,
       'underfilled hnsw fallback probe',
       $2::vector,
       (SELECT id FROM embedding_models WHERE is_active = true),
       5
     )`,
    [FALLBACK_FIXTURE_ID, vectorToSql(benchmarkVector())]
  );
}

async function removeFallbackFixture(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM entities WHERE id = $1', [FALLBACK_FIXTURE_ID]);
  await pool.query('ANALYZE entities');
  await pool.query('ANALYZE chunks');
}

async function runFallbackProfile(
  pool: Pool
): Promise<[string, Profile, ProfileStats]> {
  await seedFallbackFixture(pool);
  try {
    return await runProfile(pool, {
      name: 'underfilled_hnsw_fallback',
      query: 'underfilled hnsw fallback probe',
      tags: [FALLBACK_TAG],
      strategy: 'hnsw',
      repeated: true
    });
  } finally {
    await removeFallbackFixture(pool);
  }
}

async function runProfile(
  pool: Pool,
  input: {
    name: string;
    /** Reuse one query across runs so every call after the first is a cache hit. */
    repeated?: boolean;
    /** Use a long OR keyword query with one deliberately rare matching row. */
    longKeyword?: boolean;
    /** Use a repeated 300-word pasted query with more terms than the cap. */
    pastedQuery?: boolean;
    /** Override the query used by this profile. */
    query?: string;
    /** Restrict the profile to a temporary fixture. */
    tags?: string[];
    /** Force HNSW so an underfilled candidate set exercises the fallback. */
    strategy?: 'auto' | 'exact' | 'hnsw';
    /** Share the cache across runs; false simulates a cold process. */
    freshServicePerRun?: boolean;
  }
): Promise<[string, Profile, ProfileStats]> {
  const vector = benchmarkVector();
  let embeddingCalls = 0;
  let selectedStrategy: string | null = null;
  const embedQuery = async () => {
    embeddingCalls += 1;
    await sleep(EMBEDDING_CALL_DELAY_MS);
    return vector;
  };
  let embeddingService = createEmbeddingService({ embedQuery });

  const run = async (iteration: number): Promise<number> => {
    if (input.freshServicePerRun) {
      embeddingService = createEmbeddingService({ embedQuery });
    }
    const query =
      input.query ??
      (input.longKeyword
        ? LONG_KEYWORD_QUERY
        : input.pastedQuery
        ? PASTED_QUERY
        : input.repeated
        ? 'postgres search latency benchmark entity 42'
        : `postgres search latency benchmark entity ${iteration + 1}`);
    const started = performance.now();
    const result = await searchEntities(
      pool,
      auth,
      {
        query,
        limit: 10,
        threshold: 0,
        ...(input.tags ? { tags: input.tags } : {})
      },
      {
        embeddingService,
        ...(input.strategy ? { strategyOverride: input.strategy } : {}),
        onStrategy: (strategy) => {
          selectedStrategy = strategy;
        }
      }
    );
    if (result.isErr()) {
      throw result.error;
    }
    return performance.now() - started;
  };

  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    await run(100 + index);
  }
  embeddingCalls = 0;
  const samples: number[] = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    samples.push(await run(index));
  }
  return [input.name, summarize(samples), { embeddingCalls, strategy: selectedStrategy }];
}

async function runLongKeywordProfile(
  pool: Pool,
  explainPool: Pool,
  captured: { longKeyword?: CapturedQuery }
): Promise<{
  run: [string, Profile, ProfileStats];
  explain: ExplainCapture | null;
}> {
  await seedLongKeywordFixture(pool);
  try {
    const run = await runProfile(pool, {
      name: 'long_keyword_query',
      repeated: true,
      longKeyword: true
    });
    return {
      run,
      // The fixture must still exist while EXPLAIN ANALYZE executes. The
      // caller receives this plan before the finally block removes it.
      explain: await explain(
        explainPool,
        captured.longKeyword,
        explainStrategy(captured.longKeyword)
      )
    };
  } finally {
    await removeLongKeywordFixture(pool);
  }
}

type RecallProfile = {
  exact_results: number;
  hnsw_results: number;
  hnsw_strategy: string | null;
  overlap: number;
  recall: number;
};

async function measureRecall(pool: Pool): Promise<RecallProfile> {
  const embeddingService = createEmbeddingService({
    embedQuery: () => Promise.resolve(benchmarkVector())
  });
  const input = {
    query: 'postgres search latency benchmark entity 42',
    limit: 10,
    threshold: 0
  };
  const exact = await searchEntities(pool, auth, input, {
    embeddingService,
    strategyOverride: 'exact'
  });
  if (exact.isErr()) throw exact.error;
  let hnswStrategy: string | null = null;
  const hnsw = await searchEntities(pool, auth, input, {
    embeddingService,
    strategyOverride: 'hnsw',
    onStrategy: (strategy) => {
      hnswStrategy = strategy;
    }
  });
  if (hnsw.isErr()) throw hnsw.error;

  const exactIds = new Set(
    exact.value.results.map((result) => result.entityId)
  );
  const hnswIds = new Set(
    hnsw.value.results.map((result) => result.entityId)
  );
  const overlap = Array.from(exactIds).filter((id) => hnswIds.has(id)).length;
  return {
    exact_results: exactIds.size,
    hnsw_results: hnswIds.size,
    hnsw_strategy: hnswStrategy,
    overlap,
    recall: exactIds.size === 0 ? 1 : overlap / exactIds.size
  };
}

type ExplainPlanNode = {
  'Node Type'?: string;
  'Index Name'?: string;
  'CTE Name'?: string;
  'Total Cost'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Shared Hit Blocks'?: number;
  Plans?: ExplainPlanNode[];
};

type ExplainJit = {
  Timing?: {
    Total?: number;
  };
};

type ExplainRow = {
  'QUERY PLAN'?: ExplainDocument[];
};

type ExplainDocument = {
  'Planning Time'?: number;
  'Execution Time'?: number;
  Plan?: ExplainPlanNode;
  JIT?: ExplainJit;
};

type ExplainSummary = {
  planning_ms: number | null;
  execution_ms: number | null;
  estimated_total_cost: number | null;
  actual_rows: number | null;
  actual_loops: number | null;
  vector_candidates: number | null;
  keyword_candidates: number | null;
  jit_total_ms: number | null;
  root_node: string | null;
  shared_hit_blocks: number | null;
  indexes: string[];
};

type ExplainCapture = {
  summary: ExplainSummary;
  plan: ExplainDocument;
};

function collectIndexes(
  node: ExplainPlanNode | undefined,
  indexes: Set<string>
): void {
  if (!node) return;
  if (node['Index Name']) indexes.add(node['Index Name']);
  for (const child of node.Plans ?? []) {
    collectIndexes(child, indexes);
  }
}

function collectCteRows(
  node: ExplainPlanNode | undefined,
  rows: {
    vector_candidates: number | null;
    keyword_candidates: number | null;
  }
): void {
  if (!node) return;
  const cteName = node['CTE Name'];
  if (cteName === 'vector_candidates' || cteName === 'keyword_candidates') {
    const actualRows = node['Actual Rows'];
    if (actualRows !== undefined) {
      const previous = rows[cteName];
      rows[cteName] =
        previous === null ? actualRows : Math.max(previous, actualRows);
    }
  }
  for (const child of node.Plans ?? []) {
    collectCteRows(child, rows);
  }
}

function summarizeExplain(plan: ExplainDocument): ExplainSummary {
  const indexes = new Set<string>();
  const cteRows = {
    vector_candidates: null,
    keyword_candidates: null
  };
  collectIndexes(plan?.Plan, indexes);
  collectCteRows(plan?.Plan, cteRows);
  return {
    planning_ms: plan?.['Planning Time'] ?? null,
    execution_ms: plan?.['Execution Time'] ?? null,
    estimated_total_cost: plan?.Plan?.['Total Cost'] ?? null,
    actual_rows: plan?.Plan?.['Actual Rows'] ?? null,
    actual_loops: plan?.Plan?.['Actual Loops'] ?? null,
    vector_candidates: cteRows.vector_candidates,
    keyword_candidates: cteRows.keyword_candidates,
    jit_total_ms: plan?.JIT?.Timing?.Total ?? null,
    root_node: plan?.Plan?.['Node Type'] ?? null,
    shared_hit_blocks: plan?.Plan?.['Shared Hit Blocks'] ?? null,
    indexes: Array.from(indexes).sort()
  };
}

function explainStrategy(query: CapturedQuery | undefined): ExplainStrategy {
  return detectVectorStrategy(query?.text ?? '') ?? 'exact';
}

async function explain(
  pool: Pool,
  query: CapturedQuery | undefined,
  strategy: ExplainStrategy = 'exact'
): Promise<ExplainCapture | null> {
  if (!query) return null;
  const run = async (
    client: Pool | PoolClient
  ): Promise<ExplainCapture | null> => {
    const result = await client.query<ExplainRow>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.text}`,
      query.values
    );
    const plan = result.rows[0]?.['QUERY PLAN']?.[0];
    if (!plan) return null;
    return { summary: summarizeExplain(plan), plan };
  };
  if (strategy === 'exact') return run(pool);

  const client = await pool.connect();
  let transactionActive = false;
  try {
    await client.query('BEGIN');
    transactionActive = true;
    await client.query("SELECT '[0]'::vector");
    await client.query("SET LOCAL hnsw.iterative_scan = 'strict_order'");
    const result = await run(client);
    await client.query('ROLLBACK');
    transactionActive = false;
    return result;
  } catch (error) {
    if (transactionActive) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original EXPLAIN or configuration error.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function explainOutputPath(argv: string[]): string | undefined {
  const flag = '--explain-output';
  const argument = argv.find((value) => value.startsWith(`${flag}=`));
  if (argument) {
    const path = argument.slice(flag.length + 1);
    if (!path) throw new Error(`${flag} requires a file path`);
    return path;
  }
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const path = argv[index + 1];
  if (!path || path.startsWith('--')) {
    throw new Error(`${flag} requires a file path`);
  }
  return path;
}

async function writeExplainOutput(
  path: string | undefined,
  plans: {
    hnsw: ExplainDocument | null;
    exact: ExplainDocument | null;
    long_keyword: ExplainDocument | null;
    pasted_query: ExplainDocument | null;
  }
): Promise<void> {
  if (!path) return;
  await writeFile(path, `${JSON.stringify(plans, null, 2)}\n`, 'utf8');
}

const explainOutput = explainOutputPath(process.argv.slice(2));
const database = await createTestDatabase();
let report: unknown;
try {
  await seed(database.pool);
  const { pool, captured, counts } = captureSearchQueries(database.pool);

  const runs = [
    // Every query is unique, so every search pays the provider round trip.
    // This is the worst case and the upper bound on search latency.
    await runProfile(pool, { name: 'cold_unique_queries' }),
    // The same query repeatedly: served from the in-process cache.
    await runProfile(pool, { name: 'memory_cache_hit', repeated: true }),
    // The same query repeatedly, but with a fresh service each run so the
    // in-process cache is always empty. Only the Postgres-backed cache can
    // satisfy these — this is what a restarted process sees.
    await runProfile(pool, {
      name: 'database_cache_hit',
      repeated: true,
      freshServicePerRun: true
    })
  ];
  // A long OR query gets one selective fixture only for this profile, so
  // the existing common-term profiles and recall corpus stay unchanged.
  const longKeywordRun = await runLongKeywordProfile(
    pool,
    database.pool,
    captured
  );
  runs.push(longKeywordRun.run);
  runs.push(
    await runProfile(pool, {
      name: 'pasted_query',
      pastedQuery: true,
      repeated: true
    })
  );

  const recall = await measureRecall(pool);
  const fallbackRun = await runFallbackProfile(pool);
  runs.push(fallbackRun);

  const profiles = Object.fromEntries(
    runs.map(([name, profile]) => [name, profile])
  ) as Record<string, Profile>;
  const embeddingCalls = Object.fromEntries(
    runs.map(([name, , stats]) => [name, stats.embeddingCalls])
  ) as Record<string, number>;

  const fallbackStats = fallbackRun[2];
  const hnswExplain = await explain(database.pool, captured.hnsw, 'hnsw');
  const exactExplain = await explain(database.pool, captured.exact, 'exact');
  const pastedQueryExplain = await explain(
    database.pool,
    captured.pastedQuery,
    explainStrategy(captured.pastedQuery)
  );
  const longKeywordExplain = longKeywordRun.explain;
  const explainPlans = {
    hnsw: hnswExplain?.plan ?? null,
    exact: exactExplain?.plan ?? null,
    long_keyword: longKeywordExplain?.plan ?? null,
    pasted_query: pastedQueryExplain?.plan ?? null
  };
  report = {
    dataset: { entities: ENTITY_COUNT, chunks: CHUNK_COUNT },
    samples: SAMPLE_RUNS,
    embedding_call_delay_ms: EMBEDDING_CALL_DELAY_MS,
    additional_workloads: {
      pasted_query_words: PASTED_QUERY_INPUT_WORD_COUNT,
      pasted_query_distinct_terms: PASTED_QUERY_INPUT_DISTINCT_TERM_COUNT,
      pasted_query_retained_term_cap: PASTED_QUERY_RETAINED_TERM_CAP,
      fallback_fixture: 'one tagged chunk with forced HNSW'
    },
    profiles,
    embedding_calls: embeddingCalls,
    fallback_strategy: fallbackStats.strategy,
    database_queries: counts.total,
    explain_output: explainOutput ?? null,
    recall,
    explain: {
      hnsw: hnswExplain?.summary ?? null,
      exact: exactExplain?.summary ?? null,
      long_keyword: longKeywordExplain?.summary ?? null,
      pasted_query: pastedQueryExplain?.summary ?? null
    }
  };
  await writeExplainOutput(explainOutput, explainPlans);

  if (process.argv.includes('--assert')) {
    if (!hnswExplain?.summary.indexes.includes('idx_chunks_embedding')) {
      throw new Error('HNSW search plan did not use idx_chunks_embedding');
    }
    if (exactExplain?.summary.indexes.includes('idx_chunks_embedding')) {
      throw new Error('exact search plan used idx_chunks_embedding');
    }
    if (
      !longKeywordExplain?.summary.indexes.includes(
        'idx_chunks_content_tsvector'
      )
    ) {
      throw new Error(
        'long keyword search plan did not use idx_chunks_content_tsvector'
      );
    }
    const longKeywordSummary = longKeywordExplain?.summary;
    if (
      !longKeywordSummary ||
      longKeywordSummary.vector_candidates !== 200 ||
      longKeywordSummary.keyword_candidates !== 1
    ) {
      throw new Error(
        `Long keyword EXPLAIN expected 200 vector candidates and 1 keyword candidate; got ${longKeywordSummary?.vector_candidates ?? 'missing'} and ${longKeywordSummary?.keyword_candidates ?? 'missing'}`
      );
    }
    if (recall.hnsw_strategy !== 'hnsw') {
      throw new Error(
        `HNSW recall probe used ${recall.hnsw_strategy ?? 'no strategy'}`
      );
    }
    if (recall.exact_results === 0 || recall.recall < 0.8) {
      throw new Error(
        `HNSW recall ${recall.recall.toFixed(2)} fell below 0.80`
      );
    }
    if (fallbackStats.strategy !== 'hnsw_exact_fallback') {
      throw new Error(
        `Underfilled HNSW profile used ${fallbackStats.strategy ?? 'no strategy'}`
      );
    }

    const maxP95: Record<string, number> = {
      // One provider round trip plus SQL.
      cold_unique_queries: EMBEDDING_CALL_DELAY_MS + 150,
      // No provider round trip at all: this must stay pure SQL time.
      memory_cache_hit: 125,
      // One extra indexed SELECT versus a memory hit, and still no round trip.
      database_cache_hit: 150,
      // The additional work is the bounded GIN keyword branch.
      long_keyword_query: 125,
      // A 300-word pasted query retains only its first 24 distinct terms.
      pasted_query: 150,
      // Forced HNSW over one tagged chunk, followed by exact fallback.
      underfilled_hnsw_fallback: 250
    };
    for (const [name, maximum] of Object.entries(maxP95)) {
      const actual = profiles[name]?.p95_ms;
      if (actual === undefined || actual > maximum) {
        throw new Error(
          `${name} p95 ${actual ?? 'missing'}ms exceeded ${maximum}ms`
        );
      }
    }

    // Guards the cache itself rather than just its latency effect: a cache that
    // silently stopped working would still pass a wall-clock threshold on a
    // fast CI box, but cannot pass this.
    const maxEmbeddingCalls: Record<string, number> = {
      cold_unique_queries: SAMPLE_RUNS,
      memory_cache_hit: 0,
      database_cache_hit: 0,
      long_keyword_query: 0,
      pasted_query: 0,
      underfilled_hnsw_fallback: 0
    };
    for (const [name, maximum] of Object.entries(maxEmbeddingCalls)) {
      const actual = embeddingCalls[name];
      if (actual === undefined || actual > maximum) {
        throw new Error(
          `${name} made ${actual ?? 'missing'} embedding calls; expected at most ${maximum}`
        );
      }
    }
  }
} finally {
  await database.close();
  // Written in `finally` so a failed assertion still emits the numbers that
  // explain the failure rather than an empty artifact.
  if (report !== undefined) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}
