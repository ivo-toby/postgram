// Use a single cross-browser namespace. Firefox MV3 exposes both `browser`
// and `chrome`; Chrome only exposes `chrome`.
const ext = typeof browser !== 'undefined' ? browser : chrome;

const STORAGE_KEYS = {
  endpoint: 'pgm_endpoint',
  apiKey: 'pgm_api_key',
  visibility: 'pgm_visibility',
  owner: 'pgm_owner',
  extraTags: 'pgm_extra_tags'
};

const DEFAULT_TAGS = ['web-clip'];
const DEFAULT_VISIBILITY = 'personal';
const MAX_CONTENT_BYTES = 500_000;

async function getConfig() {
  const stored = await ext.storage.local.get([
    STORAGE_KEYS.endpoint,
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.visibility,
    STORAGE_KEYS.owner,
    STORAGE_KEYS.extraTags
  ]);
  return {
    endpoint: normalizeEndpoint(stored[STORAGE_KEYS.endpoint]),
    apiKey: (stored[STORAGE_KEYS.apiKey] || '').trim(),
    visibility: stored[STORAGE_KEYS.visibility] || DEFAULT_VISIBILITY,
    owner: (stored[STORAGE_KEYS.owner] || '').trim(),
    extraTags: parseTagList(stored[STORAGE_KEYS.extraTags])
  };
}

function normalizeEndpoint(value) {
  if (!value) return '';
  const trimmed = String(value).trim().replace(/\/+$/, '');
  return trimmed;
}

function parseTagList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function notify(title, message, isError) {
  try {
    ext.notifications.create({
      type: 'basic',
      iconUrl: ext.runtime.getURL('src/icons/icon-128.png'),
      title: title,
      message: message,
      priority: isError ? 2 : 0
    });
  } catch (err) {
    // notifications permission may be unavailable — fall back silently.
    console.warn('Postgram: notification failed', err);
  }
}

async function setBadge(tabId, text, color) {
  try {
    await ext.action.setBadgeText({ tabId: tabId, text: text });
    if (color) {
      await ext.action.setBadgeBackgroundColor({ tabId: tabId, color: color });
    }
  } catch {
    // Some pages (e.g. chrome://) disallow per-tab badges.
  }
}

function clearBadgeAfter(tabId, ms) {
  setTimeout(() => {
    setBadge(tabId, '', null);
  }, ms);
}

async function openOptions() {
  if (ext.runtime.openOptionsPage) {
    await ext.runtime.openOptionsPage();
  } else {
    await ext.tabs.create({ url: ext.runtime.getURL('src/options.html') });
  }
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome|edge|about|moz-extension|chrome-extension|view-source|file):/i.test(
    url
  );
}

async function ensureHostPermission(endpoint) {
  let origin;
  try {
    origin = new URL(endpoint).origin + '/*';
  } catch {
    return false;
  }
  const has = await ext.permissions.contains({ origins: [origin] });
  return has;
}

