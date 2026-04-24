# Postgram Packages

Auxiliary packages that ship alongside the main Postgram server.

| Package | Description |
| --- | --- |
| [`browser-extension-chrome`](./browser-extension-chrome) | Chrome/Chromium (Manifest V3) web clipper — save pages and selections to Postgram. |
| [`browser-extension-firefox`](./browser-extension-firefox) | Firefox (Manifest V3) web clipper — same behaviour, Firefox-native packaging. |

Each package is a standalone extension you can load unpacked during
development or `npm run -w <name> package` to zip for store submission.
