#!/usr/bin/env bash
set -eo pipefail

# Ensure essential directories exist with proper permissions
mkdir -p "${DSH_HOME:-/data}" 2>/dev/null || true
mkdir -p "${WORKSPACE_DIR:-/workspace}" 2>/dev/null || true

# Validate write permissions on state directory
if [ ! -w "${DSH_HOME:-/data}" ]; then
    echo "[dsh-docker] ERROR: ${DSH_HOME:-/data} is not writable by current user ($(whoami 2>/dev/null || echo "uid=$(id -u)"), UID $(id -u), GID $(id -g))." >&2
    echo "[dsh-docker] If using host bind mounts, ensure the host directory is writable by UID 1000 (e.g.: chown -R 1000:1000 <host-path>)." >&2
    exit 1
fi
if [ ! -w "${WORKSPACE_DIR:-/workspace}" ]; then
    echo "[dsh-docker] WARNING: ${WORKSPACE_DIR:-/workspace} is not writable by current user ($(whoami 2>/dev/null || echo "uid=$(id -u)"), UID $(id -u), GID $(id -g)). Agent workspace writes may fail." >&2
fi

# Environment defaults for Docker
export DSH_HOST="${DSH_HOST:-0.0.0.0}"
export PORT="${DSH_PORT:-${PORT:-3080}}"
export DSH_PORT="${PORT}"
export WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
export HOME="${WORKSPACE_DIR}"
cd "${WORKSPACE_DIR}"

# Configure persistent pnpm paths inside DSH_HOME (/data)
export PNPM_HOME="${DSH_HOME:-/data}/.pnpm"
export PATH="$PNPM_HOME:$PATH"
export npm_config_store_dir="${DSH_HOME:-/data}/.pnpm-store"

echo "[dsh-docker] Starting DeepSeek Harness..."
echo "[dsh-docker] USER=$(whoami 2>/dev/null || echo "uid=$(id -u)") ($(id -u):$(id -g))"
if [ "$(id -u)" -eq 0 ]; then
    echo "[dsh-docker] WARNING: Running as root (UID 0) is discouraged for security reasons. Consider running as the unprivileged 'node' user (UID 1000)." >&2
fi
echo "[dsh-docker] DSH_HOME=${DSH_HOME:-/data}"
echo "[dsh-docker] WORKSPACE=${WORKSPACE_DIR:-/workspace}"
echo "[dsh-docker] BIND=${DSH_HOST}:${DSH_PORT}"
if [ -n "${DSH_TRUSTED_HOSTS:-}" ]; then
    echo "[dsh-docker] DSH_TRUSTED_HOSTS=${DSH_TRUSTED_HOSTS}"
fi
if [ "${DSH_REVERSE_PROXY:-}" = "true" ] || [ "${DSH_REVERSE_PROXY:-}" = "1" ]; then
    echo "[dsh-docker] DSH_REVERSE_PROXY=enabled"
fi
if [ "${DSH_AUTH_MODE:-}" = "none" ]; then
    echo "[dsh-docker] WARNING: DSH_AUTH_MODE=none -> browser authentication DISABLED; only the trust fence protects this deployment"
fi
if [ -n "${DSH_AUTH_TOKEN:-}" ]; then
    echo "[dsh-docker] DSH_AUTH_TOKEN=*** fixed sign-in token active; the startup URL keeps the same token across restarts>"
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
