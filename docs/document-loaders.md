# Document loaders

Postgram stores text. A loader is a plugin that converts one file format to text. You upload a file, the server keeps the original, and a loader converts it. The text then goes through the normal chunk, embed and extract pipeline.

The server ships one loader, for PDF files. You can add your own.

## Enable it

Document ingestion is off by default. To turn it on, set `LOADERS_ENABLED=true`.

The server stores original files in `ATTACHMENTS_DIR`. The Docker Compose file mounts the `postgram_attachments` volume there. If you run without Docker, make sure the directory exists and the server user can write to it.

If you do not set `LOADERS_CONFIG_PATH`, the built-in default registers the PDF loader. The [Document Loaders table](../README.md#document-loaders) lists all variables.

If `LOADERS_ENABLED` is `false`, `POST /api/documents/ingest` answers `503`. The server does not register the other routes.

## Upload a file

Three REST routes handle documents. Each needs an API key.

| Route                               | Scope   | Result                                                                        |
| ----------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `POST /api/documents/ingest`        | `write` | `202` created, `200` exists, `413` too large, `415` no loader, `503` disabled |
| `GET /api/entities/:id/attachments` | `read`  | `{ "attachments": [...] }` for one entity                                     |
| `GET /api/attachments/:id/content`  | `read`  | The original bytes with `Content-Disposition: attachment`                     |

The ingest route takes `multipart/form-data`. The `file` part is required. These text fields are optional: `title`, `mime_type`, `visibility`, `owner`, `tags` (comma-separated) and `metadata` (a JSON object). If you leave out `visibility`, the API and `pgm ingest` both use `shared`.

```bash
curl -X POST "$PGM_API_URL/api/documents/ingest" \
  -H "Authorization: Bearer $PGM_API_KEY" \
  -F "file=@report.pdf" \
  -F "title=Q3 report" \
  -F "tags=finance,quarterly"
# 202 {"id":"...","status":"created","loading_status":"pending"}
```

The server answers at once. A background worker loads the file, so the text appears a short time later. To see progress, read the entity with `GET /api/entities/:id`. The fields `loading_status` and `enrichment_status` show the state.

A finished load raises the entity `version` by one. A save that carries the old version fails with a version conflict. A load that finishes also replaces any content edit that you saved while the document was loading.

If you upload the same bytes again with the same owner and visibility, the server answers `200` with `"status": "exists"` and the first entity id. This holds only while the first entity is not archived. If the first entity is archived, the server creates a new entity.

If the first load failed 3 times, the same upload queues the load again. The answer is still `exists`, and the load status goes back to `pending`.

If no loader accepts the file, the `415` response lists the accepted MIME types and extensions in `error.details.accepted`.

## Upload with `pgm`

```bash
pgm ingest report.pdf
pgm ingest report.pdf --title "Q3 report" --tags finance --wait
```

With `--wait`, the command polls until the document is loaded and indexed. If loading or indexing fails, it exits with a non-zero code. If the time set by `--timeout` (default 600 seconds) passes first, it also exits with a non-zero code. See `pgm ingest --help` for all options.

If the load finishes with no text, such as a scan without a text layer, `--wait` prints `No text was extracted. A scan without a text layer is a common cause. OCR is not supported.` With `--json`, the output has `"text_extracted": false`. The field is `true` when the document has text.

A failed load is final for `--wait`. The server retries a failed load by itself, up to 3 attempts, 5 minutes apart. After the last attempt, run `pgm ingest` with the same file again to queue it again. The failure message says so.

`--timeout` only works together with `--wait`. If a status check fails because of a network error, `--wait` keeps trying until the timeout. If the server answers not found, unauthorized or forbidden, it stops at once.

## Loader configuration file

Set `LOADERS_CONFIG_PATH` to a JSON file to replace the built-in default. A change needs a server restart.

```json
{
  "version": 1,
  "pluginsDir": "/opt/postgram/plugins",
  "loaders": [
    {
      "kind": "in-process",
      "name": "pdf",
      "package": "@ivotoby/postgram-loader-pdf",
      "accepts": { "mimeTypes": ["application/pdf"], "extensions": [".pdf"] },
      "priority": 0,
      "options": { "maxPages": 500 }
    },
    {
      "kind": "sidecar",
      "name": "office",
      "endpoint": "http://office-loader:8080",
      "accepts": { "extensions": [".docx"] },
      "timeoutMs": 120000,
      "sharedSecret": "change-me"
    }
  ]
}
```

Each entry has a unique lowercase `name`, an `accepts` block, an optional `priority` (default 0) and optional `options` that the loader receives. Set `"enabled": false` to switch an entry off.

If more than one loader accepts a file, the server picks the highest `priority`. Configuration order breaks a tie. The server first matches the MIME type. If that finds nothing, or if the client sent `application/octet-stream`, it matches the file extension.

If a loader fails to register, the server logs the error and starts anyway. The other loaders keep working.

### In-process entries

An in-process loader is an npm package that the server imports. The server looks for the package in this order:

1. If the file sets `pluginsDir`, that directory.
2. The server application root. First-party loaders resolve from there.

The package must expose a `main` field, or an `exports` entry with a `"default"` or `"require"` condition. An `exports` map with only an `"import"` condition is not found. The package can be ESM.

### Sidecar entries

A sidecar is a separate HTTP service. Use it for heavy or untrusted conversion work. Extra fields: `endpoint`, `timeoutMs`, `maxBytes` (default 100 MB), `maxResponseBytes` (default 64 MB), `sharedSecret` and `transport`. The `transport` block has `mode`: `multipart` (default) or `shared-volume`. The shared-volume mode also needs `hostPath` and `sidecarPath`.

## Write an in-process loader

A loader is an object with `name`, `version`, `accepts` and `load(input, ctx)`. Export it as the default export or as a named `loader` export. The types live in [`src/types/loader.ts`](../src/types/loader.ts).

```ts
export default {
  name: 'my-format',
  version: '1.0.0',
  accepts: { extensions: ['.myf'] },
  async load(input, ctx) {
    // input.kind is 'localPath' in the server: read input.path
    return {
      documentType: 'my-format',
      blocks: [{ kind: 'text', text: 'Converted text', metadata: { page: 1 } }]
    };
  }
};
```

`load` returns `documentType`, ordered `blocks`, and optional `attachments` and `metadata`. The host checks the result. A loader never writes to the database. The host renders the blocks to Markdown, writes `[page N]` markers where the `page` value changes, and stores the attachments.

The context gives you these members: `ctx.tmpDir` (a scratch directory), `ctx.logger`, `ctx.options`, `ctx.signal` (the abort signal) and `ctx.fetch`. The `ctx.fetch` call stops when the signal fires. If the signal fires, stop work. The host also stops waiting at the timeout.

If a loader returns no blocks, the document ends with no text and the server skips indexing.

## Write a sidecar

A sidecar answers two routes.

`GET /manifest` returns `200` with `{ "name", "version", "accepts" }`. The server reads it at start. If the probe fails, the server only logs the failure and still registers the sidecar. The probe sends the `x-postgram-secret` header too when the entry sets `sharedSecret`. A sidecar that checks the secret on every route therefore passes the probe.

The `accepts` block in the server configuration file decides which files go to the sidecar. The server does not read the `accepts` in the manifest for routing. Keep both in step anyway.

`POST /load` receives `multipart/form-data`. The `meta` part is a file part named `meta.json` with the type `application/json`. It is not a text field. The JSON has the keys `options` and `mimeType`. It also has `filename` when it is known. In `multipart` mode, the `file` part holds the bytes. In `shared-volume` mode, `meta.localPath` holds the path inside the sidecar and there is no `file` part. The stored file must be under `hostPath`. In practice, `hostPath` is the attachments directory. If the entry sets `sharedSecret`, the server sends it in the `x-postgram-secret` header.

The `endpoint` must not contain a user name or password. The configuration is rejected if it does. Use `sharedSecret` to authenticate.

The server does not follow redirects. A `3xx` answer counts as a failure.

This request calls a sidecar in `multipart` mode:

```bash
echo '{"options":{},"mimeType":"application/x-myf","filename":"notes.myf"}' > meta.json
curl -X POST "http://office-loader:8080/load" \
  -H "x-postgram-secret: change-me" \
  -F "meta=@meta.json;type=application/json" \
  -F "file=@notes.myf;type=application/x-myf"
```

The server sends the `meta` part first. The `file` part carries the document filename. If the document has no filename, the part is named `file.bin`.

The route returns `200` with the loader result as JSON. This example has a heading block and a text block:

```json
{
  "documentType": "my-format",
  "blocks": [
    { "kind": "heading", "level": 1, "text": "Notes", "metadata": { "page": 1 } },
    { "kind": "text", "text": "First paragraph.", "metadata": { "page": 1 } }
  ],
  "metadata": { "pages": 1 }
}
```

The result has `documentType` (a non-empty string), `blocks` (an array), and the optional `attachments` and `metadata`. The `metadata` of the result is a JSON object. Each block has a `kind` and the fields in this table. Every block also takes an optional `metadata` object. Its known keys are `page` (a positive integer), `startSeconds`, `endSeconds`, `youtubeId`, `chapter` (a string or a number) and `source` (`ocr`, `native`, `asr` or `caption-model`).

| `kind`       | Required fields                                               | Optional fields                       |
| ------------ | ------------------------------------------------------------- | ------------------------------------- |
| `text`       | `text` (string)                                               |                                       |
| `heading`    | `level` (integer 1 to 6), `text` (string)                     |                                       |
| `code`       | `text` (string)                                               | `language` (string)                   |
| `table`      | `rows` (array of arrays of strings)                           | `caption` (string)                    |
| `transcript` | `text` (string), `startSeconds`, `endSeconds` (numbers, >= 0) | `speaker` (string)                    |
| `image`      | `attachmentRef` (string)                                      | `alt`, `ocrText`, `caption` (strings) |
| `audio`      | `attachmentRef` (string), `durationSeconds` (number, >= 0)    |                                       |
| `video`      | `attachmentRef` (string), `durationSeconds` (number, >= 0)    | `thumbnailRef` (string)               |

An attachment has `ref`, `kind` (`document`, `image`, `audio`, `video` or `binary`), `mimeType`, `source` and an optional `metadata` object. A block names an attachment with the same `ref` in `attachmentRef`. The `source` is `{ "kind": "base64", "data": "..." }`. The server rejects a result that does not match this shape, and the load fails.

Any non-`200` status counts as a failure. The error reaches `loading_error` as `sidecar <name> returned <status>: <body>`. The server cuts the body to 500 characters. It replaces every copy of the shared secret in the body with `[redacted]`. If the server cannot connect, the error holds the cause, for example `fetch failed: connect ECONNREFUSED 127.0.0.1:3298`.

## Security

An in-process loader runs with the full rights of the server process. Install only packages that you trust.

Uploaded files are untrusted, and the limits below do not make them safe. The server limits the upload size with `INGEST_MAX_BYTES` and stops waiting for a loader at `LOADER_TIMEOUT_MS`. The download route sets `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`.

The timeout does not stop an in-process loader that ignores the abort signal. The worker stops waiting and discards the late result. The loader keeps using CPU and memory.

In-process parsing of a crafted file can use very large amounts of memory. A small PDF can expand to gigabytes and stop the server process. `INGEST_MAX_BYTES`, the page limit and the timeout do not bound this.

Ingest only files from sources that you trust. If you must accept files from others, run the converter as a sidecar.

## Known limits

- An in-process loader runs on the server event loop. While it parses a large file, other requests are slower.
- The server reads the whole upload into memory. `INGEST_MAX_BYTES` bounds this.
- The loader configuration is a file. A change needs a restart.
- The PDF loader reads the text layer only. A scanned PDF with no text produces no text. OCR is a follow-up.

## Backup and cleanup

`pgm backup` dumps the database. The dump includes the `attachments` rows but not the attachment files. Back up the `ATTACHMENTS_DIR` volume separately. If you restore a backup that has no attachment rows, the stored files have no rows. In that case `attachments gc` refuses to run without `--force`.

Deleting an entity through the API archives it. The attachment rows and the files stay. Only `pgm-admin purge` deletes archived entities, and with them the attachment rows. After a purge, `attachments gc` frees the files that no row references.

```bash
pgm-admin attachments gc --dry-run
pgm-admin attachments gc --min-age 1h
```

The command reads `ATTACHMENTS_DIR` and `DATABASE_URL` from the environment. If `DATABASE_URL` is not set, it uses `PGM_DATABASE_URL`. If `LOADERS_ENABLED` is `false`, the command still works.

It must run where the attachments directory is mounted. In Docker, that is inside the container, for example `./bin/pgm-admin attachments gc`.

`--min-age` sets the age that a file needs before gc deletes it. The default is `1h` and the minimum is `10m`. A smaller value is an error, and there is no flag to override it. The same age applies to stale temporary files.

Two guards protect against a wrong setup. If the attachments directory does not exist, the command warns. If the `attachments` table has no rows but the directory has files, the command refuses to delete anything and exits with code 1. This usually means that the command points at the wrong database. If you are sure, add `--force`.

If gc cannot delete a file, it counts the error, continues with the other files and exits with code 1. The report lists the first error messages.

Before it deletes a file, gc takes the same per-file lock as an ingest and as the worker. Inside the lock, it looks again for a row that references the file. A concurrent upload of the same bytes is therefore safe.
