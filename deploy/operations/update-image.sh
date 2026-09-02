#!/usr/bin/env bash
# DeepSeek Harness Community Fork — image update and rollback
#
# Tag-local lifecycle so a failed upgrade is always reversible: before
# switching to a new image, pin the image the harness container runs to a
# timestamped rollback reference; rollback moves the local tag back and
# recreates the service. Volumes are NEVER touched — only the image changes.
#
# Usage:
#   ./deploy/operations/update-image.sh <command> [options]
#
# Commands:
#   save                Tag the image the harness container currently runs as
#                       <local-image>:rollback-<timestamp>.
#   rollback [REF]      Point <local-image>:<local-tag> (default
#                       deepseek-harness:latest) at REF (default: newest
#                       rollback-* reference) and recreate the service.
#   list                Show rollback references and the image the harness
#                       container runs now.
#
# Options (after the command):
#   --local-image NAME  Image name to manage (default: deepseek-harness)
#   --local-tag NAME    Tag to move on rollback (default: latest)
#   --service NAME      Compose service name (default: harness)
#   --container NAME    Container name used when the Compose service cannot be
#                       resolved (default: deepseek-harness)
#   --file PATH         Compose file, repeatable (like docker compose -f);
#                       default: docker compose from the current directory
#   --yes               Skip the interactive confirmation
#   --help              Show this help
#
# On hosts without docker compose (e.g. Synology DSM), save and rollback still
# retag images; the script then prints the recreate steps to run manually (or
# use the Synology Container Tools UI).
set -euo pipefail

LOCAL_IMAGE="deepseek-harness"
LOCAL_TAG="latest"
SERVICE="harness"
CONTAINER="deepseek-harness"
COMPOSE_FILES=()
ASSUME_YES=0

log() { printf '[dsh-update] %s\n' "$*"; }
die() { printf '[dsh-update] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
    awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
}

COMMAND="${1:-}"
case "$COMMAND" in
    save|rollback|list) shift ;;
    "") ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown command: $COMMAND (see --help)" ;;
esac

# rollback accepts one optional positional reference (image:tag or image ID)
TARGET_REF=""
if [ "$COMMAND" = "rollback" ] && [ "$#" -gt 0 ] && [ "${1#-}" = "$1" ]; then
    TARGET_REF="$1"
    shift
fi

while [ "$#" -gt 0 ]; do
    case "$1" in
        --local-image) [ "$#" -ge 2 ] || die "--local-image requires a name"; LOCAL_IMAGE="$2"; shift 2 ;;
        --local-tag) [ "$#" -ge 2 ] || die "--local-tag requires a name"; LOCAL_TAG="$2"; shift 2 ;;
        --service) [ "$#" -ge 2 ] || die "--service requires a name"; SERVICE="$2"; shift 2 ;;
        --container) [ "$#" -ge 2 ] || die "--container requires a name"; CONTAINER="$2"; shift 2 ;;
        --file) [ "$#" -ge 2 ] || die "--file requires a path"; COMPOSE_FILES+=("-f" "$2"); shift 2 ;;
        --yes|-y) ASSUME_YES=1; shift ;;
        --help|-h) usage; exit 0 ;;
        *) die "unexpected argument: $1 (see --help)" ;;
    esac
done

docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"

compose() {
    docker compose "${COMPOSE_FILES[@]+"${COMPOSE_FILES[@]}"}" "$@"
}

# Compose container id for the service, empty when Compose cannot resolve it.
compose_container_id() {
    compose ps -aq "$SERVICE" 2>/dev/null | tr -d '[:space:]' || true
}

# Image ID the harness runs: via Compose when resolvable, else the plain
# container name (running or created). Non-zero when neither finds one.
current_image_id() {
    local id
    id="$(compose_container_id)"
    [ -z "$id" ] || { docker inspect -f '{{ .Image }}' "$id" 2>/dev/null && return 0; }
    id="$(docker ps -aq --filter "name=^${CONTAINER}$" | head -n 1)"
    [ -n "$id" ] || return 1
    docker inspect -f '{{ .Image }}' "$id"
}

