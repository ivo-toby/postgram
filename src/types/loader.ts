/**
 * Document loader contracts.
 *
 * A `DocumentLoader` converts a binary input (PDF, audio, image, …) into a
 * normalised `LoaderResult` consisting of typed `Block`s and optional binary
 * `AttachmentDraft`s. The host (see `src/services/loaders/`) renders the
 * blocks to the text of an entity and stores the attachments.
 *
 * The result types are inferred from `loaderResultSchema`. Loader output is
 * untrusted, so the host runs it through `parseLoaderResult` before use.
 *
 * Package contract for in-process loaders: the package must be resolvable
 * with CommonJS conditions, because the host locates it with
 * `require.resolve`. Give it a `main` field, or an `exports` entry with a
 * `"default"` or `"require"` condition (an `exports` map that only has an
 * `"import"` condition cannot be found). It must export the loader as its
 * default export or as a named `loader` export.
 */

import { z } from 'zod';

export type AcceptDescriptor = {
  mimeTypes?: string[] | undefined;
  extensions?: string[] | undefined;
};

export type LoaderInput =
  | {
      kind: 'bytes';
      bytes: Uint8Array;
      mimeType: string;
      filename?: string;
    }
  | {
      kind: 'localPath';
      path: string;
      mimeType: string;
      /**
       * Original filename. The attachment store keeps files without an
       * extension, so extension matching and sidecar uploads need this.
       */
      filename?: string;
    };

export interface LoaderLogger {
  trace(payload: Record<string, unknown> | string, message?: string): void;
  debug(payload: Record<string, unknown> | string, message?: string): void;
  info(payload: Record<string, unknown> | string, message?: string): void;
  warn(payload: Record<string, unknown> | string, message?: string): void;
  error(payload: Record<string, unknown> | string, message?: string): void;
}

export interface LoaderContext {
  /** Per-call scratch directory the host cleans up after `load()` resolves. */
  readonly tmpDir: string;
  readonly logger: LoaderLogger;
  /** Bounded fetch — respects host-configured timeout and signal. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Loader-specific options pass-through from the loaders config file. */
  readonly options: Record<string, unknown>;
  readonly signal: AbortSignal;
}

const seconds = z.number().finite().nonnegative();
const metadataRecord = z.record(z.unknown());

const blockMetaSchema = z
  .object({
    page: z.number().int().positive().optional(),
    startSeconds: seconds.optional(),
    endSeconds: seconds.optional(),
    youtubeId: z.string().optional(),
    chapter: z.union([z.string(), z.number()]).optional(),
    source: z.enum(['ocr', 'native', 'asr', 'caption-model']).optional()
  })
  .passthrough();

const textBlockSchema = z.object({
  kind: z.literal('text'),
  text: z.string(),
  metadata: blockMetaSchema.optional()
});
const headingBlockSchema = z.object({
  kind: z.literal('heading'),
  level: z.number().int().min(1).max(6),
  text: z.string(),
  metadata: blockMetaSchema.optional()
});
const codeBlockSchema = z.object({
  kind: z.literal('code'),
  text: z.string(),
  language: z.string().optional(),
  metadata: blockMetaSchema.optional()
});
const tableBlockSchema = z.object({
  kind: z.literal('table'),
  rows: z.array(z.array(z.string())),
  caption: z.string().optional(),
  metadata: blockMetaSchema.optional()
});
const transcriptBlockSchema = z.object({
  kind: z.literal('transcript'),
  text: z.string(),
  startSeconds: seconds,
  endSeconds: seconds,
  speaker: z.string().optional(),
  metadata: blockMetaSchema.optional()
});
const imageBlockSchema = z.object({
  kind: z.literal('image'),
  attachmentRef: z.string(),
  alt: z.string().optional(),
  ocrText: z.string().optional(),
  caption: z.string().optional(),
  metadata: blockMetaSchema.optional()
});
const audioBlockSchema = z.object({
  kind: z.literal('audio'),
  attachmentRef: z.string(),
  durationSeconds: seconds,
  metadata: blockMetaSchema.optional()
});
const videoBlockSchema = z.object({
  kind: z.literal('video'),
  attachmentRef: z.string(),
  durationSeconds: seconds,
  thumbnailRef: z.string().optional(),
  metadata: blockMetaSchema.optional()
});

