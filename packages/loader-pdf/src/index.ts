import { readFile } from 'node:fs/promises';

import { getDocumentProxy } from 'unpdf';

import type {
  DocumentLoader,
  LoaderContext,
  LoaderInput,
  LoaderResult,
  TextBlock
} from './contract.js';
import { normalizePageText, type PdfTextItem } from './normalize.js';

export const DEFAULT_MAX_PAGES = 500;
const VERSION = '0.1.0';

function readMaxPages(options: Record<string, unknown>): number {
  const value = options.maxPages;
  if (value === undefined) return DEFAULT_MAX_PAGES;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `invalid option maxPages: expected a positive integer, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

async function readBytes(input: LoaderInput): Promise<Uint8Array> {
  if (input.kind === 'bytes') {
    // pdf.js takes ownership of the buffer, so work on a copy.
    return new Uint8Array(input.bytes);
  }
  // The buffer is ours alone, so hand it to pdf.js without another copy.
  const buf = await readFile(input.path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function describeOpenError(err: unknown): Error {
  const name = err instanceof Error ? err.name : '';
  const detail = err instanceof Error ? err.message : String(err);
  if (name === 'PasswordException') {
    return new Error(
      'the PDF is password protected and cannot be read without the password'
    );
  }
  if (name === 'InvalidPDFException' || name === 'FormatError') {
    return new Error(`the file is not a valid PDF (${detail})`);
  }
  return new Error(`the PDF cannot be read (${detail})`);
}

async function load(
  input: LoaderInput,
  ctx: LoaderContext
): Promise<LoaderResult> {
  const maxPages = readMaxPages(ctx.options);
  ctx.signal.throwIfAborted();
  const bytes = await readBytes(input);

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  } catch (err) {
    throw describeOpenError(err);
  }

  try {
    const pageCount = pdf.numPages;
    const limit = Math.min(pageCount, maxPages);
    const blocks: TextBlock[] = [];
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      ctx.signal.throwIfAborted();
      let items: PdfTextItem[];
      try {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        items = content.items as PdfTextItem[];
        page.cleanup();
      } catch (err) {
        throw new Error(
          `the PDF cannot be read: page ${pageNumber} failed to parse (${err instanceof Error ? err.message : String(err)})`
        );
      }
      const text = normalizePageText(items);
      if (text !== '') {
        blocks.push({ kind: 'text', text, metadata: { page: pageNumber } });
      }
    }

    const metadata: Record<string, unknown> = { pageCount };
    const title = await readTitle(pdf);
    if (title !== undefined) metadata.pdfTitle = title;
    if (pageCount > limit) metadata.truncated = true;

    return { documentType: 'pdf', blocks, metadata };
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

async function readTitle(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>
): Promise<string | undefined> {
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as { Title?: unknown } | undefined;
    const title = typeof info?.Title === 'string' ? info.Title.trim() : '';
    return title === '' ? undefined : title;
  } catch {
    return undefined;
  }
}

const loader: DocumentLoader = {
  name: 'pdf',
  version: VERSION,
  accepts: { mimeTypes: ['application/pdf'], extensions: ['.pdf'] },
  load
};

export default loader;
