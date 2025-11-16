#!/bin/bash

# Script to download and apply frontend assets from GitHub Actions
# Usage: ./download-frontend-assets.sh [workflow_run_id]

set -e

REPO="${GITHUB_REPOSITORY:-thegecko/theia-ide}"
API_BASE="https://api.github.com/repos/$REPO"

# If no workflow run ID provided, get latest
if [ -z "$1" ]; then
    echo "No workflow run ID provided, finding latest build..."
    # Get latest workflow run for build-frontend.yml
    RUN_DATA=$(curl -s "$API_BASE/actions/workflows/build-frontend.yml/runs?status=completed&per_page=1" |
               jq '.workflow_runs[0]')
    RUN_ID=$(echo "$RUN_DATA" | jq -r '.id')
    CONCLUSION=$(echo "$RUN_DATA" | jq -r '.conclusion')

    if [ "$CONCLUSION" != "success" ]; then
        echo "Latest build failed or not available"
        echo "Run status: $CONCLUSION"
        exit 1
    fi
else
    RUN_ID="$1"
fi

echo "Downloading assets from workflow run: $RUN_ID"

# Get artifact download URL
ARTIFACT=$(curl -s "$API_BASE/actions/runs/$RUN_ID/artifacts" |
           jq '.artifacts[] | select(.name=="ados-frontend-assets")')

if [ -z "$ARTIFACT" ]; then
    echo "No ados-frontend-assets artifact found for run $RUN_ID"
    exit 1
fi

DOWNLOAD_URL=$(echo "$ARTIFACT" | jq -r '.archive_download_url')

echo "Downloading from: $DOWNLOAD_URL"
curl -L -o frontend-assets.tar.gz \
     -H "Authorization: Bearer ${GITHUB_TOKEN:-}" \
     -H "Accept: application/vnd.github.v3+json" \
     "$DOWNLOAD_URL"

echo "Extracting frontend assets..."
# Backup existing frontend if it exists
if [ -d "lib/frontend" ]; then
    echo "Backing up existing frontend..."
    mv lib/frontend lib/frontend.bak.$(date +%s)
fi

# Extract new assets
mkdir -p lib/frontend
tar -xzf frontend-assets.tar.gz -C lib/frontend/ --strip-components=1

echo "✅ Frontend assets applied successfully!"
echo "Restart the IDE to see the full interface."
