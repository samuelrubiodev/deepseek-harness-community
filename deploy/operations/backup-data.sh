#!/usr/bin/env bash
# DeepSeek Harness Community Fork — data backup
#
# Archives the harness data volume (and optionally the workspace volume) into
# gzip tarballs with SHA-256 checksums. Uses only the plain Docker CLI, so it
# also works on Compose-less Docker hosts such as Synology DSM.
#
# Usage:
#   ./deploy/operations/backup-data.sh [options]
#
# Options:
#   --output DIR      Output directory (default: $DSH_BACKUP_DIR or ./dsh-backups)
#   --workspace       Also archive the workspace volume into a second tarball
#   --full            Include the regenerable pnpm package store in the archive
#   --data NAME       Data volume: resource name or full Docker volume name
#                     (default: dsh-data; a Compose project prefix such as
#                      deepseek-harness_dsh-data is resolved automatically)
#   --service         Stop the container using the volume first, restart it
#                     afterwards (recommended for crash-consistent snapshots)
#   --help            Show this help
#
# What is in the backup and what can be skipped: see README.md in this
# directory. The archive contains credentials and session history — store it
# encrypted or on trusted media only.
set -euo pipefail

IMAGE="${DSH_BACKUP_IMAGE:-alpine:3.20}"
DATA_RESOURCE="${DSH_DATA_VOLUME:-dsh-data}"
WORKSPACE_RESOURCE="${DSH_WORKSPACE_VOLUME:-dsh-workspace}"
OUTPUT_DIR="${DSH_BACKUP_DIR:-$PWD/dsh-backups}"
WITH_WORKSPACE=0
FULL=0
STOP_SERVICE=0

log() { printf '[dsh-backup] %s\n' "$*"; }
die() { printf '[dsh-backup] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
    awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --output) [ "$#" -ge 2 ] || die "--output requires a directory"; OUTPUT_DIR="$2"; shift 2 ;;
        --workspace) WITH_WORKSPACE=1; shift ;;
        --full) FULL=1; shift ;;
        --data) [ "$#" -ge 2 ] || die "--data requires a volume name"; DATA_RESOURCE="$2"; shift 2 ;;
        --service) STOP_SERVICE=1; shift ;;
        --help|-h) usage; exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac
done

docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"

# Resolve a Compose resource name (dsh-data) to the real Docker volume name,
# which carries the project prefix (myproject_dsh-data). Accepts a full volume
# name directly. Errors when several projects expose the same resource name.
resolve_volume() {
    local resource="$1" matches
    if docker volume inspect "$resource" >/dev/null 2>&1; then
        printf '%s\n' "$resource"
        return 0
    fi
    matches="$(docker volume ls -q --filter "label=com.docker.compose.volume=$resource")"
    case "$(printf '%s\n' "$matches" | grep -c . )" in
        0) return 1 ;;
        1) printf '%s\n' "$matches" ;;
        *) die "multiple volumes match resource '$resource': $(printf '%s ' $matches) — pass the exact name with --data" ;;
    esac
}

DATA_VOLUME="$(resolve_volume "$DATA_RESOURCE")" \
    || die "no data volume named '$DATA_RESOURCE' (see: docker volume ls)"
log "Data volume: $DATA_VOLUME"

# Containers currently attached to one volume (works without Compose).
attached_containers() {
    docker ps -q --filter "volume=$1"
}

STOPPED_CONTAINERS=""
start_at_epoch="$(date +%s)"
stop_service() {
    [ "$STOP_SERVICE" -eq 1 ] || return 0
    STOPPED_CONTAINERS="$(attached_containers "$DATA_VOLUME")"
    if [ -z "$STOPPED_CONTAINERS" ]; then
        log "WARNING: no running container uses $DATA_VOLUME; nothing to stop. Backing up anyway."
        return 0
    fi
    # shellcheck disable=SC2086
    log "Stopping container(s): $(docker ps --filter "volume=$DATA_VOLUME" --format '{{.Names}}')"
    # shellcheck disable=SC2086
    docker stop $STOPPED_CONTAINERS >/dev/null
}
restart_service() {
    [ -n "$STOPPED_CONTAINERS" ] || return 0
    log "Restarting stopped container(s)"
    # shellcheck disable=SC2086
    docker start $STOPPED_CONTAINERS >/dev/null \
        || log "WARNING: automatic restart failed; start the container manually."
}
trap 'exit 130' INT TERM

# tar exit code 1 means "some files changed while reading" — a warning, not a
# failure; anything above 1 fails the backup.
archive_volume() {
    local volume="$1" archive="$2"
    shift 2
    local rc=0
    docker run --rm -v "${volume}:/mnt:ro" "$IMAGE" \
        tar -C /mnt -czf - "$@" . > "$archive" || rc=$?
    [ "$rc" -le 1 ] || die "tar failed for volume $volume (exit $rc)"
    [ "$rc" -eq 1 ] && log "WARNING: files changed while reading $volume; the archive is still usable for recovery."
    return 0
}

mkdir -p "$OUTPUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DATA_ARCHIVE="$OUTPUT_DIR/dsh-data-$STAMP.tar.gz"

if [ "$STOP_SERVICE" -eq 1 ]; then
    stop_service
    trap 'restart_service || true' EXIT
fi

log "Backing up $DATA_VOLUME -> $DATA_ARCHIVE"
DATA_EXCLUDES=""
if [ "$FULL" -eq 0 ]; then
    DATA_EXCLUDES="--exclude=./.pnpm-store --exclude=./.pnpm"
    log "Excluding the regenerable pnpm store (pass --full to include it)"
fi
# shellcheck disable=SC2086
archive_volume "$DATA_VOLUME" "$DATA_ARCHIVE" $DATA_EXCLUDES

TASKS=("$DATA_ARCHIVE")
if [ "$WITH_WORKSPACE" -eq 1 ]; then
    WORKSPACE_VOLUME="$(resolve_volume "$WORKSPACE_RESOURCE")" \
        || die "no workspace volume named '$WORKSPACE_RESOURCE' (see: docker volume ls)"
    WORKSPACE_ARCHIVE="$OUTPUT_DIR/dsh-workspace-$STAMP.tar.gz"
    log "Backing up $WORKSPACE_VOLUME -> $WORKSPACE_ARCHIVE"
    archive_volume "$WORKSPACE_VOLUME" "$WORKSPACE_ARCHIVE"
    TASKS+=("$WORKSPACE_ARCHIVE")
fi

for archive in "${TASKS[@]}"; do
    tar -tzf "$archive" >/dev/null || die "produced archive is unreadable: $archive"
    ( cd "$OUTPUT_DIR" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256" )
    log "Verified: $(basename "$archive") ($(du -h "$archive" | cut -f1), checksum recorded)"
done

log "Backup completed in $(( $(date +%s) - start_at_epoch ))s."
log "Restore later with: ./deploy/operations/restore-data.sh --latest --output '$OUTPUT_DIR'"
log "IMPORTANT: the archive contains credentials and session history. Store it encrypted or on trusted media only."
