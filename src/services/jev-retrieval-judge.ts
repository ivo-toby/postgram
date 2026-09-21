/**
 * Shadow-mode Jev retrieval judge.
 *
 * After hybrid search resolves, up to `maxCandidates` results are sent to the
 * TypeSafe API as state (text plus ranking scores) with three Noul questions
 * — relevant / evidence / contradicts — answered in a single `systemOne`
 * request per candidate. The resulting P(yes) probabilities are logged beside
 * the ranking scores in the `search.completed` debug payload.
 *
 * Boundaries (docs/superpowers/jev-research-decision.md):
 * - Shadow mode only: judgments are logged, never used to filter, rerank or
 *   gate graph expansion. There is deliberately no probability threshold in
 *   this module; any future policy threshold must be a named constant tuned
 *   from measured data, never an inline probability cut.
 * - With the flag off the Jev client is never constructed and the SDK module
 *   is never imported at runtime; search results stay byte-identical.
 * - Any Jev error or timeout degrades to a per-candidate skip, so search must
 *   never fail because of Jev. Candidates are judged concurrently, so the
 *   worst-case added latency is roughly one request timeout, not N.
 * - Jev jaggedness guidance: no numeric, date or counting questions; the
 *   state is text plus scores only, and the chunk text is capped so a large
 *   document cannot distract the judge.
 */

import { createHash, createHmac } from 'node:crypto';

import type { Logger } from 'pino';

import { loadConfig } from '../config.js';

/** P(yes) answers for the three Noul questions, each in [0, 1]. */
export type JevNouls = {
  relevant: number;
  evidence: number;
  contradicts: number;
};

/** Token usage reported by the SDK for one systemOne request. */
export type JevUsage = {
  inputTokens: number;
  outputTokens: number;
};

/** A candidate the judge scored. */
export type JevJudgedCandidate = {
  entityId: string;
  /** The exact chunk whose text was judged. */
  chunkId: string;
  status: 'judged';
  score: number;
  similarity: number;
  nouls: JevNouls;
  model: string;
  latencyMs: number;
  /** Digest of the exact state sent to Jev; see JevShadowObservation. */
  stateHash: string;
  /** Absent when the SDK response carried no parseable usage block. */
  usage?: JevUsage | undefined;
};

/** A candidate skipped because Jev was unavailable or answered malformed. */
export type JevUnavailableCandidate = {
  entityId: string;
  chunkId: string;
  status: 'unavailable';
  score: number;
  similarity: number;
  latencyMs: number;
  stateHash: string;
};

export type JevCandidateObservation =
  | JevJudgedCandidate
  | JevUnavailableCandidate;

export type JevShadowObservation = {
  /**
   * One-way digest of the query with the client scope mixed in, keyed with
   * QUERY_EMBEDDING_CACHE_SECRET when configured — plaintext queries never
   * reach the log, yet an operator holding the secret can identify a logged
   * search by digesting candidate queries. Together with `chunkId` and
   * `stateHash` per candidate this supports offline replay and human
   * relevance labeling without storing any query or chunk text.
   */
  queryHash: string;
  candidates: JevCandidateObservation[];
};

/** Minimal candidate data the judge needs; built from SearchResult rows. */
export type JevJudgeCandidate = {
  entityId: string;
  chunkId: string;
  chunkContent: string;
  entityType: string;
  tags: readonly string[];
  similarity: number;
  score: number;
};

export type JevRetrievalJudge = (input: {
  query: string;
  /** Cache scope of the caller; mixed into the query digest for the log. */
  clientScope?: string | undefined;
  candidates: readonly JevJudgeCandidate[];
  logger?: Pick<Logger, 'debug' | 'warn'> | undefined;
}) => Promise<JevShadowObservation>;

export type JevJudgeConfig = {
  /**
   * When false the judge is not created at all: no client, no SDK import.
   */
  shadowEnabled: boolean;
  /** Falls back to the SDK's TYPESAFE_API_KEY env handling when unset. */
  apiKey?: string | undefined;
  /** Defaults to the SDK default model (jev-latest) when unset. */
  model?: string | undefined;
  /** Per-request ceiling in milliseconds; also enforced via AbortSignal. */
  timeoutMs: number;
  /** Upper bound on candidates judged per search call. */
  maxCandidates: number;
  /**
   * Optional HMAC key for the shadow-log query digest. Mirrors
   * createQueryEmbeddingCacheKey: when set (QUERY_EMBEDDING_CACHE_SECRET) the
   * digest is keyed, so a log reader cannot dictionary-test guessed queries;
   * when unset it is an unkeyed sha256 — plaintext queries still never reach
   * the log, but guesses are verifiable. Either way the caller's client scope
   * is mixed in so the same query from two clients hashes differently.
   */
  queryCacheSecret?: string | Buffer | undefined;
};

