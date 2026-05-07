import { z } from 'zod';

/**
 * Schema for `postgram.config.json` — the structured config file that lives
 * alongside env vars. Env vars stay the source of truth for secrets and
 * connection strings. This file is for things that don't fit (loader
 * registry, future structured config).
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
            'extension must start with a dot, e.g. ".pdf"',
          ),
      )
      .optional(),
    urlPatterns: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (v) =>
      (v.mimeTypes?.length ?? 0) +
        (v.extensions?.length ?? 0) +
        (v.urlPatterns?.length ?? 0) >
      0,
    'accepts must declare at least one of mimeTypes, extensions, or urlPatterns',
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
  enabled: z.boolean().default(true),
});

const sidecarTransportSchema = z
  .object({
    mode: z.enum(['multipart', 'shared-volume']).default('multipart'),
    hostPath: z.string().optional(),
    sidecarPath: z.string().optional(),
  })
  .default({ mode: 'multipart' as const })
  .refine(
    (t) =>
      t.mode === 'multipart' ||
      (typeof t.hostPath === 'string' && typeof t.sidecarPath === 'string'),
    'shared-volume transport requires both hostPath and sidecarPath',
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
  timeoutMs: z.number().int().positive().default(120_000),
  maxBytes: z
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
  concurrency: z.number().int().positive().default(1),
  healthCheckIntervalMs: z.number().int().positive().default(30_000),
  transport: sidecarTransportSchema,
  options: z.record(z.unknown()).default({}),
  sharedSecret: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
});

export const loaderConfigSchema = z.discriminatedUnion('kind', [
  inProcessLoaderSchema,
  sidecarLoaderSchema,
]);

export const postgramConfigSchema = z
  .object({
    version: z.literal(1),
    pluginsDir: z.string().min(1).default('/etc/postgram/plugins'),
    attachmentsDir: z.string().min(1).default('/var/postgram/attachments'),
    loaders: z.array(loaderConfigSchema).default([]),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (const loader of cfg.loaders) {
      if (seen.has(loader.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['loaders'],
          message: `duplicate loader name: ${loader.name}`,
        });
      }
      seen.add(loader.name);
    }
  });

export type PostgramConfig = z.infer<typeof postgramConfigSchema>;
export type LoaderConfig = z.infer<typeof loaderConfigSchema>;
export type InProcessLoaderConfig = z.infer<typeof inProcessLoaderSchema>;
export type SidecarLoaderConfig = z.infer<typeof sidecarLoaderSchema>;
