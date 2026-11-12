# @ivotoby/postgram-loader-pdf

The built-in PDF loader for Postgram document loading. It is private and ships
with the server. License: AGPL-3.0-only, like the server it runs inside.

It extracts text with [unpdf](https://github.com/unjs/unpdf). That library is
pure JavaScript with no native code.

## Output

- One text block per page that has text, with `metadata.page` (1-based).
- Result metadata: `pageCount`, `pdfTitle` (when the PDF has a title) and
  `truncated` (when `maxPages` cut the document short).
- A PDF without a text layer returns no blocks. That is not an error.
- A corrupt or password-protected file throws an error with a clear message.

## Options

Set options in the loaders config file under the loader entry.

| Option     | Default | Meaning                                          |
| ---------- | ------- | ------------------------------------------------ |
| `maxPages` | 500     | Positive integer. Pages after this are not read. |

## Known limits

- The parser runs inside the server process. A small crafted PDF can expand to
  a very large amount of memory while it is parsed. The upload size limit, the
  page limit and the timeout do not bound memory. Ingest only files from
  sources you trust.
- Text in PDFs whose fonts need predefined CJK character maps is not
  extracted, because the character-map files are not shipped.
- A PDF without a text layer gives no text. There is no OCR.
- A password-protected PDF fails with a clear error.

## Build

```bash
npm run build --workspace @ivotoby/postgram-loader-pdf
```

The package `main` points at `dist/index.js`. The server resolves the package
with `require.resolve`, so it needs the build. The root `npm run build`
covers it, and the vitest global setup builds it when `dist` is missing.
