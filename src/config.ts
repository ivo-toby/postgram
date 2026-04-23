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
