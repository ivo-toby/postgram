/**
 * Pluggable document loader contracts.
 *
 * A `DocumentLoader` converts a binary input (PDF, audio, image, …) into a
 * normalised `LoaderResult` consisting of typed `Block`s and optional binary
 * `AttachmentDraft`s. The plugin host (see `src/services/loaders/`) flattens
 * the result into the existing `chunks` and the new `attachments` table.
 *
 * Design doc: specs/003-pluggable-document-loaders/contracts/loader-protocol.md
 */

export type AcceptDescriptor = {
  mimeTypes?: string[] | undefined;
  extensions?: string[] | undefined;
  /** RegExp source strings, matched against the full URL with `RegExp(.., 'i')`. */
  urlPatterns?: string[] | undefined;
};

export type LoaderInput =
  | {
      kind: 'bytes';
      bytes: Uint8Array;
      mimeType: string;
      filename?: string;
      sourceUri?: string;
    }
  | { kind: 'url'; url: string; mimeType?: string }
  | { kind: 'localPath'; path: string; mimeType: string; sourceUri?: string };

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
  /** Loader-specific options pass-through from `postgram.config.json`. */
  readonly options: Record<string, unknown>;
  readonly signal: AbortSignal;
}

export type BlockMeta = Record<string, unknown> & {
  page?: number;
  startSeconds?: number;
  endSeconds?: number;
  youtubeId?: string;
  chapter?: string | number;
  source?: 'ocr' | 'native' | 'asr' | 'caption-model';
};

export type TextBlock = { kind: 'text'; text: string; metadata?: BlockMeta };
export type HeadingBlock = {
  kind: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  metadata?: BlockMeta;
};
export type CodeBlock = {
  kind: 'code';
  text: string;
  language?: string;
  metadata?: BlockMeta;
};
export type TableBlock = {
  kind: 'table';
  rows: string[][];
  caption?: string;
  metadata?: BlockMeta;
};
export type TranscriptBlock = {
  kind: 'transcript';
  text: string;
  startSeconds: number;
  endSeconds: number;
  speaker?: string;
  metadata?: BlockMeta;
};
export type ImageBlock = {
  kind: 'image';
  attachmentRef: string;
  alt?: string;
  ocrText?: string;
  caption?: string;
  metadata?: BlockMeta;
};
export type AudioBlock = {
  kind: 'audio';
  attachmentRef: string;
  durationSeconds: number;
  metadata?: BlockMeta;
};
export type VideoBlock = {
  kind: 'video';
  attachmentRef: string;
  durationSeconds: number;
  thumbnailRef?: string;
  metadata?: BlockMeta;
};

export type Block =
  | TextBlock
  | HeadingBlock
  | CodeBlock
  | TableBlock
  | TranscriptBlock
  | ImageBlock
  | AudioBlock
  | VideoBlock;

export type AttachmentKind = 'image' | 'audio' | 'video' | 'binary';

export type AttachmentDraft = {
  /**
   * Stable handle blocks reference via `attachmentRef`. Conventionally the
   * lowercase hex sha256 of the bytes; the host treats it opaquely.
   */
  ref: string;
  kind: AttachmentKind;
  mimeType: string;
  source: { kind: 'bytes'; bytes: Uint8Array } | { kind: 'path'; path: string };
  metadata?: Record<string, unknown>;
};

export type LoaderResult = {
  documentType: string;
  blocks: Block[];
  attachments?: AttachmentDraft[];
  metadata?: Record<string, unknown>;
};

export interface DocumentLoader {
  readonly name: string;
  readonly version: string;
  readonly accepts: AcceptDescriptor;
  readonly priority?: number;
  load(input: LoaderInput, ctx: LoaderContext): Promise<LoaderResult>;
}

/** Reasons a loader resolution can fail; surfaced in `enrichment_error`. */
export type LoaderResolutionError =
  | { code: 'no_loader'; reason: string }
  | { code: 'multiple_loaders'; reason: string; candidates: string[] };
