#!/usr/bin/env bash
set -eo pipefail

# DSH_PORT wins over PORT so deployments that set only DSH_PORT stay healthy.
PORT="${DSH_PORT:-${PORT:-3080}}"
URL="http://127.0.0.1:${PORT}/"

# Probe the HTTP server.
# An unauthenticated request to / returns 401 with the dsh auth challenge,
# while an authenticated request returns 200 or 303.
# Any of these responses confirms that the Node process and webserver are active.
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 5 "${URL}" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" -eq 401 ] || [ "$HTTP_STATUS" -eq 200 ] || [ "$HTTP_STATUS" -eq 303 ]; then
    exit 0
else
    echo "Healthcheck failed: received HTTP ${HTTP_STATUS} from ${URL}" >&2
    exit 1
fi
