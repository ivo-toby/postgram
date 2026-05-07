import type { AcceptDescriptor, LoaderInput } from '../../types/loader.js';

/**
 * Returns true if `loader.accepts` matches `input`. Match rules:
 *
 * - URL inputs match if any `urlPatterns` regex matches the full URL OR the
 *   URL ends with one of the configured `extensions`.
 * - Bytes/localPath inputs match if `mimeType` is in `mimeTypes` OR (when a
 *   filename is supplied) the filename's extension is in `extensions`.
 *
 * Empty fields are treated as "don't match on this dimension".
 */
export function accepts(
  desc: AcceptDescriptor,
  input: LoaderInput,
): boolean {
  if (input.kind === 'url') {
    if (matchesUrlPatterns(desc.urlPatterns, input.url)) return true;
    if (matchesExtension(desc.extensions, urlPathname(input.url))) return true;
    if (input.mimeType && matchesMime(desc.mimeTypes, input.mimeType))
      return true;
    return false;
  }

  if (matchesMime(desc.mimeTypes, input.mimeType)) return true;
  const filename = input.kind === 'bytes' ? input.filename : input.path;
  if (filename && matchesExtension(desc.extensions, filename)) return true;
  return false;
}

function matchesMime(
  patterns: string[] | undefined,
  mimeType: string,
): boolean {
  if (!patterns || patterns.length === 0) return false;
  const lower = mimeType.toLowerCase();
  for (const pat of patterns) {
    const p = pat.toLowerCase();
    if (p === lower) return true;
    if (p.endsWith('/*')) {
      const prefix = p.slice(0, p.length - 1);
      if (lower.startsWith(prefix)) return true;
    }
  }
  return false;
}

function matchesExtension(
  exts: string[] | undefined,
  filename: string,
): boolean {
  if (!exts || exts.length === 0) return false;
  const lower = filename.toLowerCase();
  for (const ext of exts) {
    if (lower.endsWith(ext.toLowerCase())) return true;
  }
  return false;
}

function matchesUrlPatterns(
  patterns: string[] | undefined,
  url: string,
): boolean {
  if (!patterns || patterns.length === 0) return false;
  for (const src of patterns) {
    try {
      if (new RegExp(src, 'i').test(url)) return true;
    } catch {
      // Invalid regex strings are silently treated as non-matching; the
      // config schema validates them up-front so this should never fire in
      // production, but we don't want a typo to crash dispatch.
    }
  }
  return false;
}

function urlPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
