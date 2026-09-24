#!/bin/bash
set -euo pipefail

# Navigate to the postgram directory
cd /home/haasie/postgram

echo "=== Checking for updates from upstream repository ==="
git fetch origin main

LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse origin/main)

if [ "$LOCAL_HASH" != "$REMOTE_HASH" ] || [ "${1:-}" = "--force" ]; then
    echo "New updates found! Pulling changes..."
    # Save our local modifications (like the bugfix and docker-compose.yml configuration)
    git stash
    
    # Pull latest official code
    git pull origin main
    
    # Restore our modifications
    if git stash pop; then
        echo "Successfully reapplied local modifications."
    else
        echo "Warning: Stash pop had conflicts. You may need to resolve them manually in the editor."
    fi
    
    echo "Rebuilding UI image..."
    bash build-ui.sh
    
    echo "Rebuilding MCP Server image..."
    docker build -t postgram-mcp-server:latest .
    
    echo "Restarting containers..."
    docker compose up -d
    
    echo "=== Update complete ==="
else
    echo "Already up-to-date with upstream."
fi