// Structural mirror of the @typesafe-ai/sdk 0.6.0 surface this module uses,
// kept local so tsc does not depend on the package being installed here and
// the SDK is only ever loaded through the lazy dynamic import below. Shapes
// follow the caller-verified interface facts: `TypeSafeClient`, `noul`,
// `systemOne`, and `NoulResponse = { type: 'noul', noul: number }` — P(yes)
// with no confidence field.
export type JevSystemOneResult = {
  model: string;
  answers: Record<string, unknown>;
  usage?: { input_tokens?: unknown; output_tokens?: unknown } | undefined;
};

export type JevSystemOneClient = {
  systemOne(
    request: { state: unknown; questions: Record<string, unknown> },
    options: { timeout: number; signal: AbortSignal }
  ): Promise<JevSystemOneResult>;
};

export type JevSdkModule = {
  TypeSafeClient: new (config?: {
    apiKey?: string | undefined;
    defaultModel?: string | undefined;
  }) => JevSystemOneClient;
  noul: (instructions?: string) => unknown;
};

export type JevJudgeDeps = {
  /**
   * Pre-built systemOne client; tests stub this instead of the SDK. When
   * given, the SDK module is never imported. Noul questions are passed as
   * plain `{ instructions }` records.
   */
  client?: JevSystemOneClient | undefined;
  /**
   * Overrides the SDK module load so tests can exercise initialization
   * failure deterministically without depending on the install state.
   */
  loadModule?: (() => Promise<JevSdkModule>) | undefined;
};

// One atomic judgment per question; literal, present-tense, no negation
// (jaggedness guidance). The research docs call the three questions relevant /
// states_usable_evidence / contradicts_premise; the approved call shape names
// them relevant / evidence / contradicts, and those names are echoed into the
// shadow log.
const RELEVANT_QUESTION = 'Does this passage help answer the query?';
const EVIDENCE_QUESTION =
  'Does this passage state a fact usable in an answer?';
const CONTRADICTS_QUESTION =
  'Does this passage contradict something the query takes for granted?';

// State hygiene: text plus scores only. The cap is a state-size guard, not a
// quality cut — large irrelevant state distracts the judge.
const MAX_STATE_CHUNK_CHARS = 4_000;

function readNoulProbability(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record['type'] !== 'noul') {
    return undefined;
  }
  const probability = record['noul'];
  // The declared domain is [0, 1]; a value outside it is a malformed answer,
  // not calibration data — accepting it would poison the offline analysis.
  return typeof probability === 'number' &&
    Number.isFinite(probability) &&
    probability >= 0 &&
    probability <= 1
    ? probability
    : undefined;
}

function readNouls(answers: unknown): JevNouls | undefined {
  if (typeof answers !== 'object' || answers === null) {
    return undefined;
  }
  const record = answers as Record<string, unknown>;
  const relevant = readNoulProbability(record['relevant']);
  const evidence = readNoulProbability(record['evidence']);
  const contradicts = readNoulProbability(record['contradicts']);
  if (
    relevant === undefined ||
    evidence === undefined ||
    contradicts === undefined
  ) {
    return undefined;
  }
  return { relevant, evidence, contradicts };
}

function buildJudgeState(
  query: string,
  candidate: JevJudgeCandidate
): Record<string, unknown> {
  return {
    query,
    chunk_text: candidate.chunkContent.slice(0, MAX_STATE_CHUNK_CHARS),
    entity_type: candidate.entityType,
    tags: [...candidate.tags],
    similarity: candidate.similarity,
    score: candidate.score
  };
}

function unavailableObservation(
  candidate: JevJudgeCandidate,
  latencyMs: number,
  stateHash: string
): JevUnavailableCandidate {
  return {
    entityId: candidate.entityId,
    chunkId: candidate.chunkId,
    status: 'unavailable',
    score: candidate.score,
    similarity: candidate.similarity,
    latencyMs,
    stateHash
  };
}

