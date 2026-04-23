import type { Entity } from './types.ts';

function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const rest = text.slice(3);
  const close = rest.indexOf('\n---');
  if (close === -1) return text;
  return rest.slice(close + 4).trimStart();
}

/**
 * Best-effort human-readable title for an entity. Prefers explicit metadata
 * fields, then strips YAML frontmatter from the content and returns the first
 * meaningful line (stripping markdown heading markers). Falls back to a short
 * id prefix.
 */
export function entityTitle(entity: Entity, max = 80): string {
  const meta = (entity.metadata ?? {}) as Record<string, unknown>;
  const metaCandidates = ['title', 'name', 'path', 'summary'];
  for (const key of metaCandidates) {
    const v = meta[key];
    if (typeof v === 'string' && v.trim()) {
      const t = v.trim();
      return t.length > max ? t.slice(0, max) + '…' : t;
    }
  }
  const body = stripFrontmatter((entity.content ?? '').trim());
  if (!body) return entity.id.slice(0, 8);
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/^#+\s+/, '').trim();
    if (!line || line === '---') continue;
    return line.length > max ? line.slice(0, max) + '…' : line;
  }
  return entity.id.slice(0, 8);
}
