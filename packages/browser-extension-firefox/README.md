# Postgram Web Clipper — Firefox

A Manifest V3 extension that saves the current page (or a text selection) to
your self-hosted [Postgram](../../README.md) server.

Requires Firefox 128+ (earlier versions don't support the
`optional_host_permissions` manifest key, which this extension relies on to
scope network access to your configured Postgram endpoint).

## Install (temporary add-on, for development)

1. Run the main postgram server and create an API key:

   ```bash
   npx tsx src/cli/admin/pgm-admin.ts key create \
     --name web-clipper --scopes read,write --visibility personal
   ```

2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select `packages/browser-extension-firefox/manifest.json` from your
   checkout.
5. The options page opens on first install. Fill in:
   - **Endpoint URL** — e.g. `http://localhost:3210` or
     `https://postgram.example.com`
   - **API key** — the `pgm_…` token printed by `pgm-admin key create`
   - **Visibility**, **Owner**, **Extra tags** — optional defaults applied to
     every capture.
6. Click **Save**, then **Grant access to endpoint** — Firefox prompts you to
   allow the extension to reach the configured host. This uses
   `optional_host_permissions`, so the extension cannot talk to any other
   origin.
7. Click **Test connection** to verify the endpoint and API key.

Temporary add-ons are unloaded when Firefox quits. To install persistently,
sign the extension via [Mozilla Add-ons](https://addons.mozilla.org/), or use
Firefox Developer Edition / ESR with `xpinstall.signatures.required = false`.

## Use

- **Capture entire page**: click the toolbar icon on any page.
- **Capture selection**: highlight text, then click the toolbar icon.

The extension decides automatically:

- If `window.getSelection()` contains non-empty text → selection is captured.
- Otherwise → the page's main content is extracted (prefers `<main>`,
  `<article>`, or `[role="main"]`, falling back to `<body>`) and saved.

A small badge on the toolbar icon (`…`, `✓`, `!`) and a system notification
report progress. Right-click the toolbar icon → **Postgram options…** to
reopen the settings page at any time.

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
`<iframe>`, `<nav>`, `aria-hidden` nodes) are stripped.

## Package for distribution

```bash
npm run -w @ivotoby/postgram-browser-extension-firefox package
```

Produces `dist/postgram-web-clipper-firefox.zip`. Submit this to
[addons.mozilla.org](https://addons.mozilla.org/en-US/developers/) for
signing and distribution.

## Permissions

- `activeTab` + `scripting` — to extract content from the tab you clicked on.
- `storage` — to persist endpoint + API key locally.
- `notifications` — for capture feedback (best-effort).
- `contextMenus` — to expose "Postgram options…" via right-click on the icon.
- `optional_host_permissions: http://*/* https://*/*` — **not** granted up
  front. The options page requests only the origin you configured.

No telemetry. No third-party network requests. The only outbound call is to
your configured Postgram endpoint.
