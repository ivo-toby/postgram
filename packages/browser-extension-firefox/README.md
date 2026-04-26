# Postgram Web Clipper — Firefox

A Manifest V3 extension that saves the current page (or a text selection) to
your self-hosted [Postgram](../../README.md) server.

Requires Firefox 140+ (desktop). The extension needs:

- `optional_host_permissions` (Firefox 128+) to scope network access to your
  configured Postgram endpoint.
- The built-in data-collection consent UI for
  `browser_specific_settings.gecko.data_collection_permissions`, which Mozilla
  only ships in Firefox desktop 140+ (and Android 142+). On older versions the
  declaration is silently ignored, so the user doesn't see the disclosure
  Mozilla requires for AMO submissions.

## Build

The extension ships as plain JS — no bundler, no compile step. There are
two ways to "build" it:

### A. Run from source (no build)

The folder `packages/browser-extension-firefox/` is already a loadable
extension. Skip directly to **Install → A. Temporary add-on**.

### B. Produce a distributable `.zip` (xpi-equivalent)

From the repository root:

```bash
# Once, to install workspace tooling
npm install

# Produces packages/browser-extension-firefox/dist/postgram-web-clipper-firefox.zip
npm run -w @ivotoby/postgram-browser-extension-firefox package
```

The script just zips `manifest.json` + `src/` (no transpilation, no
minifier). Firefox treats a renamed `.zip` and a `.xpi` identically — the
output is ready for upload to
[addons.mozilla.org](https://addons.mozilla.org/en-US/developers/) for
signing.

> **Requires:** Node.js 22+ and `zip` on `$PATH` (the package script uses
> the system `zip` binary).

Optional: you can also build with Mozilla's reference tooling, which adds
linting and a slightly richer xpi:

```bash
npx --yes web-ext build \
  --source-dir=packages/browser-extension-firefox \
  --artifacts-dir=packages/browser-extension-firefox/dist
```

## Install manually

You need either a checkout of this repo or the built `.zip` from the
previous step.

### A. Temporary add-on (for development)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `packages/browser-extension-firefox/manifest.json` from your
   checkout (or the unpacked zip).
4. The Postgram icon appears in the toolbar; the options page opens
   automatically the first time.

Temporary add-ons are unloaded when Firefox quits. To pick up code
changes without restarting, click **Reload** on the add-on's row in
`about:debugging`.

### B. Persistent install via signed XPI

Standard Firefox release/beta builds **require signed extensions**. To
install persistently you must either:

1. **Submit to AMO**:
   1. Run `npm run -w @ivotoby/postgram-browser-extension-firefox package`.
   2. Upload the resulting zip to
      [addons.mozilla.org → Add a new add-on](https://addons.mozilla.org/en-US/developers/addon/submit/).
      Choose **On your own** if you don't want public listing.
   3. Mozilla returns a signed `.xpi`. Drag-and-drop it into Firefox to
      install.

2. **Or use a build that allows unsigned add-ons** —
   [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/),
   [Nightly](https://www.mozilla.org/firefox/channel/desktop/#nightly),
   or
   [ESR for unbranded builds](https://wiki.mozilla.org/Add-ons/Extension_Signing#Unbranded_Builds):

   1. Open `about:config`, set `xpinstall.signatures.required` to
      `false`.
   2. `npm run -w @ivotoby/postgram-browser-extension-firefox package`.
   3. Rename the resulting zip to `.xpi` and drag it into Firefox.

> Plain Firefox release / Firefox ESR / Firefox for Android cannot
> install unsigned `.xpi` files even with the about:config flag — the
> flag is only honored on Developer Edition, Nightly, and unbranded
> ESR builds. For all other channels you must go through AMO.

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
2. Click **Grant access to endpoint** — Firefox prompts you to allow
   network access to the configured host (only). The extension uses
   `optional_host_permissions`, so it cannot reach any other origin.
3. Click **Test connection** to verify the endpoint and API key
   (`/health` + `/api/entities?limit=1`).

To reopen the options page later: right-click the toolbar icon →
**Postgram options…**, or visit `about:addons` → **Postgram Web
Clipper** → **Options**.

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

The manifest also declares
`browser_specific_settings.gecko.data_collection_permissions: { required: ["websiteContent"] }`
so Firefox 140+ can show the data-collection consent prompt at install
time, accurately disclosing that the extension transmits page /
selection text to your configured server.

No telemetry. No third-party network requests. The only outbound call
is to your configured Postgram endpoint.
