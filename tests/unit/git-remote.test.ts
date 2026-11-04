import { describe, expect, it } from 'vitest';

import { normalizeRemote } from '../../src/util/git-remote.js';

const CANONICAL = 'github.com/ivo-toby/postgram';

describe('normalizeRemote', () => {
  it('normalizes the three contract vectors', () => {
    expect(normalizeRemote('git@github.com:Ivo-Toby/postgram.git')).toBe(
      CANONICAL
    );
    expect(normalizeRemote('https://github.com/ivo-toby/postgram')).toBe(
      CANONICAL
    );
    expect(
      normalizeRemote('ssh://git@github.com:22/ivo-toby/postgram.git')
    ).toBe(CANONICAL);
  });

  it('handles every supported remote form', () => {
    expect(normalizeRemote('http://github.com/ivo-toby/postgram.git')).toBe(
      CANONICAL
    );
    expect(normalizeRemote('git://github.com/ivo-toby/postgram')).toBe(
      CANONICAL
    );
    expect(normalizeRemote('ssh://github.com/ivo-toby/postgram.git')).toBe(
      CANONICAL
    );
    expect(normalizeRemote('https://github.com:443/ivo-toby/postgram')).toBe(
      CANONICAL
    );
    expect(normalizeRemote('git@github.com:ivo-toby/postgram')).toBe(CANONICAL);
    expect(normalizeRemote('github.com:Ivo-Toby/postgram.git')).toBe(CANONICAL);
  });

  it('strips credentials and ports from http(s) URLs', () => {
    expect(
      normalizeRemote('https://user:password@github.com/Ivo-Toby/postgram.git')
    ).toBe(CANONICAL);
    expect(normalizeRemote('https://oauth2@github.com/ivo-toby/postgram')).toBe(
      CANONICAL
    );
    expect(
      normalizeRemote('http://user:pw@github.com:8080/ivo-toby/postgram.git')
    ).toBe(CANONICAL);
    expect(
      normalizeRemote('ssh://git@github.com:2222/ivo-toby/postgram.git')
    ).toBe(CANONICAL);
  });

  it('keeps surrounding whitespace trimming, case folding and trailing slashes off', () => {
    expect(
      normalizeRemote('  HTTPS://GitHub.com/Ivo-Toby/PostGram.git/  ')
    ).toBe(CANONICAL);
    expect(normalizeRemote('git@github.com:ivo-toby/postgram/')).toBe(
      CANONICAL
    );
  });

  it('keeps every segment of a nested path', () => {
    expect(normalizeRemote('git@gitlab.com:group/sub/repo.git')).toBe(
      'gitlab.com/group/sub/repo'
    );
    expect(
      normalizeRemote('https://gitlab.example.org/group/subgroup/project.git')
    ).toBe('gitlab.example.org/group/subgroup/project');
  });

  it('is idempotent', () => {
    const once = normalizeRemote('git@github.com:Ivo-Toby/postgram.git');
    expect(normalizeRemote(once)).toBe(once);
  });

  it('falls back to a trimmed, lowercased value without .git or a trailing slash', () => {
    expect(normalizeRemote('/srv/git/repo.git')).toBe('/srv/git/repo');
    expect(normalizeRemote('/srv/git/repo/')).toBe('/srv/git/repo');
    expect(normalizeRemote('..\\windows share\\repo.GIT')).toBe(
      '..\\windows share\\repo'
    );
    expect(normalizeRemote('not a remote')).toBe('not a remote');
    expect(normalizeRemote('file:///srv/git/repo.git')).toBe(
      'file:///srv/git/repo'
    );
  });

  it('handles empty and unusual input without throwing', () => {
    expect(normalizeRemote('')).toBe('');
    expect(normalizeRemote('   ')).toBe('');
    expect(normalizeRemote('@')).toBe('@');
    expect(normalizeRemote('::')).toBe('::');
    expect(() => normalizeRemote('git@github.com:x')).not.toThrow();
  });
});