export const blockSchema = z.discriminatedUnion('kind', [
  textBlockSchema,
  headingBlockSchema,
  codeBlockSchema,
  tableBlockSchema,
  transcriptBlockSchema,
  imageBlockSchema,
  audioBlockSchema,
  videoBlockSchema
]);

export const attachmentKindSchema = z.enum([
  'document',
  'image',
  'audio',
  'video',
  'binary'
]);

/** Where the bytes of an attachment come from, as seen by the host. */
const hostAttachmentSourceSchema = z.union([
  z.object({ kind: z.literal('bytes'), bytes: z.instanceof(Uint8Array) }),
  z.object({ kind: z.literal('path'), path: z.string().min(1) })
]);

/**
 * Build the result schema for a given attachment `source` schema. The host
 * schema allows `bytes` and `path`; the sidecar wire schema allows base64
 * only (see `sidecar-client.ts`).
 */
export function createLoaderResultSchema<S extends z.ZodTypeAny>(source: S) {
  return z.object({
    documentType: z.string().min(1),
    blocks: z.array(blockSchema),
    attachments: z
      .array(
        z.object({
          /**
           * Stable handle blocks reference via `attachmentRef`. Conventionally
           * the lowercase hex sha256 of the bytes; the host treats it opaquely.
           */
          ref: z.string().min(1),
          kind: attachmentKindSchema,
          mimeType: z.string().min(1),
          source,
          metadata: metadataRecord.optional()
        })
      )
      .optional(),
    metadata: metadataRecord.optional()
  });
}

export const loaderResultSchema = createLoaderResultSchema(
  hostAttachmentSourceSchema
);

export type BlockMeta = z.infer<typeof blockMetaSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
export type HeadingBlock = z.infer<typeof headingBlockSchema>;
export type CodeBlock = z.infer<typeof codeBlockSchema>;
export type TableBlock = z.infer<typeof tableBlockSchema>;
export type TranscriptBlock = z.infer<typeof transcriptBlockSchema>;
export type ImageBlock = z.infer<typeof imageBlockSchema>;
export type AudioBlock = z.infer<typeof audioBlockSchema>;
export type VideoBlock = z.infer<typeof videoBlockSchema>;
export type Block = z.infer<typeof blockSchema>;
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;
export type LoaderResult = z.infer<typeof loaderResultSchema>;
export type AttachmentDraft = NonNullable<LoaderResult['attachments']>[number];

export class LoaderResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoaderResultError';
  }
}

/** Parse untrusted loader output against `schema`; throws `LoaderResultError`. */
export function parseLoaderResultWith<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown
): z.output<S> {
  const parsed = schema.safeParse(value) as z.SafeParseReturnType<
    unknown,
    z.output<S>
  >;
  // `data` is typed from the caller's schema, which the generic cannot see.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  if (parsed.success) return parsed.data;
  const shown = parsed.error.issues.slice(0, 10).map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `${where}: ${issue.message}`;
  });
  const more = parsed.error.issues.length - shown.length;
  throw new LoaderResultError(
    `invalid loader result — ${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}`
  );
}

/** Validate the output of an in-process loader. Throws `LoaderResultError`. */
export function parseLoaderResult(value: unknown): LoaderResult {
  return parseLoaderResultWith(loaderResultSchema, value);
}

export interface DocumentLoader {
  readonly name: string;
  readonly version: string;
  readonly accepts: AcceptDescriptor;
  readonly priority?: number;
  load(input: LoaderInput, ctx: LoaderContext): Promise<LoaderResult>;
}

/** Why a loader could not be resolved; surfaced in `loading_error`. */
export type LoaderResolutionError = { code: 'no_loader'; reason: string };
