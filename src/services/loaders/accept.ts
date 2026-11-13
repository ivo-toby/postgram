import type { AcceptDescriptor } from '../../types/loader.js';

/**
 * Lowercase MIME type without parameters: `Application/PDF; charset=x`
 * becomes `application/pdf`. Missing input gives an empty string.
 */
export function normalizeMimeType(raw: string | undefined): string {
  return (raw ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * True if the (normalised) MIME type is listed in `desc.mimeTypes`. A pattern
 * ending in `/*` matches every subtype. An empty type never matches.
 */
export function matchesMimeType(
  desc: AcceptDescriptor,
  mimeType: string
): boolean {
  const patterns = desc.mimeTypes;
  if (!patterns || patterns.length === 0 || mimeType === '') return false;
  const lower = mimeType.toLowerCase();
  for (const pat of patterns) {
    const p = pat.toLowerCase();
    if (p === lower) return true;
    if (p.endsWith('/*') && lower.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

/** True if `filename` ends with one of `desc.extensions` (case-insensitive). */
export function matchesExtension(
  desc: AcceptDescriptor,
  filename: string
): boolean {
  const exts = desc.extensions;
  if (!exts || exts.length === 0 || !filename) return false;
  const lower = filename.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext.toLowerCase()));
}
