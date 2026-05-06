import { z } from 'zod';

// Blank env strings (`FOO=`) should behave the same as unset — zod's
// `.optional()` alone does not coerce empty strings to undefined, which would
// silently break `a ?? b` fallback chains that depend on blank == unset.
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const configSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    OPENAI_API_KEY: optionalString,
    PORT: z.coerce.number().int().positive().default(3100),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
    ENRICHMENT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    EXTRACTION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    EXTRACTION_PROVIDER: z
      .enum(['openai', 'anthropic', 'ollama'])
      .default('openai'),
    EXTRACTION_MODEL: optionalString,
    EXTRACTION_DISABLE_THINKING: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    EXTRACTION_REASONING_EFFORT: z
      .preprocess(
        emptyToUndefined,
        z.enum(['minimal', 'low', 'medium', 'high']).optional()
      ),
    EXTRACTION_AUTO_CREATE_ENTITIES: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    EXTRACTION_AUTO_CREATE_TYPES: z
      .preprocess(
        emptyToUndefined,
        z.string().default('person,project,interaction')
      )
      .transform((value) =>
        value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      )
      .pipe(
        z.array(
          z.enum(['memory', 'person', 'project', 'task', 'interaction', 'document'])
        )
      ),
    EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE: z.preprocess(
      emptyToUndefined,
      z.coerce.number().min(0).max(1).default(0.7)
    ),
    // Per-type confidence floor overrides for auto-create. Format:
    // `person:0.5,project:0.6`. Types not listed fall back to
    // EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE. Default targets the dominant
    // failure mode in production: persons emitted at 0.5–0.7 were blocked by
    // the global 0.7 threshold and never became nodes.
    EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE: z
      .preprocess(
        emptyToUndefined,
        z.string().default('person:0.5,project:0.6')
      )
      .transform((value, ctx) => {
        const result: Record<string, number> = {};
        const parts = value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        for (const part of parts) {
          const [rawType, rawValue] = part.split(':').map((s) => s.trim());
          if (!rawType || !rawValue) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Expected "type:number" pair, got "${part}"`
            });
            return z.NEVER;
          }
          if (
            !['memory', 'person', 'project', 'task', 'interaction', 'document']
              .includes(rawType)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Unknown type "${rawType}" in EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE`
            });
            return z.NEVER;
          }
          const num = Number(rawValue);
          if (!Number.isFinite(num) || num < 0 || num > 1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Confidence for "${rawType}" must be 0..1, got "${rawValue}"`
            });
            return z.NEVER;
          }
          result[rawType] = num;
        }
        return result;
      }),
    EXTRACTION_MATCH_MIN_SIMILARITY: z.preprocess(
      emptyToUndefined,
      z.coerce.number().min(0).max(1).default(0.5)
    ),
    // Inputs shorter than this many trimmed characters are skipped before
    // hitting the LLM. Default 80 covers the cluster of short
    // personality/prompt fragment files that produced `Ollama API error: 400`
    // in production. Set to 0 to disable.
    EXTRACTION_MIN_CONTENT_CHARS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(0).default(80)
    ),
    // When true, the enrichment worker logs the raw LLM response and a
    // per-target decision (matched_existing / auto_created /
    // skipped_below_confidence / skipped_type_not_allowed /
    // skipped_auto_create_disabled / skipped_type_unknown /
    // deferred_semantic_skipped / edge_failed) for every extraction it
    // processes. Off by default — turn on briefly to diagnose "why are
    // person edges missing?" without globally raising LOG_LEVEL to debug.
    EXTRACTION_DEBUG_LOG: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // When true, a second extraction pass runs after LLM extraction that
    // finds existing entities with high embedding similarity to the source
    // and links them with `related_to`. Catches thematically-related
    // entities that the LLM pass misses because they are not explicitly
    // named in the source content.
    EXTRACTION_SEMANTIC_NEIGHBORS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    EXTRACTION_SEMANTIC_NEIGHBORS_MAX: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().default(10)
    ),
    // Higher than EXTRACTION_MATCH_MIN_SIMILARITY: we want genuine topical
    // siblings, not just paraphrase matches for an extracted target name.
    EXTRACTION_SEMANTIC_NEIGHBORS_MIN_SIMILARITY: z.preprocess(
      emptyToUndefined,
      z.coerce.number().min(0).max(1).default(0.65)
    ),
    ANTHROPIC_API_KEY: optionalString,
    OLLAMA_API_KEY: optionalString,
    OLLAMA_BASE_URL: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default('http://localhost:11434')
    ),
    EMBEDDING_PROVIDER: z.enum(['openai', 'ollama']).default('openai'),
    EMBEDDING_MODEL: optionalString,
    EMBEDDING_DIMENSIONS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().optional()
    ),
    EMBEDDING_BASE_URL: optionalString,
    EMBEDDING_API_KEY: optionalString
  })
  .superRefine((cfg, ctx) => {
    const needsOpenAiForEmbedding = cfg.EMBEDDING_PROVIDER === 'openai';
    const needsOpenAiForExtraction =
      cfg.EXTRACTION_ENABLED && cfg.EXTRACTION_PROVIDER === 'openai';

    if ((needsOpenAiForEmbedding || needsOpenAiForExtraction) && !cfg.OPENAI_API_KEY) {
      const reasons: string[] = [];
      if (needsOpenAiForEmbedding) {
        reasons.push('EMBEDDING_PROVIDER=openai');
      }
      if (needsOpenAiForExtraction) {
        reasons.push('EXTRACTION_ENABLED=true with EXTRACTION_PROVIDER=openai');
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: `OPENAI_API_KEY is required because ${reasons.join(' and ')}`
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(env);
}