function hashQuery(
  query: string,
  clientScope: string | undefined,
  digest: (value: string) => string
): string {
  // NUL separator keeps "ab" + "c" from colliding with "a" + "bc". The scope
  // goes into the digest itself, so the same query from two clients never
  // produces the same hash — cross-client correlation by hash equality is
  // impossible even without a secret.
  return digest(`${clientScope ?? ''}\u0000${query}`);
}

/**
 * One-way digest used for both the query reference and the state hash.
 *
 * With QUERY_EMBEDDING_CACHE_SECRET configured this is a keyed HMAC, which
 * prevents a log reader from dictionary-testing queries or guessed
 * query/chunk pairs; without it both are unkeyed sha256 — plaintext never
 * reaches the log either way, but guesses are verifiable (the same accepted
 * default as createQueryEmbeddingCacheKey).
 */
function makeDigest(secret: string | Buffer | undefined) {
  return (value: string): string =>
    secret !== undefined && secret.length > 0
      ? createHmac('sha256', secret).update(value, 'utf8').digest('hex')
      : createHash('sha256').update(value, 'utf8').digest('hex');
}

function readUsage(value: unknown): JevUsage | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const inputTokens = record['input_tokens'];
  const outputTokens = record['output_tokens'];
  if (
    typeof inputTokens !== 'number' ||
    !Number.isFinite(inputTokens) ||
    typeof outputTokens !== 'number' ||
    !Number.isFinite(outputTokens)
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens };
}

/**
 * Builds the shadow judge. Mirrors the createLlmProvider factory pattern:
 * callers pass the validated JEV_* config and receive a judge function, or
 * undefined when the feature is off or unconfigured.
 */
export function createJevRetrievalJudge(
  config: JevJudgeConfig,
  deps: JevJudgeDeps = {}
): JevRetrievalJudge | undefined {
  if (!config.shadowEnabled) {
    // Flag off: no judge object, no SDK import, no client construction — the
    // search path stays byte-identical.
    return undefined;
  }

  if (!deps.client && !config.apiKey) {
    // The SDK client constructor throws TypeSafeError without a key, so an
    // enabled flag without JEV_API_KEY degrades to "judge absent" instead of
    // failing search at construction time.
    return undefined;
  }

  type ResolvedSdk = { client: JevSystemOneClient; noul: JevSdkModule['noul'] };
  let initPromise: Promise<ResolvedSdk | undefined> | undefined;

  // One lazy initialization per judge instance. Failures latch onto the
  // cached promise: the warn is logged once and later calls skip silently.
  const resolveSdk = (
    logger: Pick<Logger, 'debug' | 'warn'> | undefined
  ): Promise<ResolvedSdk | undefined> => {
    if (!initPromise) {
      initPromise = (async (): Promise<ResolvedSdk | undefined> => {
        if (deps.client) {
          return {
            client: deps.client,
            noul: (instructions?: string) => ({ instructions })
          };
        }
        try {
          // Non-literal specifier on purpose: the optional SDK dependency may
          // only load when the shadow judge actually runs, and tsc must not
          // resolve its types on machines where the package is absent.
          const moduleName = '@typesafe-ai/sdk';
          const sdk = deps.loadModule
            ? await deps.loadModule()
            : ((await import(moduleName)) as unknown as JevSdkModule);
          return {
            client: new sdk.TypeSafeClient({
              apiKey: config.apiKey,
              ...(config.model ? { defaultModel: config.model } : {})
            }),
            noul: sdk.noul
          };
        } catch (error) {
          logger?.warn(
            {
              event: 'jev.unavailable',
              reason: error instanceof Error ? error.message : 'unknown error'
            },
            'jev judge initialization failed; shadow judgments disabled'
          );
          return undefined;
        }
      })();
    }
    return initPromise;
  };

  const judge: JevRetrievalJudge = async ({
    query,
    clientScope,
    candidates,
    logger
  }) => {
    const bounded = candidates.slice(0, config.maxCandidates);
    // Bound to the factory config: every digest in the shadow log (query
    // reference and per-candidate state hashes) uses the same keyed scheme.
    const digest = makeDigest(config.queryCacheSecret);
    const queryHash = hashQuery(query, clientScope, digest);
    if (bounded.length === 0) {
      return { queryHash, candidates: [] };
    }

    const sdk = await resolveSdk(logger);
    if (!sdk) {
      return {
        queryHash,
        candidates: bounded.map((candidate) => {
          // The request was never sent; hash the would-be state so the skip
          // stays attributable to an exact input.
          const stateHash = digest(JSON.stringify(buildJudgeState(query, candidate)));
          return unavailableObservation(candidate, 0, stateHash);
        })
      };
    }

    const { client, noul } = sdk;
    const observations = await Promise.all(
      bounded.map(async (candidate): Promise<JevCandidateObservation> => {
        const startedAt = Date.now();
        const elapsedMs = () => Date.now() - startedAt;
        // The state hash pins the exact judged input so a later replay can
        // verify the corpus (chunk text, tags, scores) is unchanged before
        // trusting the comparison — even though the log carries no plaintext.
        const state = buildJudgeState(query, candidate);
        const stateHash = digest(JSON.stringify(state));
        try {
          const result = await client.systemOne(
            {
              state,
              questions: {
                relevant: noul(RELEVANT_QUESTION),
                evidence: noul(EVIDENCE_QUESTION),
                contradicts: noul(CONTRADICTS_QUESTION)
              }
            },
            {
              timeout: config.timeoutMs,
              signal: AbortSignal.timeout(config.timeoutMs)
            }
          );
          const nouls = readNouls(result?.answers);
          if (!nouls) {
            logger?.debug(
              {
                event: 'jev.unavailable',
                entityId: candidate.entityId,
                latencyMs: elapsedMs(),
                reason: 'malformed jev response'
              },
              'jev candidate skipped'
            );
            return unavailableObservation(candidate, elapsedMs(), stateHash);
          }
          return {
            entityId: candidate.entityId,
            chunkId: candidate.chunkId,
            status: 'judged',
            score: candidate.score,
            similarity: candidate.similarity,
            nouls,
            model: result.model,
            latencyMs: elapsedMs(),
            stateHash,
            usage: readUsage(result?.usage)
          };
        } catch (error) {
          // Fail open. TypeSafeError, APIError, APIConnectionError,
          // APITimeoutError and APIUserAbortError all land here — any Jev
          // failure is a per-candidate skip, never a search failure.
          logger?.debug(
            {
              event: 'jev.unavailable',
              entityId: candidate.entityId,
              latencyMs: elapsedMs(),
              reason: error instanceof Error ? error.message : 'unknown error'
            },
            'jev candidate skipped'
          );
          return unavailableObservation(candidate, elapsedMs(), stateHash);
        }
      })
    );

    return { queryHash, candidates: observations };
  };

  return judge;
}

