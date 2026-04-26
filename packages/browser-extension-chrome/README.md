# Postgram Web Clipper — Chrome / Chromium

A Manifest V3 extension that saves the current page (or a text selection) to
your self-hosted [Postgram](../../README.md) server.

Works with Chrome, Edge, Brave, Arc, and other Chromium-based browsers that
support Manifest V3.

## Build

The extension ships as plain JS — no bundler, no compile step. There are
two ways to "build" it:

### A. Run from source (no build)

The folder `packages/browser-extension-chrome/` is already a loadable
extension. Skip directly to **Install → A. Load unpacked from source**.

### B. Produce a distributable `.zip`

From the repository root:

```bash
# Once, to install workspace tooling
npm install

# Produces packages/browser-extension-chrome/dist/postgram-web-clipper-chrome.zip
npm run -w @ivotoby/postgram-browser-extension-chrome package
```

The script just zips `manifest.json` + `src/` (no transpilation, no minifier).
The output zip can be uploaded to the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole),
unpacked back onto disk for sideloading, or wrapped into a `.crx` with your
own signing key.

> **Requires:** Node.js 22+ and `zip` on `$PATH` (the package script uses
> the system `zip` binary).

## Install manually

You need either a checkout of this repo or the built `.zip` from the
previous step.

### A. Load unpacked from source (recommended for development)

1. Open `chrome://extensions/` (or `edge://extensions/`,
   `brave://extensions/`, etc.).
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked** and select the
   `packages/browser-extension-chrome/` folder from your checkout.
4. The Postgram icon appears in the toolbar. The options page opens
   automatically the first time.

The unpacked extension stays loaded across browser restarts. To pick up
code changes, click the ↻ refresh icon on the extension's card on
`chrome://extensions/`.

### B. Install from the built `.zip`

1. Run `npm run -w @ivotoby/postgram-browser-extension-chrome package`
   to produce `dist/postgram-web-clipper-chrome.zip`.
2. Unzip it somewhere persistent
   (e.g. `~/Library/Application Support/postgram-web-clipper/`).
3. Open `chrome://extensions/`, enable **Developer mode**, click
   **Load unpacked**, and select the unzipped folder.

> Chromium browsers refuse to install loose `.crx` files outside the Web
> Store unless they are signed with a registered key, so end users without
> a Web Store listing should follow this path. Drag-and-drop install of a
> raw `.zip` only works for Web-Store-signed packages.

### C. Pack a signed `.crx` (advanced)

1. On `chrome://extensions/`, enable **Developer mode** and click
   **Pack extension…**.
2. Set **Extension root directory** to
   `packages/browser-extension-chrome/` and leave the private key blank
   (Chrome generates `.pem` on first run; reuse it for subsequent
   versions).
3. Distribute the resulting `postgram-web-clipper-chrome.crx` and `.pem`
   to anyone who needs to install the same signed build.

## Configure

The options page opens automatically on first install. Fill in:

- **Endpoint URL** — e.g. `http://localhost:3210` or
  `https://postgram.example.com`. Trailing slashes are normalized away.
- **API key** — a `pgm_…` token. Create one against your server with:

  ```bash
  npx tsx src/cli/admin/pgm-admin.ts key create \
    --name web-clipper --scopes read,write --visibility personal
  ```

- **Visibility**, **Owner**, **Extra tags** — optional defaults applied
  to every capture.

Then:

1. Click **Save**.
2. Click **Grant access to endpoint** — the browser prompts you to
   allow network access to the configured host (only). The extension
   uses `optional_host_permissions`, so it cannot reach any other
   origin.
3. Click **Test connection** to verify the endpoint and API key
   (`/health` + `/api/entities?limit=1`).

To reopen the options page later: right-click the toolbar icon →
**Postgram options…**, or visit `chrome://extensions/` → **Details** →
**Extension options**.

## Use

- **Capture entire page**: click the toolbar icon on any page.
- **Capture selection**: highlight text, then click the toolbar icon.

The extension decides automatically:

- If `window.getSelection()` contains non-empty text → selection is
  captured.
- Otherwise → the page's main content is extracted (prefers `<main>`,
  `<article>`, or `[role="main"]`, falling back to `<body>`) and saved.

A small badge on the toolbar icon (`…`, `✓`, `!`) and a system
notification report progress.

## What gets stored

Each capture is POSTed to `POST {endpoint}/api/entities` with:

```json
{
  "type": "document",
  "content": "# <title>\n\nSource: <url>\n\n---\n\n<page or selection text>",
  "visibility": "personal",
  "source": "<url>",
  "tags": ["web-clip", "web-page" | "web-selection", "<extra tags>"],
  "metadata": {
    "url": "…",
    "title": "…",
    "description": "…",
    "captured_at": "ISO-8601",
    "capture_mode": "page" | "selection",
    "user_agent": "postgram-web-clipper"
  }
}
```

Content is truncated at ~500 KB; hidden elements (`<script>`, `<style>`,
`<iframe>`, `<nav>`, `<header>`, `<footer>`, `<aside>`, `aria-hidden`
nodes, and ARIA `navigation` / `banner` / `contentinfo` roles) are
stripped.

## Permissions

- `activeTab` + `scripting` — to extract content from the tab you
  clicked on.
- `storage` — to persist endpoint + API key locally.
- `notifications` — for capture feedback (best-effort).
- `contextMenus` — to expose "Postgram options…" via right-click on the
  icon.
- `optional_host_permissions: http://*/* https://*/*` — **not** granted
  up front. The options page requests only the origin you configured.

No telemetry. No third-party network requests. The only outbound call
is to your configured Postgram endpoint.
