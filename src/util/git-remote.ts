/**
 * Shared git remote normalization (specs/004-workspace-session-tracking).
 *
 * Produces `host/owner/repo`, lowercased, without scheme, user, port, a
 * trailing `/` or a trailing `.git`. Handles scp form (`git@host:owner/repo`),
 * `https://`, `http://`, `ssh://` and `git://` URLs, with or without user and
 * port. Nested paths keep every segment.
 *
 * Decision D7: input that does not parse as a host plus a path (for example a
 * local path) is returned trimmed, lowercased and without a trailing `.git` or
 * `/`. The function never throws.
 */
export function normalizeRemote(remote: string): string {
  const input = remote.trim().toLowerCase();
  if (input === '') {
    return '';
  }

  const hostAndPath = splitHostAndPath(input);
  if (!hostAndPath) {
    return clean(input);
  }

  const segments = hostAndPath.path
    .split('/')
    .filter((segment) => segment !== '');
  if (hostAndPath.host === '' || segments.length === 0) {
    return clean(input);
  }

  return clean(`${hostAndPath.host}/${segments.join('/')}`);
}

/**
 * Split a lowercased, trimmed remote into host and repository path, or return
 * null when it does not look like a host plus a path.
 */
function splitHostAndPath(input: string): { host: string; path: string } | null {
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\/(.*)$/.exec(input);
  if (schemeMatch) {
    const remainder = schemeMatch[1];
    if (remainder === undefined) {
      return null;
    }
    const separator = remainder.indexOf('/');
    const authority = separator === -1 ? remainder : remainder.slice(0, separator);
    const path = separator === -1 ? '' : remainder.slice(separator + 1);
    return { host: stripPort(stripUser(authority)), path };
  }

  // scp-style `[user@]host:path`; a leading `/` or an inner `/` before the
  // colon means it is not scp form.
  const scpMatch = /^(?:[^/@]+@)?([^/:]+):(.*)$/.exec(input);
  if (scpMatch) {
    const host = scpMatch[1];
    const path = scpMatch[2];
    if (host === undefined || path === undefined) {
      return null;
    }
    return { host, path };
  }

  return null;
}

function stripUser(authority: string): string {
  const at = authority.lastIndexOf('@');
  return at === -1 ? authority : authority.slice(at + 1);
}

function stripPort(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(':');
  if (colon === -1) {
    return host;
  }
  const port = host.slice(colon + 1);
  return /^\d+$/.test(port) ? host.slice(0, colon) : host;
}

/** Strip a trailing `/` (repeated) and a trailing `.git`. */
function clean(value: string): string {
  let out = value;
  while (out.endsWith('/') && out.length > 1) {
    out = out.slice(0, -1);
  }
  if (out.endsWith('.git')) {
    out = out.slice(0, -4);
  }
  return out;
}