newest_rollback_tag() {
    docker image ls "$LOCAL_IMAGE" --format '{{.Tag}}' | grep '^rollback-' | sort | tail -n 1
}

recreate_service() {
    local target="$1" id
    id="$(compose_container_id)"
    if [ -n "$id" ]; then
        compose up -d --force-recreate "$SERVICE"
        log "Service recreated on $target."
        log "Verify: docker compose ps   and   docker compose logs --tail 50 $SERVICE"
    elif [ -n "$(docker ps -aq --filter "name=^${CONTAINER}$")" ]; then
        log "Compose service '$SERVICE' not found but container $CONTAINER exists. Recreate it on $target:"
        log "  docker rm -f $CONTAINER && <your run command>"
        log "On Synology: Container Tools > stop, delete (keep volumes!), re-create the container."
    else
        log "No harness container found. Start fresh on $target (docker compose up -d or your host's UI)."
    fi
}

case "$COMMAND" in
    save)
        CURRENT_ID="$(current_image_id || true)"
        [ -n "${CURRENT_ID:-}" ] || die "no harness container found (compose service '$SERVICE' or container '$CONTAINER'); start it first."
        STAMP="$(date +%Y%m%d-%H%M%S)"
        REF="$LOCAL_IMAGE:rollback-$STAMP"
        docker tag "$CURRENT_ID" "$REF"
        log "Pinned current image ($CURRENT_ID) as $REF"
        log "Proceed with the update (git pull + rebuild, or new image), then recreate the service."
        log "If the update misbehaves: ./deploy/operations/update-image.sh rollback"
        ;;
    rollback)
        TARGET="$TARGET_REF"
        if [ -z "$TARGET" ]; then
            TAG="$(newest_rollback_tag || true)"
            [ -n "$TAG" ] || die "no $LOCAL_IMAGE:rollback-* references exist; run '$0 save' before updating next time."
            TARGET="$LOCAL_IMAGE:$TAG"
        else
            docker image inspect "$TARGET" >/dev/null 2>&1 || die "image reference not found: $TARGET"
        fi
        echo "Rollback target:             $TARGET"
        echo "Current $LOCAL_IMAGE:$LOCAL_TAG: $(docker image inspect -f '{{.Id}}' "$LOCAL_IMAGE:$LOCAL_TAG" 2>/dev/null || echo '(absent)')"
        if [ "$ASSUME_YES" -ne 1 ]; then
            printf '[dsh-update] Move %s:%s to %s and recreate service %s? [y/N] ' "$LOCAL_IMAGE" "$LOCAL_TAG" "$TARGET" "$SERVICE"
            read -r answer
            case "$answer" in
                [yY]|[yY][eE][sS]) ;;
                *) die "aborted by user" ;;
            esac
        fi
        docker tag "$TARGET" "$LOCAL_IMAGE:$LOCAL_TAG"
        recreate_service "$LOCAL_IMAGE:$LOCAL_TAG"
        ;;
    list)
        echo "Rollback references for $LOCAL_IMAGE:"
        docker image ls "$LOCAL_IMAGE" --format '{{.Tag}}  {{.ID}}  {{.CreatedSince}}' | { grep '^rollback-' || echo '  (none)'; }
        CURRENT_ID="$(current_image_id || true)"
        if [ -n "${CURRENT_ID:-}" ]; then
            echo "Harness currently runs image $CURRENT_ID"
            docker image ls "$LOCAL_IMAGE" --format '{{.ID}} {{.Tag}}' \
                | awk -v id="$CURRENT_ID" -v img="$LOCAL_IMAGE" 'index(id,$1)==1 {print "  tagged as: " img ":" $2}'
        else
            echo "No harness container found (compose service '$SERVICE' or container '$CONTAINER')."
        fi
        ;;
    *)
        usage
        die "missing command: save | rollback | list"
        ;;
esac
