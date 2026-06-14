# MCP Input Coercion Design

## Summary

MCP tool input validation should tolerate semantically valid arguments that arrive as strings from clients or models that stringify tool-call values. The MCP transport will coerce stringified numbers, booleans, and JSON string arrays at the Zod schema boundary, then continue to reject malformed input through normal schema validation.

## Scope

This change applies to MCP tool schemas in `src/transport/mcp.ts` only. REST and service-layer contracts remain unchanged. The MCP tools keep their existing runtime behavior after parsing; only schema input normalization changes.

Covered coercions:

- Numeric fields accept JSON numbers or numeric strings such as `"3"`.
- Boolean fields accept JSON booleans or the exact strings `"true"` and `"false"`.
- String-array fields accept JSON arrays or JSON-encoded string arrays such as `"[\"memory\",\"work\"]"`.

Malformed inputs remain invalid. Examples include non-numeric strings for numeric fields, boolean strings other than `"true"` or `"false"`, invalid JSON for arrays, JSON values that are not arrays, and arrays containing non-strings.

## Architecture

Add small reusable schema helpers in `src/transport/mcp.ts` near the shared MCP schemas:

- `numericSchema()` wraps `z.coerce.number()` and preserves downstream integer/range checks through chained Zod calls.
- `boolishSchema()` preprocesses only exact `"true"` and `"false"` strings before validating with `z.boolean()`.
- `stringArraySchema()` parses a string as JSON only when possible, then validates the result with `z.array(z.string())`.

Replace all MCP schema number, boolean, and string-array fields with these helpers where the tool accepts user-provided arguments. Keep existing enum, string, record, object, nullable, and file-manifest schemas unchanged.

## Tool Coverage

Coerce inputs for these tool families:

- Entity tools: `store`, `store_session_context`, `search`, `update`, `recall`, `delete`.
- Session grooming: `groom_session_context`.
- Task tools: `task_create`, `task_list`, `task_update`, `task_complete`.
- Graph tools: `link`, `expand`, `unlink`.
- Queue tools: `queue`.

`sync_push` file manifests are intentionally left strict because they carry structured document payloads, not common scalar model-generated options.

## Testing

Use `tests/contract/mcp-tools.test.ts` because it exercises the real MCP client/server path. Add failing tests first for:

- `search.limit`, `search.expand_graph`, `search.include_archived`, `search.full_response`, `search.toon`, and `search.tags`.
- `store.tags`, `store.skip_extraction`, and `store.full_response`.
- A representative audit spread across `groom_session_context`, `task_list`, `task_update`, `link`, `expand`, and `queue`.
- Rejection of malformed stringified values for numeric, boolean, and string-array fields.

Run the focused MCP contract test and typecheck after implementation.
