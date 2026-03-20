export type ChunkTextOptions = {
  chunkSize?: number;
  overlap?: number;
  separators?: string[];
};

export type ChunkDraft = {
  chunkIndex: number;
  content: string;
  tokenCount: number;
};

const DEFAULT_CHUNK_SIZE = 300;
const DEFAULT_OVERLAP = 100;
const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ' '];

export function estimateTokenCount(text: string): number {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return Math.max(tokens.length, 1);
}

function findSplitPoint(
  text: string,
  start: number,
  maxEnd: number,
  separators: string[]
): number {
  for (const separator of separators) {
    const candidate = text.lastIndexOf(separator, maxEnd);
    if (candidate > start + Math.floor((maxEnd - start) / 2)) {
      return candidate + separator.length;
    }
  }

  return maxEnd;
}

export function chunkText(
  text: string,
  options: ChunkTextOptions = {}
): ChunkDraft[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const separators = options.separators ?? DEFAULT_SEPARATORS;

  const chunks: ChunkDraft[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < normalized.length) {
    const rawEnd = Math.min(start + chunkSize, normalized.length);
    const end =
      rawEnd === normalized.length
        ? rawEnd
        : findSplitPoint(normalized, start, rawEnd, separators);
    const content = normalized.slice(start, end).trim();

    if (content) {
      chunks.push({
        chunkIndex,
        content,
        tokenCount: estimateTokenCount(content)
      });
      chunkIndex += 1;
    }

    if (end >= normalized.length) {
      break;
    }

    const nextStart = Math.max(0, end - overlap);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}
