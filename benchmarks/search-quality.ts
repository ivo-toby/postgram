/**
 * Evaluates search relevance against the public synthetic corpus.
 *
 * The public run creates a real pgvector PostgreSQL database through the same
 * test helper used by integration tests. Fixture vectors and query vectors are
 * deterministic, so this measures candidate generation and ranking without a
 * paid embedding provider.
 *
 * Run:    npm run benchmark:quality
 * Gate:   npm run benchmark:quality -- --assert
 * Private: SEARCH_QUALITY_LABELS=path.jsonl DATABASE_URL=... \
 *          npm run benchmark:quality -- --private
 *
 * The default exact strategy keeps the public relevance gate deterministic
 * while still exercising the bounded vector candidate limit. Pass
 * `--strategy auto` or `--strategy hnsw` to inspect approximate retrieval.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { Pool } from 'pg';

import type { AuthContext } from '../src/auth/types.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import {
  createEmbeddingService,
  vectorToSql,
  type EmbeddingService
} from '../src/services/embedding-service.js';
import {
  createEmbeddingProvider,
  type EmbeddingProviderConfig
} from '../src/services/embeddings/providers.js';
import { assertEmbeddingDimensionAgreement } from '../src/services/embeddings/admin.js';
import { buildEmbeddingProviderConfig } from '../src/index.js';
import { searchEntities } from '../src/services/search-service.js';
import {
  createTestDatabase,
  resetTestDatabase
} from '../tests/helpers/postgres.js';
import {
  aggregateQualityMetrics,
  calculateQualityMetrics,
  parseQualityLabels,
  type QualityCategoryMetrics,
  type QualityQueryResult
} from './search-quality-metrics.js';
import {
  SEARCH_QUALITY_CORPUS,
  SEARCH_QUALITY_COMMON_TERM_TARGET_COUNT,
  SEARCH_QUALITY_DIMENSIONS,
  SEARCH_QUALITY_DISTRACTOR_COUNT,
  SEARCH_QUALITY_QUERY_EMBEDDINGS,
  fixtureEmbeddingByContent,
  type SearchQualityQuery
} from './fixtures/search-quality-corpus.js';

type SearchStrategy = 'auto' | 'exact' | 'hnsw';

type ParsedArguments = {
  assert: boolean;
  privateMode: boolean;
  strategy: SearchStrategy;
  labelsPath: string | undefined;
  databaseUrl: string | undefined;
  clientId: string;
  baselinePath: string;
  writeBaselinePath: string | undefined;
};

type QueryRun = QualityQueryResult & {
  elapsed_ms: number;
  resolved_strategy: string;
};

type Baseline = {
  strategy: SearchStrategy;
  metrics: Record<string, QualityCategoryMetrics>;
};

type QualityAssertion = {
  name: string;
  passed: boolean;
  detail: string;
};

const DEFAULT_PRIVATE_LABELS_PATH =
  'benchmarks/fixtures/private-search-quality.labels.jsonl';
const DEFAULT_BASELINE_PATH =
  'benchmarks/fixtures/search-quality-baseline.json';
const QUALITY_THRESHOLD = 0.35;
const QUALITY_RECENCY_WEIGHT = 0;
const SEMANTIC_NDCG_TOLERANCE = 0.000001;

const publicAuth: AuthContext = {
  apiKeyId: '00000000-0000-0000-0000-00000000b901',
  keyName: 'search-quality-public',
  clientId: 'search-quality-public',
  scopes: ['read'],
  allowedTypes: null,
  allowedVisibility: ['personal', 'work', 'shared']
};

function usageError(message: string): Error {
  return new Error(
    `${message}\nUsage: npm run benchmark:quality -- [--assert] [--strategy auto|exact|hnsw] [--private] [--client-id client]`
  );
}

function optionValue(
  argument: string,
  name: string,
  next: string | undefined
): string | undefined {
  if (argument === name) return next;
  const prefix = `${name}=`;
  return argument.startsWith(prefix)
    ? argument.slice(prefix.length)
    : undefined;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  let assert = false;
  let privateFlag = false;
  let strategy: SearchStrategy = 'exact';
  let labelsPath: string | undefined;
  let databaseUrl: string | undefined;
  let clientId: string | undefined;
  let baselinePath = DEFAULT_BASELINE_PATH;
  let writeBaselinePath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      throw usageError('Missing command-line argument');
    }
    if (argument === '--assert') {
      assert = true;
      continue;
    }
    if (argument === '--private') {
      privateFlag = true;
      continue;
    }

    const strategyValue = optionValue(argument, '--strategy', argv[index + 1]);
    if (strategyValue !== undefined) {
      if (argument === '--strategy') index += 1;
      if (
        strategyValue !== 'auto' &&
        strategyValue !== 'exact' &&
        strategyValue !== 'hnsw'
      ) {
        throw usageError(`Unsupported search strategy: ${strategyValue}`);
      }
      strategy = strategyValue;
      continue;
    }

    const labelsValue = optionValue(argument, '--labels', argv[index + 1]);
    if (labelsValue !== undefined) {
      if (argument === '--labels') index += 1;
      labelsPath = labelsValue;
      continue;
    }

    const databaseValue = optionValue(
      argument,
      '--database-url',
      argv[index + 1]
    );
    if (databaseValue !== undefined) {
      if (argument === '--database-url') index += 1;
      databaseUrl = databaseValue;
      continue;
    }

    const clientIdValue = optionValue(argument, '--client-id', argv[index + 1]);
    if (clientIdValue !== undefined) {
      if (argument === '--client-id') index += 1;
      clientId = clientIdValue;
      continue;
    }

    const baselineValue = optionValue(argument, '--baseline', argv[index + 1]);
    if (baselineValue !== undefined) {
      if (argument === '--baseline') index += 1;
      baselinePath = baselineValue;
      continue;
    }

    const writeBaselineValue = optionValue(
      argument,
      '--write-baseline',
      argv[index + 1]
    );
    if (writeBaselineValue !== undefined) {
      if (argument === '--write-baseline') index += 1;
      writeBaselinePath = writeBaselineValue;
      continue;
    }

    throw usageError(`Unknown argument: ${argument}`);
  }

  const configuredLabelsPath = labelsPath ?? process.env.SEARCH_QUALITY_LABELS;
  const privateMode =
    privateFlag ||
    configuredLabelsPath !== undefined ||
    databaseUrl !== undefined;
  if (privateMode && !databaseUrl && !process.env.DATABASE_URL) {
    throw usageError(
      'Private quality mode requires an explicit --database-url or DATABASE_URL'
    );
  }
  const resolvedClientId =
    clientId ??
    process.env.SEARCH_QUALITY_CLIENT_ID ??
    'search-quality-private';
  if (privateMode && resolvedClientId.trim().length === 0) {
    throw usageError('Private quality mode requires a non-empty client id');
  }

  return {
    assert,
    privateMode,
    strategy,
    labelsPath: privateMode
      ? (configuredLabelsPath ?? DEFAULT_PRIVATE_LABELS_PATH)
      : undefined,
    databaseUrl:
      databaseUrl ?? (privateMode ? process.env.DATABASE_URL : undefined),
    clientId: resolvedClientId,
    baselinePath,
    writeBaselinePath
  };
}

function fallbackEmbeddingService(): EmbeddingService {
  return createEmbeddingService({ mode: 'deterministic' });
}

function createPublicEmbeddingService(): EmbeddingService {
  const fallback = fallbackEmbeddingService();
  const fixtureEmbeddings = fixtureEmbeddingByContent();

  return createEmbeddingService({
    mode: 'deterministic',
    embedBatch: async (texts) => {
      const fallbackVectors = await fallback.embedBatch(texts);
      return texts.map((text, index) => {
        const fixtureVector = fixtureEmbeddings.get(text);
        if (fixtureVector) return fixtureVector;
        const vector = fallbackVectors[index];
        if (!vector) {
          throw new Error(
            `No deterministic embedding for fixture text at ${index}`
          );
        }
        return vector;
      });
    },
    embedQuery: async (text, model) => {
      const knownVector = SEARCH_QUALITY_QUERY_EMBEDDINGS[text];
      if (knownVector) return knownVector;
      return fallback.embedQuery(text, model);
    }
  });
}

function createPrivateEmbeddingService(
  config: AppConfig,
  providerConfig: EmbeddingProviderConfig
): EmbeddingService {
  const provider = createEmbeddingProvider(providerConfig);
  const configured = createEmbeddingService({
    provider,
    queryCacheMaxSize: config.QUERY_EMBEDDING_CACHE_SIZE,
    queryCacheSecret: config.QUERY_EMBEDDING_CACHE_SECRET
  });

  // Search always passes its pool and client scope to embedQuery so the
  // normal service can use the shared query cache. Private evaluation runs on
  // a read-only pool, so deliberately drop those options while preserving the
  // caller's client scope for memory visibility filtering.
  return {
    ...configured,
    async embedQuery(text, model) {
      return configured.embedQuery(text, model);
    }
  };
}

function tokenCount(content: string): number {
  return content.trim().split(/\s+/u).filter(Boolean).length;
}

async function seedPublicCorpus(
  pool: Pool,
  embeddingService: EmbeddingService
): Promise<void> {
  await resetTestDatabase(pool);

  const modelResult = await pool.query<{ id: string }>(
    'SELECT id FROM embedding_models WHERE is_active = true'
  );
  const modelId = modelResult.rows[0]?.id;
  if (!modelId) {
    throw new Error('Public quality corpus has no active embedding model');
  }

  const fixtures = SEARCH_QUALITY_CORPUS.fixtures;
  const ids = fixtures.map((fixture) => fixture.id);
  const types = fixtures.map((fixture) => fixture.type);
  const contents = fixtures.map((fixture) => fixture.content);
  const embeddings = await embeddingService.embedBatch(contents);
  if (embeddings.length !== fixtures.length) {
    throw new Error(
      'Deterministic fixture embedding count did not match corpus'
    );
  }

  const seededAt = new Date('2026-01-01T00:00:00.000Z');
  await pool.query(
    `
      INSERT INTO entities (
        id, type, content, visibility, status, enrichment_status,
        tags, metadata, created_at, updated_at
      )
      SELECT fixture_id, fixture_type, fixture_content, 'shared', 'active',
        'completed', ARRAY['search-quality']::text[], '{}'::jsonb, $4::timestamptz,
        $4::timestamptz
      FROM unnest($1::uuid[], $2::text[], $3::text[])
        AS fixture(fixture_id, fixture_type, fixture_content)
    `,
    [ids, types, contents, seededAt]
  );

  const vectors = embeddings.map((embedding, index) => {
    if (embedding.length !== SEARCH_QUALITY_DIMENSIONS) {
      throw new Error(
        `Fixture embedding ${index} had ${embedding.length} dimensions; expected ${SEARCH_QUALITY_DIMENSIONS}`
      );
    }
    return vectorToSql(embedding);
  });
  const counts = contents.map(tokenCount);
  await pool.query(
    `
      INSERT INTO chunks (
        entity_id, chunk_index, content, embedding, model_id, token_count
      )
      SELECT fixture_id, 0, fixture_content, fixture_embedding::vector,
        $4::uuid, fixture_tokens
      FROM unnest($1::uuid[], $2::text[], $3::text[], $5::integer[])
        AS fixture(fixture_id, fixture_content, fixture_embedding, fixture_tokens)
    `,
    [ids, contents, vectors, modelId, counts]
  );

  await pool.query('ANALYZE entities');
  await pool.query('ANALYZE chunks');
}

function loadPublicLabels(): SearchQualityQuery[] {
  return [...SEARCH_QUALITY_CORPUS.queries];
}

async function loadPrivateLabels(
  labelsPath: string
): Promise<SearchQualityQuery[]> {
  const content = await readFile(labelsPath, 'utf8');
  const labels = parseQualityLabels(content.split(/\r?\n/u));
  return labels.map((label) => ({
    query: label.query,
    category: 'private',
    grades: label.grades
  }));
}

function privateAuth(clientId: string): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-00000000b902',
    keyName: 'search-quality-private',
    clientId,
    scopes: ['read'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

async function runQuery(
  pool: Pool,
  embeddingService: EmbeddingService,
  auth: AuthContext,
  query: SearchQualityQuery,
  strategy: SearchStrategy
): Promise<QueryRun> {
  const started = performance.now();
  let resolvedStrategy = 'unknown';
  const result = await searchEntities(
    pool,
    auth,
    {
      query: query.query,
      limit: 10,
      threshold: QUALITY_THRESHOLD,
      recencyWeight: QUALITY_RECENCY_WEIGHT
    },
    {
      embeddingService,
      strategyOverride: strategy,
      onStrategy: (value) => {
        resolvedStrategy = value;
      }
    }
  );
  if (result.isErr()) {
    throw result.error;
  }

  const rankedEntityIds = result.value.results.map((entry) => entry.entityId);
  const metrics = calculateQualityMetrics(rankedEntityIds, query.grades);
  return {
    query: query.query,
    category: query.category,
    rankedEntityIds,
    grades: query.grades,
    metrics,
    elapsed_ms: Number((performance.now() - started).toFixed(2)),
    resolved_strategy: resolvedStrategy
  };
}

function rankOf(rankedEntityIds: readonly string[], entityId: string): number {
  const index = rankedEntityIds.indexOf(entityId);
  return index < 0 ? Number.POSITIVE_INFINITY : index + 1;
}

function assertion(
  name: string,
  passed: boolean,
  detail: string
): QualityAssertion {
  return { name, passed, detail };
}

function publicAssertions(
  runs: readonly QueryRun[],
  metrics: ReturnType<typeof aggregateQualityMetrics>,
  baseline: Baseline
): QualityAssertion[] {
  const assertions: QualityAssertion[] = [];
  for (const run of runs) {
    const query = SEARCH_QUALITY_CORPUS.queries.find(
      (candidate) => candidate.query === run.query
    );
    const expectedId = query?.expectedTop3Id;
    if (expectedId) {
      const rank = rankOf(run.rankedEntityIds, expectedId);
      assertions.push(
        assertion(
          `target in top 3: ${run.query}`,
          rank <= 3,
          `${expectedId} ranked ${Number.isFinite(rank) ? rank : 'outside top 10'}`
        )
      );
    }
    if (query?.expectedAbove) {
      const winnerRank = rankOf(
        run.rankedEntityIds,
        query.expectedAbove.winnerId
      );
      const loserRank = rankOf(
        run.rankedEntityIds,
        query.expectedAbove.loserId
      );
      assertions.push(
        assertion(
          `answer above incidental document: ${run.query}`,
          winnerRank < loserRank,
          `winner rank ${Number.isFinite(winnerRank) ? winnerRank : 'outside top 10'}, ` +
            `loser rank ${Number.isFinite(loserRank) ? loserRank : 'outside top 10'}`
        )
      );
    }
  }

  const currentSemantic = metrics.semantic_control?.ndcg_at_5;
  const baselineSemantic = baseline.metrics.semantic_control?.ndcg_at_5;
  if (currentSemantic !== undefined && baselineSemantic !== undefined) {
    assertions.push(
      assertion(
        'semantic-control nDCG does not regress',
        currentSemantic + SEMANTIC_NDCG_TOLERANCE >= baselineSemantic,
        `current ${currentSemantic.toFixed(6)}, baseline ${baselineSemantic.toFixed(6)}, tolerance ${SEMANTIC_NDCG_TOLERANCE}`
      )
    );
  } else {
    assertions.push(
      assertion(
        'semantic-control baseline is available',
        false,
        'Both current and baseline semantic_control nDCG@5 are required'
      )
    );
  }

  const commonTermRecall = metrics.common_terms?.recall_at_10;
  if (commonTermRecall !== undefined) {
    assertions.push(
      assertion(
        'common-term targets recall@10',
        commonTermRecall === 1,
        `recall ${commonTermRecall.toFixed(6)}, expected all ${SEARCH_QUALITY_COMMON_TERM_TARGET_COUNT} late targets`
      )
    );
  }

  return assertions;
}

function parseBaseline(value: unknown, sourcePath: string): Baseline {
  if (!isRecord(value)) {
    throw new Error(`Quality baseline ${sourcePath} must contain an object`);
  }
  const strategy = value.strategy;
  if (strategy !== 'auto' && strategy !== 'exact' && strategy !== 'hnsw') {
    throw new Error(`Quality baseline ${sourcePath} has an invalid strategy`);
  }
  const metricsValue = value.metrics;
  if (!isRecord(metricsValue)) {
    throw new Error(`Quality baseline ${sourcePath} must contain metrics`);
  }
  const metrics: Record<string, QualityCategoryMetrics> = {};
  for (const [category, categoryValue] of Object.entries(metricsValue)) {
    if (!isRecord(categoryValue)) {
      throw new Error(
        `Quality baseline ${sourcePath} has invalid ${category} metrics`
      );
    }
    const queryCount = categoryValue.query_count;
    const ndcg = categoryValue.ndcg_at_5;
    const mrr = categoryValue.mrr;
    const recall = categoryValue.recall_at_10;
    if (
      typeof queryCount !== 'number' ||
      typeof ndcg !== 'number' ||
      typeof mrr !== 'number' ||
      typeof recall !== 'number'
    ) {
      throw new Error(
        `Quality baseline ${sourcePath} has invalid ${category} metrics`
      );
    }
    metrics[category] = {
      query_count: queryCount,
      ndcg_at_5: ndcg,
      mrr,
      recall_at_10: recall
    };
  }
  return { strategy, metrics };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readBaseline(baselinePath: string): Promise<Baseline> {
  const content = await readFile(baselinePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid quality baseline ${baselinePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return parseBaseline(parsed, baselinePath);
}

async function writeBaseline(
  baselinePath: string,
  strategy: SearchStrategy,
  metrics: ReturnType<typeof aggregateQualityMetrics>
): Promise<void> {
  const baseline: Baseline = {
    strategy,
    metrics
  };
  await writeFile(
    baselinePath,
    `${JSON.stringify(baseline, null, 2)}\n`,
    'utf8'
  );
}

function reportQuery(run: QueryRun): Record<string, unknown> {
  return {
    query: run.query,
    category: run.category,
    ranked_entity_ids: run.rankedEntityIds,
    metrics: run.metrics,
    elapsed_ms: run.elapsed_ms,
    resolved_strategy: run.resolved_strategy
  };
}

async function runPublic(options: ParsedArguments): Promise<{
  report: Record<string, unknown>;
  assertions: QualityAssertion[];
}> {
  const database = await createTestDatabase();
  try {
    const embeddingService = createPublicEmbeddingService();
    await seedPublicCorpus(database.pool, embeddingService);
    const runs: QueryRun[] = [];
    for (const query of loadPublicLabels()) {
      runs.push(
        await runQuery(
          database.pool,
          embeddingService,
          publicAuth,
          query,
          options.strategy
        )
      );
    }
    await embeddingService.flushPendingWrites();

    const metrics = aggregateQualityMetrics(runs);
    if (options.writeBaselinePath) {
      await writeBaseline(options.writeBaselinePath, options.strategy, metrics);
    }

    let assertions: QualityAssertion[] = [];
    let baseline: Baseline | undefined;
    if (options.assert) {
      baseline = await readBaseline(options.baselinePath);
      if (baseline.strategy !== options.strategy) {
        throw new Error(
          `Quality baseline uses ${baseline.strategy}, but this run uses ${options.strategy}; pass a matching --baseline or use the default strategy`
        );
      }
      assertions = publicAssertions(runs, metrics, baseline);
    }

    const report: Record<string, unknown> = {
      version: 1,
      mode: 'public',
      strategy: options.strategy,
      corpus: {
        fixture_count: SEARCH_QUALITY_CORPUS.fixtures.length,
        distractor_count: SEARCH_QUALITY_DISTRACTOR_COUNT,
        query_count: SEARCH_QUALITY_CORPUS.queries.length
      },
      metrics,
      queries: runs.map(reportQuery),
      baseline: baseline
        ? {
            path: options.baselinePath,
            strategy: baseline.strategy
          }
        : null,
      assertions
    };
    return { report, assertions };
  } finally {
    await database.close();
  }
}

async function runPrivate(options: ParsedArguments): Promise<{
  report: Record<string, unknown>;
  assertions: QualityAssertion[];
}> {
  if (!options.databaseUrl) {
    throw usageError('Private quality mode requires an explicit database URL');
  }

  const pool = new Pool({
    connectionString: options.databaseUrl,
    options: '-c default_transaction_read_only=on'
  });
  try {
    await pool.query('SELECT 1');
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: options.databaseUrl
    });
    const providerConfig = buildEmbeddingProviderConfig(config);
    const mismatch = await assertEmbeddingDimensionAgreement(pool, {
      provider: providerConfig.provider,
      model: providerConfig.model,
      dimensions: providerConfig.dimensions
    });
    if (mismatch) {
      throw new Error(mismatch.message);
    }
    const embeddingService = createPrivateEmbeddingService(
      config,
      providerConfig
    );
    const runs: QueryRun[] = [];
    const labels = await loadPrivateLabels(
      options.labelsPath ?? DEFAULT_PRIVATE_LABELS_PATH
    );
    for (const query of labels) {
      runs.push(
        await runQuery(
          pool,
          embeddingService,
          privateAuth(options.clientId),
          query,
          options.strategy
        )
      );
    }
    await embeddingService.flushPendingWrites();
    const metrics = aggregateQualityMetrics(runs);
    const assertions: QualityAssertion[] = options.assert
      ? [
          assertion(
            'private labels evaluated',
            runs.length > 0,
            `${runs.length} labelled queries evaluated without seeding or resetting the database`
          )
        ]
      : [];
    return {
      report: {
        version: 1,
        mode: 'private',
        strategy: options.strategy,
        labels_path: options.labelsPath,
        corpus: { query_count: labels.length },
        metrics,
        queries: runs.map(reportQuery),
        baseline: null,
        assertions
      },
      assertions
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const result = options.privateMode
    ? await runPrivate(options)
    : await runPublic(options);

  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  if (options.assert) {
    const failures = result.assertions.filter((check) => !check.passed);
    if (failures.length > 0) {
      throw new Error(
        failures
          .map((failure) => `${failure.name}: ${failure.detail}`)
          .join('; ')
      );
    }
  }
}

await main();
