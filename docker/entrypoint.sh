#!/usr/bin/env bash
set -eo pipefail

# Ensure essential directories exist with proper permissions
mkdir -p "${DSH_HOME:-/data}"
mkdir -p "${WORKSPACE_DIR:-/workspace}"

# Environment defaults for Docker
export DSH_HOST="${DSH_HOST:-0.0.0.0}"
export PORT="${DSH_PORT:-${PORT:-3080}}"
export DSH_PORT="${PORT}"

echo "[dsh-docker] Starting DeepSeek Harness..."
echo "[dsh-docker] DSH_HOME=${DSH_HOME:-/data}"
echo "[dsh-docker] WORKSPACE=${WORKSPACE_DIR:-/workspace}"
echo "[dsh-docker] BIND=${DSH_HOST}:${DSH_PORT}"
if [ -n "${DSH_TRUSTED_HOSTS:-}" ]; then
    echo "[dsh-docker] DSH_TRUSTED_HOSTS=${DSH_TRUSTED_HOSTS}"
fi
if [ "${DSH_REVERSE_PROXY:-}" = "true" ] || [ "${DSH_REVERSE_PROXY:-}" = "1" ]; then
    echo "[dsh-docker] DSH_REVERSE_PROXY=enabled"
fi

# If the first argument is "dsh" or starts with "web", or if no arguments passed:
if [ "$#" -eq 0 ]; then
    exec node /app/apps/cli/lib/bin.js web --no-open
elif [ "$1" = "web" ]; then
    shift
    exec node /app/apps/cli/lib/bin.js web --no-open "$@"
elif [ "$1" = "dsh" ]; then
    shift
    exec node /app/apps/cli/lib/bin.js "$@"
else
    exec "$@"
fi
