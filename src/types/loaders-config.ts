import { z } from 'zod';

/**
 * Schema of the optional loaders configuration file (`LOADERS_CONFIG_PATH`).
 * Without a file the built-in default applies, see `config-loader.ts`.
 */

const acceptDescriptorSchema = z
  .object({
    mimeTypes: z.array(z.string().min(1)).optional(),
    extensions: z
      .array(
        z
          .string()
          .min(1)
          .refine(
            (v) => v.startsWith('.'),
            'extension must start with a dot, e.g. ".pdf"'
          )
      )
      .optional()
  })
  .refine(
    (v) => (v.mimeTypes?.length ?? 0) + (v.extensions?.length ?? 0) > 0,
    'accepts must declare at least one of mimeTypes or extensions'
  );

const inProcessLoaderSchema = z.object({
  kind: z.literal('in-process'),
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be lowercase kebab-case'),
  package: z.string().min(1),
  accepts: acceptDescriptorSchema,
  priority: z.number().int().default(0),
  options: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true)
});

const sidecarTransportSchema = z
  .object({
    mode: z.enum(['multipart', 'shared-volume']).default('multipart'),
    hostPath: z.string().optional(),
    sidecarPath: z.string().optional()
  })
  .default({ mode: 'multipart' as const })
  .refine(
    (t) =>
      t.mode === 'multipart' ||
      (typeof t.hostPath === 'string' && typeof t.sidecarPath === 'string'),
    'shared-volume transport requires both hostPath and sidecarPath'
  );

const sidecarLoaderSchema = z.object({
  kind: z.literal('sidecar'),
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be lowercase kebab-case'),
  endpoint: z.string().url(),
  accepts: acceptDescriptorSchema,
  priority: z.number().int().default(0),
  /** Per-call timeout. Unset: the host's `LOADER_TIMEOUT_MS` signal applies. */
  timeoutMs: z.number().int().positive().optional(),
  /** Largest payload uploaded to the sidecar. */
  maxBytes: z
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
  /** Largest `/load` response body the host reads. */
  maxResponseBytes: z
    .number()
    .int()
    .positive()
    .default(64 * 1024 * 1024),
  transport: sidecarTransportSchema,
  options: z.record(z.unknown()).default({}),
  sharedSecret: z.string().min(1).optional(),
  enabled: z.boolean().default(true)
});

export const loaderConfigSchema = z.discriminatedUnion('kind', [
  inProcessLoaderSchema,
  sidecarLoaderSchema
]);

export const loadersConfigSchema = z
  .object({
    version: z.literal(1),
    pluginsDir: z.string().min(1).optional(),
    loaders: z.array(loaderConfigSchema).default([])
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (const loader of cfg.loaders) {
      if (seen.has(loader.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['loaders'],
          message: `duplicate loader name: ${loader.name}`
        });
      }
      seen.add(loader.name);
    }
  });

export type LoadersConfig = z.infer<typeof loadersConfigSchema>;
export type LoaderConfig = z.infer<typeof loaderConfigSchema>;
export type InProcessLoaderConfig = z.infer<typeof inProcessLoaderSchema>;
export type SidecarLoaderConfig = z.infer<typeof sidecarLoaderSchema>;
