const ext = typeof browser !== 'undefined' ? browser : chrome;

const STORAGE_KEYS = {
  endpoint: 'pgm_endpoint',
  apiKey: 'pgm_api_key',
  visibility: 'pgm_visibility',
  owner: 'pgm_owner',
  extraTags: 'pgm_extra_tags'
};

const $ = (id) => document.getElementById(id);

function normalizeEndpoint(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '');
}

// Chromium and Firefox match patterns do not accept port numbers — a literal
// port makes the pattern invalid. Strip it so `http://localhost:3210` →
// `http://localhost/*` (which matches any port on that host, as the browsers
// require).
function originPattern(endpoint) {
  try {
    const url = new URL(endpoint);
    if (!url.protocol || !url.hostname) return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

function setStatus(el, text, kind) {
  el.textContent = text;
  el.classList.remove('ok', 'err', 'muted');
  el.classList.add(kind || 'muted');
}

async function load() {
  const data = await ext.storage.local.get(Object.values(STORAGE_KEYS));
  $('endpoint').value = data[STORAGE_KEYS.endpoint] || '';
  $('api-key').value = data[STORAGE_KEYS.apiKey] || '';
  $('visibility').value = data[STORAGE_KEYS.visibility] || 'personal';
  $('owner').value = data[STORAGE_KEYS.owner] || '';
  $('extra-tags').value = data[STORAGE_KEYS.extraTags] || '';
  await refreshPermissionStatus();
}

async function refreshPermissionStatus() {
  const endpoint = normalizeEndpoint($('endpoint').value);
  const statusEl = $('permission-status');
  const pattern = originPattern(endpoint);
  if (!pattern) {
    setStatus(statusEl, 'Enter a valid endpoint first.', 'muted');
    return;
  }
  const granted = await ext.permissions.contains({ origins: [pattern] });
  if (granted) {
    setStatus(statusEl, `Access to ${pattern} granted.`, 'ok');
  } else {
    setStatus(
      statusEl,
      `Access not yet granted. Click "Grant access" to enable capture.`,
      'muted'
    );
  }
}

async function save(event) {
  event.preventDefault();
  const saveStatus = $('save-status');
  setStatus(saveStatus, 'Saving…', 'muted');

  const endpoint = normalizeEndpoint($('endpoint').value);
  const apiKey = $('api-key').value.trim();
  if (!endpoint || !apiKey) {
    setStatus(saveStatus, 'Endpoint and API key are required.', 'err');
    return;
  }

  await ext.storage.local.set({
    [STORAGE_KEYS.endpoint]: endpoint,
    [STORAGE_KEYS.apiKey]: apiKey,
    [STORAGE_KEYS.visibility]: $('visibility').value,
    [STORAGE_KEYS.owner]: $('owner').value.trim(),
    [STORAGE_KEYS.extraTags]: $('extra-tags').value.trim()
  });

  setStatus(saveStatus, 'Saved.', 'ok');
  await refreshPermissionStatus();
}

async function grantPermission() {
  const statusEl = $('permission-status');
  const endpoint = normalizeEndpoint($('endpoint').value);
  const pattern = originPattern(endpoint);
  if (!pattern) {
    setStatus(statusEl, 'Enter a valid endpoint first.', 'err');
    return;
  }
  try {
    const granted = await ext.permissions.request({ origins: [pattern] });
    if (granted) {
      setStatus(statusEl, `Access to ${pattern} granted.`, 'ok');
    } else {
      setStatus(
        statusEl,
        'Permission denied. The extension cannot reach this endpoint until granted.',
        'err'
      );
    }
  } catch (err) {
    setStatus(statusEl, `Permission request failed: ${describeError(err)}`, 'err');
  }
}

async function testConnection() {
  const status = $('save-status');
  setStatus(status, 'Testing…', 'muted');
  const endpoint = normalizeEndpoint($('endpoint').value);
  const apiKey = $('api-key').value.trim();
  if (!endpoint || !apiKey) {
    setStatus(status, 'Endpoint and API key are required.', 'err');
    return;
  }
  const pattern = originPattern(endpoint);
  if (pattern) {
    const has = await ext.permissions.contains({ origins: [pattern] });
    if (!has) {
      setStatus(
        status,
        'Host permission not granted — click "Grant access" first.',
        'err'
      );
      return;
    }
  }

  try {
    const healthResp = await fetch(`${endpoint}/health`);
    if (!healthResp.ok) {
      setStatus(status, `/health returned HTTP ${healthResp.status}`, 'err');
      return;
    }

    const authResp = await fetch(`${endpoint}/api/entities?limit=1`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (authResp.status === 401 || authResp.status === 403) {
      setStatus(status, 'API key rejected by server.', 'err');
      return;
    }
    if (!authResp.ok) {
      setStatus(
        status,
        `Auth check returned HTTP ${authResp.status}. Check key scopes.`,
        'err'
      );
      return;
    }

    setStatus(status, 'Connection OK — server reachable and key accepted.', 'ok');
  } catch (err) {
    setStatus(status, `Connection failed: ${describeError(err)}`, 'err');
  }
}

function describeError(err) {
  if (!err) return 'Unknown error';
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('options-form').addEventListener('submit', save);
  $('grant-btn').addEventListener('click', grantPermission);
  $('test-btn').addEventListener('click', testConnection);
  $('endpoint').addEventListener('blur', refreshPermissionStatus);
  load().catch((err) => console.error('Postgram options load failed', err));
});
