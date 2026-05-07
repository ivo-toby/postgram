import { chunkText, estimateTokenCount } from '../chunking-service.js';
import type {
  Block,
  BlockMeta,
  LoaderResult,
} from '../../types/loader.js';

/**
 * One row destined for the `chunks` table, carrying its source block's
 * provenance so retrieval can return `{ page: 3 }` or `{ startSeconds: 124 }`
 * alongside the matched text.
 */
export type LoaderChunkDraft = {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  blockKind: Block['kind'];
  blockMetadata: Record<string, unknown>;
};

export type FlattenOptions = {
  /** Chunk-size threshold above which a block is split into multiple chunks. */
  maxChunkSize?: number;
};

/**
 * Convert loader blocks into a sequence of chunk drafts.
 *
 * Rules:
 * - text/heading/code/transcript blocks → one chunk each (split if too large).
 *   The block-level metadata is duplicated onto every sub-chunk so per-page or
 *   per-timestamp filters still work after splitting.
 * - table blocks → rendered to Markdown and treated as a text chunk.
 * - image/audio/video blocks → contribute a sibling text chunk if the loader
 *   supplied caption / ocrText / transcript metadata. The binary itself is
 *   handled by the attachment writer, not here.
 */
export function flattenLoaderResult(
  result: LoaderResult,
  options: FlattenOptions = {},
): LoaderChunkDraft[] {
  const drafts: LoaderChunkDraft[] = [];
  let chunkIndex = 0;

  for (const block of result.blocks) {
    const candidates = renderBlockToText(block);
    for (const cand of candidates) {
      const meta = mergeMeta(block, cand.extraMeta);
      const sub = splitIfNeeded(cand.text, options.maxChunkSize);
      for (const piece of sub) {
        drafts.push({
          chunkIndex: chunkIndex++,
          content: piece.content,
          tokenCount: piece.tokenCount,
          blockKind: block.kind,
          blockMetadata: meta,
        });
      }
    }
  }

  return drafts;
}

type RenderedPiece = {
  text: string;
  extraMeta?: Record<string, unknown>;
};

function renderBlockToText(block: Block): RenderedPiece[] {
  switch (block.kind) {
    case 'text':
      return block.text.trim() ? [{ text: block.text }] : [];
    case 'heading':
      return [{ text: `${'#'.repeat(block.level)} ${block.text}` }];
    case 'code': {
      const fence = block.language ?? '';
      return [{ text: `\`\`\`${fence}\n${block.text}\n\`\`\`` }];
    }
    case 'table':
      return [{ text: tableToMarkdown(block.rows, block.caption) }];
    case 'transcript': {
      const speaker = block.speaker ? `${block.speaker}: ` : '';
      return [
        {
          text: `${speaker}${block.text}`,
          extraMeta: {
            startSeconds: block.startSeconds,
            endSeconds: block.endSeconds,
            ...(block.speaker !== undefined ? { speaker: block.speaker } : {}),
          },
        },
      ];
    }
    case 'image': {
      const pieces: RenderedPiece[] = [];
      if (block.ocrText?.trim()) {
        pieces.push({
          text: block.ocrText,
          extraMeta: { source: 'ocr', attachmentRef: block.attachmentRef },
        });
      }
      if (block.caption?.trim()) {
        pieces.push({
          text: block.caption,
          extraMeta: {
            source: 'caption-model',
            attachmentRef: block.attachmentRef,
          },
        });
      }
      if (block.alt?.trim() && pieces.length === 0) {
        pieces.push({
          text: block.alt,
          extraMeta: { source: 'native', attachmentRef: block.attachmentRef },
        });
      }
      return pieces;
    }
    case 'audio':
    case 'video':
      // Audio/video carry their searchable text in transcript blocks emitted
      // by the loader. The block itself only references the attachment.
      return [];
  }
}

function mergeMeta(
  block: Block,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const blockMeta: BlockMeta | undefined = (block as { metadata?: BlockMeta })
    .metadata;
  return { ...(blockMeta ?? {}), ...(extra ?? {}) };
}

function tableToMarkdown(rows: string[][], caption?: string): string {
  if (rows.length === 0) return caption ?? '';
  const header = rows[0]!;
  const sep = header.map(() => '---');
  const body = rows.slice(1);
  const lines: string[] = [];
  if (caption) lines.push(`**${caption}**`);
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${sep.join(' | ')} |`);
  for (const row of body) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

function splitIfNeeded(
  text: string,
  maxChunkSize: number | undefined,
): Array<{ content: string; tokenCount: number }> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const limit = maxChunkSize;
  if (!limit || trimmed.length <= limit) {
    return [{ content: trimmed, tokenCount: estimateTokenCount(trimmed) }];
  }
  return chunkText(trimmed, { chunkSize: limit }).map((c) => ({
    content: c.content,
    tokenCount: c.tokenCount,
  }));
}

/**
 * Render a LoaderResult to a plain-text snapshot suitable for storing in
 * `entities.content`. Used when the entity didn't come in with text content
 * already (i.e. binary uploads). Lossy by design — the structured form lives
 * in chunks + attachments.
 */
export function loaderResultToContent(result: LoaderResult): string {
  const lines: string[] = [];
  for (const block of result.blocks) {
    for (const piece of renderBlockToText(block)) {
      lines.push(piece.text);
    }
  }
  return lines.join('\n\n');
}