let cachedEnvJudge:
  | { envKey: string; judge: JevRetrievalJudge | undefined }
  | undefined;

/**
 * Default judge for the search path, resolved from the JEV_* env flags via
 * loadConfig. Returns undefined — without importing the SDK or constructing a
 * client — whenever the flag is off, the key is missing, or the environment
 * does not parse (e.g. unit tests running without a DATABASE_URL). The result
 * is memoized against the raw JEV_* env values. Callers that need
 * deterministic behavior should inject a judge via SearchOptions.jevJudge.
 */
export function resolveEnvJevJudge(): JevRetrievalJudge | undefined {
  const env = process.env;
  const envKey = [
    env['JEV_SHADOW_ENABLED'] ?? '',
    env['JEV_API_KEY'] ?? '',
    env['JEV_MODEL'] ?? '',
    env['JEV_TIMEOUT_MS'] ?? '',
    env['JEV_MAX_CANDIDATES'] ?? '',
    // The digest secret changes every log hash: it must participate in the
    // memoization key so runtime secret rotation is picked up.
    env['QUERY_EMBEDDING_CACHE_SECRET'] ?? ''
  ].join('|');
  if (cachedEnvJudge && cachedEnvJudge.envKey === envKey) {
    return cachedEnvJudge.judge;
  }

  let judge: JevRetrievalJudge | undefined;
  try {
    const config = loadConfig(env);
    judge =
      createJevRetrievalJudge({
        shadowEnabled: config.JEV_SHADOW_ENABLED,
        apiKey: config.JEV_API_KEY,
        model: config.JEV_MODEL,
        timeoutMs: config.JEV_TIMEOUT_MS,
        maxCandidates: config.JEV_MAX_CANDIDATES,
        queryCacheSecret: config.QUERY_EMBEDDING_CACHE_SECRET
      }) ?? undefined;
  } catch {
    // Unparseable environment (unit tests commonly run without a
    // DATABASE_URL): the judge stays off and search continues unaffected.
  }
  cachedEnvJudge = { envKey, judge };
  return judge;
}