# Postgram for Home Assistant

This directory provides a Home Assistant add-on packaging layer for
[Postgram](https://github.com/ivo-toby/postgram).

The goal is to make Postgram installable on Home Assistant OS without modifying
Postgram application code.

## What this adds

- The Postgram server is taken from the official
  `ghcr.io/ivo-toby/postgram:main` image.
- The browser UI is built unchanged from the upstream `ui/` source.
- PostgreSQL 17 and pgvector run locally inside the Home Assistant add-on.
- Home Assistant configuration is mapped to the environment variables already
  supported by Postgram.
- Postgram data is persisted in the add-on's `/data` directory.

This packaging differs from the upstream Docker Compose deployment only where
needed for the Home Assistant add-on runtime. Postgram source code and
application behavior are not patched.

## Installation

1. In Home Assistant, go to **Settings -> Apps -> App store**.
2. Open **Repositories** from the menu.
3. Add:
   `https://github.com/ivo-toby/postgram`
4. Install **Postgram**.
5. Configure at least a valid OpenAI API key.
6. Start the add-on.
7. Use **Open Web UI** to open Postgram.

## Configuration

The Home Assistant add-on currently exposes these options:

| Option | Default | Description |
| --- | --- | --- |
| `openai_api_key` | empty | OpenAI API key used by Postgram |
| `log_level` | `info` | Postgram log level |
| `extraction_enabled` | `false` | Enable entity extraction |
| `extraction_model` | empty | Optional extraction model |

Postgram's provider settings, including embedding model and dimensions, are
configured through the Postgram web UI.

## Web UI and ports

The add-on exposes:

- port **3000** for the Postgram web UI
- port **3100** for the Postgram API and MCP endpoint

The Home Assistant **Open Web UI** button opens Postgram directly on port 3000
instead of using Home Assistant ingress. This keeps the upstream UI unchanged
and preserves its root-relative asset and API paths.

## Architecture

Upstream Postgram normally runs its components through Docker Compose. Home
Assistant add-ons run as individual containers and do not run the upstream
Compose stack directly.

For that reason, this add-on combines the required runtime pieces into one Home
Assistant container:

- upstream Postgram server
- upstream Postgram web UI
- PostgreSQL 17
- pgvector
- nginx for the local web/API routing

The application itself remains upstream Postgram.

## Updating

The server image follows the upstream Postgram image and the UI is built from
the upstream repository. Home Assistant-specific changes should remain limited
to this packaging layer.

## Verification

The add-on has been smoke-tested on Home Assistant OS with:

- clean installation from the custom repository
- Postgram onboarding and web UI
- PostgreSQL + pgvector initialization
- OpenAI embeddings
- MCP connectivity
- MCP store, recall, semantic search, and delete
