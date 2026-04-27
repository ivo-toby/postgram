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

Stock Chrome / Edge / Brave **only trust extensions installed from the
Web Store**. Until/unless this extension is published there, the
supported install paths for personal use are loading the unpacked
folder or installing a self-packed `.crx` via enterprise policy. For
99% of users, the unpacked path below is the right one.

### A. Load unpacked (recommended for self-hosted use)

You only need a checkout of this repo (no build step).

1. Open `chrome://extensions/` (or `edge://extensions/`,
   `brave://extensions/`, `arc://extensions/`, etc.).
2. Toggle **Developer mode** on (top-right corner). Chrome will show a
   yellow banner saying "Disable developer mode extensions" on every
   startup — you can ignore it; click **Cancel** / dismiss. The banner
   exists because Chrome can't auto-update unpacked extensions, not
   because anything is wrong.
3. Click **Load unpacked** and select the
   `packages/browser-extension-chrome/` folder from your checkout
   (point at the folder containing `manifest.json`, not the file
   itself).
4. **Pin the toolbar icon** so single-click capture works: click the 🧩
   puzzle-piece icon in the Chrome toolbar → find **Postgram Web
   Clipper** → click the pin icon next to it. Otherwise the icon stays
   hidden and the extension only opens via the puzzle menu.
5. The options page opens automatically the first time. Configure
   endpoint + API key (see [Configure](#configure) below).

The extension stays loaded across browser restarts. Chrome will not
auto-update it — that's expected for unpacked extensions.

### Updating after `git pull`

```bash
cd <repo>
git pull
```

Then either:

- Open `chrome://extensions/` → find Postgram Web Clipper → click the
  ↻ refresh icon on its card, or
- Toggle the extension off and on, or
- Restart the browser.

(Chrome reads `manifest.json` and `src/` directly off disk, so a
refresh is enough — no rebuild, no reinstall.)

### B. Distributing to others

There is no good way to do this without the Chrome Web Store on stock
Chrome. Two real options:

1. **Publish to the Chrome Web Store** ($5 one-time developer fee).
   Upload the zip from `npm run -w … package`. You can list it as
   "Unlisted" so it doesn't appear in search but anyone with the URL
   can install. Stock Chrome installs it normally and auto-updates it
   through the Store.
2. **Enterprise / managed deployment**. If you control the user's
   Chrome via policy (`ExtensionInstallForcelist`,
   `ExtensionInstallSources`, etc.), you can host the `.crx` yourself
   and force-install it. See the
   [Chrome enterprise extension policies](https://support.google.com/chrome/a/answer/9296680).

`chrome://extensions/` → **Pack extension…** produces a `.crx`, but
stock Chrome (Stable/Beta channel) **silently disables** any
externally-installed `.crx` on next launch. The file format works;
the install policy doesn't trust it. So packing a `.crx` is only
useful if you go through one of the two distribution paths above.

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