async function captureActiveTab(tab) {
  const config = await getConfig();

  if (!config.endpoint || !config.apiKey) {
    notify(
      'Postgram not configured',
      'Set your endpoint and API key in the extension options, then try again.',
      true
    );
    await openOptions();
    return;
  }

  if (!(await ensureHostPermission(config.endpoint))) {
    notify(
      'Postgram permission missing',
      'Open the options page and grant access to your Postgram server.',
      true
    );
    await openOptions();
    return;
  }

  if (isRestrictedUrl(tab.url)) {
    notify(
      'Cannot capture this page',
      'Browser-internal pages (chrome://, about:, extension pages) cannot be captured.',
      true
    );
    return;
  }

  await setBadge(tab.id, '…', '#2563eb');

  let captured;
  try {
    const [result] = await ext.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePageContent
    });
    captured = result && result.result;
  } catch (err) {
    console.error('Postgram capture injection failed', err);
    await setBadge(tab.id, '!', '#b91c1c');
    clearBadgeAfter(tab.id, 4000);
    notify('Capture failed', describeError(err), true);
    return;
  }

  if (!captured || !captured.content) {
    await setBadge(tab.id, '!', '#b91c1c');
    clearBadgeAfter(tab.id, 4000);
    notify('Nothing to capture', 'The page returned no readable content.', true);
    return;
  }

  try {
    const entity = await postEntity(config, captured, tab);
    await setBadge(tab.id, '✓', '#16a34a');
    clearBadgeAfter(tab.id, 3000);
    const summary = captured.isSelection
      ? 'Selection saved to Postgram'
      : 'Page saved to Postgram';
    notify(summary, `${captured.title} (${formatBytes(captured.content.length)})`);
    return entity;
  } catch (err) {
    console.error('Postgram API call failed', err);
    await setBadge(tab.id, '!', '#b91c1c');
    clearBadgeAfter(tab.id, 5000);
    notify('Save failed', describeError(err), true);
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

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function postEntity(config, captured, tab) {
  const body = buildEntityBody(config, captured, tab);
  const response = await fetch(`${config.endpoint}/api/entities`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body; leave as null
  }

  if (!response.ok) {
    const message =
      (parsed && parsed.error && parsed.error.message) ||
      `Postgram returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return parsed;
}

function buildEntityBody(config, captured, tab) {
  const contentHeader = [
    `# ${captured.title || tab.title || 'Untitled'}`,
    '',
    `Source: ${captured.url || tab.url || ''}`,
    captured.description ? `\n> ${captured.description}` : null,
    captured.isSelection ? '\n_(captured selection)_' : null,
    '',
    '---',
    ''
  ]
    .filter((line) => line !== null)
    .join('\n');

  const body = `${contentHeader}${captured.content}`;
  const truncated =
    body.length > MAX_CONTENT_BYTES
      ? `${body.slice(0, MAX_CONTENT_BYTES)}\n\n…[truncated]`
      : body;

  const tags = Array.from(
    new Set([
      ...DEFAULT_TAGS,
      captured.isSelection ? 'web-selection' : 'web-page',
      ...config.extraTags
    ])
  );

  const payload = {
    type: 'document',
    content: truncated,
    visibility: config.visibility || DEFAULT_VISIBILITY,
    source: captured.url || tab.url,
    tags: tags,
    metadata: {
      url: captured.url || tab.url || null,
      title: captured.title || tab.title || null,
      description: captured.description || null,
      captured_at: new Date().toISOString(),
      capture_mode: captured.isSelection ? 'selection' : 'page',
      user_agent: 'postgram-web-clipper'
    }
  };

  if (config.owner) {
    payload.owner = config.owner;
  }

  return payload;
}

// This function is serialized and injected into the active tab via
// chrome.scripting.executeScript. It must be self-contained — no closures,
// no imports, no references to outer scope.
function capturePageContent() {
  function textFrom(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll(
      'script,style,noscript,iframe,svg,canvas,nav,header footer,[aria-hidden="true"]'
    ).forEach((el) => el.remove());
    return (clone.innerText || clone.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function pickMainElement() {
    const candidates = [
      document.querySelector('main'),
      document.querySelector('article'),
      document.querySelector('[role="main"]'),
      document.querySelector('#content'),
      document.querySelector('#main'),
      document.body
    ];
    for (const candidate of candidates) {
      if (candidate && textFrom(candidate).length > 100) return candidate;
    }
    return document.body;
  }

  const selection = window.getSelection ? window.getSelection() : null;
  const selectionText = selection ? selection.toString().trim() : '';

  const meta = document.querySelector('meta[name="description"]');
  const description =
    (meta && meta.getAttribute('content')) ||
    (document.querySelector('meta[property="og:description"]') &&
      document
        .querySelector('meta[property="og:description"]')
        .getAttribute('content')) ||
    '';

  if (selectionText.length > 0) {
    return {
      isSelection: true,
      title: document.title,
      url: location.href,
      description: description,
      content: selectionText
    };
  }

  const content = textFrom(pickMainElement());
  return {
    isSelection: false,
    title: document.title,
    url: location.href,
    description: description,
    content: content
  };
}

ext.action.onClicked.addListener((tab) => {
  if (!tab || typeof tab.id !== 'number') return;
  captureActiveTab(tab).catch((err) => {
    console.error('Postgram: unhandled capture error', err);
  });
});

ext.runtime.onInstalled.addListener(async (details) => {
  try {
    await ext.contextMenus.create({
      id: 'postgram-options',
      title: 'Postgram options…',
      contexts: ['action']
    });
  } catch {
    // context menu creation is best-effort; some browsers restrict contexts.
  }

  if (details.reason === 'install') {
    await openOptions();
  }
});

ext.contextMenus &&
  ext.contextMenus.onClicked &&
  ext.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === 'postgram-options') {
      openOptions();
    }
  });
