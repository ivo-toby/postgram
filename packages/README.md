# Postgram Packages

Auxiliary packages that ship alongside the main Postgram server.

| Package | Description |
| --- | --- |
| [`browser-extension-chrome`](./browser-extension-chrome) | Chrome/Chromium (Manifest V3) web clipper — save pages and selections to Postgram. |
| [`browser-extension-firefox`](./browser-extension-firefox) | Firefox (Manifest V3) web clipper — same behaviour, Firefox-native packaging. |

## Build

The extensions are plain JS — no bundler, no compile step. From the repo
root:

```bash
npm install                                                            # once
npm run -w @ivotoby/postgram-browser-extension-chrome  package         # → dist/postgram-web-clipper-chrome.zip
npm run -w @ivotoby/postgram-browser-extension-firefox package         # → dist/postgram-web-clipper-firefox.zip
```

The output zips can be loaded unpacked, uploaded to the Chrome Web Store
/ AMO, or repackaged as `.crx` / `.xpi`.

## Install manually

- **Chrome / Chromium**: `chrome://extensions/` → enable Developer mode →
  **Load unpacked** → pick `packages/browser-extension-chrome/`.
- **Firefox** (140+): `about:debugging#/runtime/this-firefox` → **Load
  Temporary Add-on…** → pick
  `packages/browser-extension-firefox/manifest.json`.

See each package's README for the detailed build steps, persistent
install paths (signed XPI, `.crx`, AMO submission), configuration, and
permission model:

- [Chrome — Build & install](./browser-extension-chrome/README.md)
- [Firefox — Build & install](./browser-extension-firefox/README.md)
