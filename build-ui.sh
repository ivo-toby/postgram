#!/bin/bash
# Script to build postgram-ui image locally for Cosmos Cloud deployment

# Navigate to the script's directory
cd "$(dirname "$0")"

echo "Building postgram-postgram-ui:latest locally..."
docker build -t postgram-postgram-ui:latest ./ui

echo "----------------------------------------"
echo "Build complete! You can now import"
echo "cosmos-compose.json into Cosmos Cloud."
echo "----------------------------------------"
