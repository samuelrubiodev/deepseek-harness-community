#!/usr/bin/env bash
set -eo pipefail

# Ensure essential directories exist with proper permissions
mkdir -p "${DSH_HOME:-/data}"
mkdir -p "${WORKSPACE_DIR:-/workspace}"

echo "[dsh-docker] Starting DeepSeek Harness..."
echo "[dsh-docker] DSH_HOME=${DSH_HOME:-/data}"
echo "[dsh-docker] WORKSPACE=${WORKSPACE_DIR:-/workspace}"

# If the first argument is "dsh" or starts with "web", or if no arguments passed:
if [ "$#" -eq 0 ]; then
    exec node /app/apps/cli/lib/bin.js web --patch /app/docker/docker.patch.yml --no-open --port "${PORT:-3080}"
elif [ "$1" = "web" ]; then
    shift
    exec node /app/apps/cli/lib/bin.js web --patch /app/docker/docker.patch.yml --no-open --port "${PORT:-3080}" "$@"
elif [ "$1" = "dsh" ]; then
    shift
    exec node /app/apps/cli/lib/bin.js "$@"
else
    exec "$@"
fi
