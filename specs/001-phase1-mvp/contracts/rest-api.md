# REST API Contract: Phase 1 MVP

**Base path**: `/api`
**Content-Type**: `application/json`
**Auth**: `Authorization: Bearer <api-key>` (all endpoints except `/health`)

## Error Format

All error responses:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

| Code             | HTTP Status | When |
|------------------|-------------|------|
| NOT_FOUND        | 404         | Entity ID does not exist |
| CONFLICT         | 409         | Version mismatch (optimistic locking) |
| VALIDATION       | 400         | Invalid input (missing fields, bad types) |
| UNAUTHORIZED     | 401         | Missing/invalid API key |
| FORBIDDEN        | 403         | Key lacks required scope, type, or visibility |
| EMBEDDING_FAILED | 502 | Query embedding generation failed during synchronous search |
| INTERNAL         | 500         | Unexpected server error |

---

Background enrichment failures are not API errors. They are reflected on the
entity via `enrichment_status: "failed"`.

## Endpoints

### POST /api/entities — Store

**Scopes required**: `write`

The entity is persisted immediately. Chunking and embedding happen
asynchronously after the response returns. The returned entity will have
`enrichment_status: "pending"` if content is non-empty.

**Request body**:
| Field      | Type     | Required | Default  |
|------------|----------|----------|----------|
| content    | string   | no       | null     |
| type       | string   | yes      | —        |
| visibility | string   | no       | `shared` |
| status     | string   | no       | null     |
| tags       | string[] | no       | `[]`     |
| metadata   | object   | no       | `{}`     |

**Response**: `201 Created` → `{ "entity": StoredEntity }`

**Errors**: 400, 401, 403

---

### GET /api/entities/:id — Recall

**Scopes required**: `read`

**Response**: `200 OK` → `{ "entity": StoredEntity }`

**Errors**: 401, 403, 404

---

### PATCH /api/entities/:id — Update

**Scopes required**: `write`

If content changes, enrichment is re-dispatched asynchronously and
`enrichment_status` resets to `"pending"`.

**Request body**:
| Field      | Type     | Required | Notes |
|------------|----------|----------|-------|
| content    | string   | no       | Triggers re-enrichment if changed |
| visibility | string   | no       | —     |
| status     | string   | no       | —     |
| tags       | string[] | no       | —     |
| metadata   | object   | no       | Merged with existing |
| version    | number   | yes      | Current version (optimistic locking) |

**Response**: `200 OK` → `{ "entity": StoredEntity }` (version incremented)

**Errors**: 400, 401, 403, 404, 409 (includes `"current": StoredEntity`)

---

### DELETE /api/entities/:id — Soft Delete

**Scopes required**: `delete`

**Response**: `200 OK` → `{ "id": "uuid", "deleted": true }`

**Errors**: 401, 403, 404

---

### GET /api/entities — List

**Scopes required**: `read`

**Query params**:
| Param      | Type   | Default | Max |
|------------|--------|---------|-----|
| type       | string | —       | —   |
| status     | string | —       | —   |
| visibility | string | —       | —   |
| tags       | string | —       | Comma-separated |
| limit      | number | 50      | 200 |
| offset     | number | 0       | —   |

**Response**: `200 OK` →
```json
{ "items": [StoredEntity], "total": 42, "limit": 50, "offset": 0 }
```

---

### POST /api/search — Semantic Search

**Scopes required**: `read`

**Request body**:
| Field          | Type     | Required | Default |
|----------------|----------|----------|---------|
| query          | string   | yes      | —       |
| type           | string   | no       | —       |
| tags           | string[] | no       | —       |
| limit          | number   | no       | 10 (max 50) |
| threshold      | number   | no       | 0.35    |
| recency_weight | number   | no       | 0.1     |

**Response**: `200 OK` →
```json
{
  "results": [
    {
      "entity": StoredEntity,
      "chunk_content": "matching chunk text",
      "score": 0.87,
      "similarity": 0.82
    }
  ]
}
```

**Errors**: 400, 401, 502 (embedding the query vector fails)

---

### POST /api/tasks — Task Create

**Scopes required**: `write`

**Request body**:
| Field    | Type     | Required | Default |
|----------|----------|----------|---------|
| content  | string   | yes      | —       |
| context  | string   | no       | —       |
| status   | string   | no       | `inbox` |
| due_date | string   | no       | —       |
| tags     | string[] | no       | `[]`    |

**Response**: `201 Created` → `{ "entity": StoredEntity }`

---

### GET /api/tasks — Task List

**Scopes required**: `read`

**Query params**: `status`, `context`, `limit` (50), `offset` (0)

**Response**: `200 OK` → `{ "items": [...], "total": N, "limit": N, "offset": N }`

---

### PATCH /api/tasks/:id — Task Update

Same shape as `PATCH /api/entities/:id`.

---

### POST /api/tasks/:id/complete — Task Complete

**Scopes required**: `write`

**Request body**: `{ "version": number }`

**Response**: `200 OK` → `{ "entity": StoredEntity }` (status=done)

---

### GET /health — Health Check

**Auth**: None required.

**Response**: `200 OK` →
```json
{
  "status": "ok",
  "version": "0.1.0",
  "postgres": "connected",
  "embedding_model": "text-embedding-3-small"
}
```

**Degraded**: `503 Service Unavailable` →
```json
{ "status": "degraded", "postgres": "disconnected" }
```

---

## StoredEntity Shape

```json
{
  "id": "uuid",
  "type": "memory",
  "content": "text or null",
  "visibility": "shared",
  "status": "active or null",
  "enrichment_status": "pending | completed | failed | null",
  "version": 1,
  "tags": ["tag1", "tag2"],
  "source": "pgm-talon-personal",
  "metadata": {},
  "created_at": "2026-03-17T10:30:00.000Z",
  "updated_at": "2026-03-17T10:30:00.000Z"
}
```

`enrichment_status` values:
- `"pending"`: Entity persisted, chunking/embedding not yet complete
- `"completed"`: Chunks and embeddings generated successfully
- `"failed"`: Enrichment attempted but failed (entity still recallable, not searchable by vector)
- `null`: No content to enrich (metadata-only entity)
