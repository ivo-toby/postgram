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

Standard Firefox release/beta/ESR/Android builds **require signed
extensions** — there is no `about:config` flag that disables signing on
those channels. You have two practical paths:

#### B1. Self-distribute a signed XPI via AMO (recommended)

This stays off the public AMO catalogue but produces an `.xpi` any
Firefox install can use. Mozilla calls this "unlisted" / "On your own"
distribution; it's free and there's no human review (only an automated
scan).

1. **Get AMO API credentials**. Sign in at
   [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/users/login/)
   with a Firefox Account, then visit
   [Manage API Keys](https://addons.mozilla.org/en-US/developers/addon/api/key/)
   and click **Generate new credentials**. You'll get:
   - **JWT issuer** — looks like `user:1234567:89`
   - **JWT secret** — a long hex string (shown once — copy it now)
2. **Run the signing script** with those values exported:

   ```bash
   export WEB_EXT_API_KEY="user:1234567:89"
   export WEB_EXT_API_SECRET="<the long hex secret>"
   npm run -w @ivotoby/postgram-browser-extension-firefox sign
   ```

   This uploads the source to AMO, waits for the signing pipeline (~1–3
   minutes), and downloads the signed `.xpi` into
   `packages/browser-extension-firefox/dist/`. The first run also
   reserves the extension's add-on ID
   (`postgram-web-clipper@postgram.dev`) under your AMO account; reuse
   the same credentials for future versions.

3. **Install the signed XPI**. Drag the resulting
   `postgram_web_clipper-<version>.xpi` into a Firefox window, or visit
   `about:addons` → ⚙ → **Install Add-on From File…** and pick it.
   Distribute the same `.xpi` to anyone else who needs it — it works on
   plain Firefox release.

> Bumping the `version` in `manifest.json` is required for each new
> signed build; AMO rejects re-uploads of an already-signed version.

> Optional: `npm run -w @ivotoby/postgram-browser-extension-firefox lint:webext`
> runs the same `web-ext lint` check Mozilla applies during signing —
> handy for catching manifest issues before submitting.

#### B2. Skip signing on a non-release channel

If you only need this for yourself and don't want an AMO account, use a
Firefox build that honours `xpinstall.signatures.required = false`:

- [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/)
- [Nightly](https://www.mozilla.org/firefox/channel/desktop/#nightly)
- [Unbranded ESR](https://wiki.mozilla.org/Add-ons/Extension_Signing#Unbranded_Builds)

Then:

1. Open `about:config`, set `xpinstall.signatures.required` to `false`.
2. `npm run -w @ivotoby/postgram-browser-extension-firefox package`.
3. Rename the resulting zip to `.xpi` and drag it into Firefox.

> Plain Firefox release / Firefox ESR / Firefox for Android **cannot**
> install unsigned `.xpi` files even with the about:config flag set.
> Use path B1 for those.

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
