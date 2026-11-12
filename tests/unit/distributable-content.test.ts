import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ALLOWED_PUBLIC_NAMESPACE_REFERENCES = [
  /https:\/\/github\.com\/ivo-toby\/postgram(?:\.git)?/giu,
  /ghcr\.io\/ivo-toby\/postgram/giu,
  /io\.github\.ivo-toby\/postgram/giu
];

const DISALLOWED_PERSONAL_REFERENCES = [
  { label: 'personal display name', pattern: /\bIvo\b/iu },
  { label: 'private home path', pattern: /\/home\/ivo\b/iu },
  {
    label: 'private production hostname',
    pattern: /postgram\.cloud\.toby\.nu/iu
  }
];

function disallowedReferences(line: string) {
  const prose = ALLOWED_PUBLIC_NAMESPACE_REFERENCES.reduce(
    (sanitized, reference) => sanitized.replace(reference, ''),
    line
  );

  return DISALLOWED_PERSONAL_REFERENCES.filter((reference) =>
    reference.pattern.test(prose)
  );
}

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return markdownFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
    })
  );

  return nested.flat();
}

describe('distributable documentation privacy', () => {
  it('rejects namespace-like personal prose outside public namespace URLs', () => {
    expect(
      disallowedReferences('Ivo-toby prefers this configuration')
    ).toHaveLength(1);
    expect(
      disallowedReferences('https://github.com/ivo-toby/postgram')
    ).toHaveLength(0);
  });

  it('keeps personal examples and private infrastructure out of public prose', async () => {
    const files = [
      'README.md',
      'cli/README.md',
      ...(await markdownFiles('skill')),
      ...(await markdownFiles('templates')),
      ...(await markdownFiles('docs')).filter(
        (file) => file !== path.join('docs', 'LICENSE.md')
      )
    ];
    const violations: string[] = [];

    for (const file of files) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        for (const reference of disallowedReferences(line)) {
          violations.push(`${file}:${index + 1} ${reference.label}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});

describe('skill frontmatter', () => {
  it('quotes values that a YAML parser would otherwise split', async () => {
    const skill = await readFile(
      path.join(process.cwd(), 'skill/postgram/SKILL.md'),
      'utf8'
    );
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1];
    expect(frontmatter).toBeDefined();

    for (const line of (frontmatter ?? '').split('\n')) {
      const value = /^[\w-]+:\s+(.*)$/.exec(line)?.[1] ?? '';
      const quoted = /^'(?:[^']|'')*'$/.test(value) || /^".*"$/.test(value);
      if (quoted) continue;
      // In a plain scalar, ": " starts a mapping and " #" starts a comment.
      expect(value).not.toMatch(/: | #/);
    }
  });
});
