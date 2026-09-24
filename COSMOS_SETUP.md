# Deployment on Cosmos Cloud (this machine)

This guide explains how to deploy Postgram on Cosmos Cloud using the provided `cosmos-compose.json` configuration.

## Prerequisites

1. **Build the UI Image Locally**:
   Cosmos Cloud cannot build images from local source code folders when importing Docker Compose configurations. Since there is no official pre-built UI image on GitHub Container Registry (GHCR), you must build it once locally on this server:
   ```bash
   ./build-ui.sh
   ```
   *(This image has already been built and is currently available on the server)*

2. **Verify/Pull the official MCP Server image**:
   Cosmos will pull `ghcr.io/ivo-toby/postgram:latest` automatically.

## Step-by-Step Cosmos Cloud Setup

### Step 1: Create the ServApp in Cosmos Cloud
1. Log in to your Cosmos Cloud dashboard.
2. Navigate to **ServApps** -> **New ServApp** -> **Docker Compose** (or **Import Compose**).
3. Copy the entire contents of the [cosmos-compose.json](file:///home/haasie/postgram/cosmos-compose.json) file and paste it into the compose text area.
4. Replace `YOUR_POSTGRES_PASSWORD` with a strong password of your choice in:
   - `postgram-postgres` environment variables (`POSTGRES_PASSWORD`).
   - `postgram-mcp-server` environment variables (`DATABASE_URL`).
5. Click **Create / Deploy**.
   - Cosmos will create the network, bind the volumes `/opt/postgram/pgdata` and `/opt/postgram/ollama_data` on the host, and start the containers.

### Step 2: Configure Route for the UI
To make the Postgram UI accessible in your browser:
1. Go to **Routes** -> **New Route**.
2. **Target Type**: Select `Container`.
3. **Target Container**: Choose `postgram-ui`.
4. **Target Port**: Set to `3000` (the port Nginx inside the container uses).
5. **Domain/Subdomain**: Define your desired URL (e.g., `postgram.yourdomain.com`).
6. Turn on **HTTPS (Let's Encrypt)** if exposing it publicly.
7. Click **Confirm**.

### Step 3: (Optional) Configure Route for the MCP Server
If you want to connect Postgram's MCP server directly to remote services (like ChatGPT or Claude Desktop via public HTTPS):
1. Create a new Route for the container `postgram-mcp-server` on port `3100`.
2. Map it to a subdomain (e.g., `postgram-mcp.yourdomain.com`).
3. Set the following environment variables in your `postgram-mcp-server` ServApp settings:
   - `OAUTH_ENABLED=true`
   - `PUBLIC_BASE_URL=https://postgram-mcp.yourdomain.com`
4. The connector URL for your AI agents will be `https://postgram-mcp.yourdomain.com/mcp`.
