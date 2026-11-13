import type { Block, LoaderResult } from '../../types/loader.js';

/**
 * Render loader blocks to the Markdown text stored in `entities.content`.
 *
 * - heading, code and table blocks become Markdown. Blank heading, code,
 *   transcript and text blocks render nothing. A table without a header row
 *   renders nothing; rows are padded or cut to the header width, `|` is
 *   escaped and newlines in cells become spaces. Code fences are longer than
 *   any backtick run in the body.
 * - A line `[page N]` is written directly before the first rendered block of
 *   each page. Blocks without a numeric `metadata.page` do not change the
 *   current page.
 * - Transcript blocks become `[mm:ss] speaker: text` (`[h:mm:ss]` from one hour
 *   on); the speaker is optional.
 * - An image block contributes its OCR text, else its caption, else its alt.
 * - Audio and video blocks carry no text; their transcript blocks do.
 *
 * Rendered blocks are separated by a blank line.
 */
export function renderLoaderResult(result: LoaderResult): string {
  const parts: string[] = [];
  let currentPage: number | undefined;
  for (const block of result.blocks) {
    const text = renderBlock(block);
    if (text === '') continue;
    const page = blockPage(block);
    if (page !== undefined && page !== currentPage) {
      currentPage = page;
      parts.push(`[page ${page}]\n${text}`);
    } else {
      parts.push(text);
    }
  }
  // PostgreSQL rejects NUL in text columns; PDF extractors can emit it.
  return parts.join('\n\n').replaceAll('\u0000', '');
}

function blockPage(block: Block): number | undefined {
  const page = block.metadata?.page;
  return typeof page === 'number' && Number.isFinite(page) ? page : undefined;
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'text':
      return block.text.trim() ? block.text : '';
    case 'heading':
      return block.text.trim()
        ? `${'#'.repeat(block.level)} ${oneLine(block.text)}`
        : '';
    case 'code':
      return block.text.trim() ? fencedCode(block.text, block.language) : '';
    case 'table':
      return tableToMarkdown(block.rows, block.caption);
    case 'transcript': {
      if (!block.text.trim()) return '';
      const speaker = block.speaker ? `${block.speaker}: ` : '';
      return `[${formatTimestamp(block.startSeconds)}] ${speaker}${block.text}`;
    }
    case 'image':
      return (
        [block.ocrText, block.caption, block.alt].find((t) => t?.trim()) ?? ''
      );
    case 'audio':
    case 'video':
      return '';
  }
}

function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** Fence one backtick longer than the longest backtick run in the body (min 3). */
function fencedCode(body: string, language: string | undefined): string {
  const longest = Math.max(
    0,
    ...(body.match(/`+/g) ?? []).map((run) => run.length)
  );
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const lang = (language ?? '').replace(/[\s`]/g, '');
  return `${fence}${lang}\n${body}\n${fence}`;
}

function formatTimestamp(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const seconds = Math.floor(safe);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function tableToMarkdown(rows: string[][], caption?: string): string {
  const header = rows[0];
  if (!header || header.length === 0) return '';
  const width = header.length;
  const cell = (c: string | undefined) =>
    (c ?? '').replace(/\|/g, '\\|').replace(/\s*[\r\n]+\s*/g, ' ');
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cell(row[i])).join(' | ')} |`;
  const lines: string[] = [];
  if (caption) lines.push(`**${oneLine(caption)}**`);
  lines.push(line(header));
  lines.push(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
  for (const row of rows.slice(1)) lines.push(line(row));
  return lines.join('\n');
}
