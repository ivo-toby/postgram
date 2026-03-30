import { describe, expect, it } from 'vitest';

import { extractTitle } from '../../src/services/sync-service.js';

describe('extractTitle', () => {
  it('extracts title from first h1 heading', () => {
    const content = '# Project Alpha\n\nSome content here.';
    expect(extractTitle(content, 'project-alpha.md')).toBe('Project Alpha');
  });

  it('uses filename without extension when no heading found', () => {
    const content = 'Just plain text without headings.';
    expect(extractTitle(content, 'my-notes.md')).toBe('my-notes');
  });

  it('ignores h2 and deeper headings', () => {
    const content = '## Section Title\n\nContent.';
    expect(extractTitle(content, 'doc.md')).toBe('doc');
  });

  it('trims whitespace from extracted title', () => {
    const content = '#   Spaced Title  \n\nContent.';
    expect(extractTitle(content, 'file.md')).toBe('Spaced Title');
  });

  it('handles nested path filenames', () => {
    const content = 'No heading.';
    expect(extractTitle(content, 'deeply/nested/my-doc.md')).toBe('my-doc');
  });
});
