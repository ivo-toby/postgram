/**
 * The part of the Postgram document loader contract this package uses.
 *
 * These types are copied from `src/types/loader.ts` in the server on purpose.
 * The package is built on its own and the Docker image holds built output
 * only, so a run-time or type-level import from the server source would
 * not resolve there. The host validates every result with `parseLoaderResult`,
 * so a drift between this copy and the server shows up as a clear error.
 */

export type AcceptDescriptor = {
  mimeTypes?: string[];
  extensions?: string[];
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
      filename?: string;
    };

export interface LoaderContext {
  readonly tmpDir: string;
  readonly options: Record<string, unknown>;
  readonly signal: AbortSignal;
}

export type TextBlock = {
  kind: 'text';
  text: string;
  metadata?: { page?: number };
};

export type LoaderResult = {
  documentType: string;
  blocks: TextBlock[];
  metadata?: Record<string, unknown>;
};

export interface DocumentLoader {
  readonly name: string;
  readonly version: string;
  readonly accepts: AcceptDescriptor;
  readonly priority?: number;
  load(input: LoaderInput, ctx: LoaderContext): Promise<LoaderResult>;
}
