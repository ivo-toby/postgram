/** The fields of a pdf.js text item this package reads. */
export type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
  height?: number;
  transform?: number[];
};

/** A vertical gap above this many line heights counts as a paragraph break. */
const PARAGRAPH_GAP = 1.8;

/**
 * Turn the text items of one page into plain text. pdf.js marks line ends
 * with `hasEOL`. A gap between two lines that is much larger than the line
 * height becomes a blank line. Runs of spaces collapse and every line is
 * trimmed.
 */
export function normalizePageText(items: PdfTextItem[]): string {
  const lines: string[] = [];
  let current = '';
  let currentY: number | undefined;
  let lineHeight = 0;
  let pendingBreak = false;

  const flush = () => {
    const text = current.replace(/[ \t\xa0]+/g, ' ').trim();
    current = '';
    if (text === '') return;
    if (pendingBreak && lines.length > 0) lines.push('');
    pendingBreak = false;
    lines.push(text);
  };

  for (const item of items) {
    const str = item.str ?? '';
    const y = item.transform?.[5];
    const height = item.height ?? 0;
    if (str.trim() !== '' && y !== undefined) {
      if (currentY !== undefined && current.trim() === '') {
        // First text of a new line: compare with the previous line.
        const ref = Math.max(lineHeight, height);
        if (ref > 0 && Math.abs(currentY - y) > ref * PARAGRAPH_GAP) {
          pendingBreak = true;
        }
      }
      currentY = y;
      lineHeight = height;
    }
    current += str;
    if (item.hasEOL) flush();
  }
  flush();
  return lines.join('\n').replaceAll('\u0000', '').trim();
}
