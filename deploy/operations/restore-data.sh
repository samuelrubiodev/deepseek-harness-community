#!/usr/bin/env bash
# DeepSeek Harness Community Fork — data restore
#
# Restores the harness data volume from an archive produced by backup-data.sh.
# Uses only the plain Docker CLI, so it also works on Compose-less Docker hosts
# such as Synology DSM.
#
# Usage:
#   ./deploy/operations/restore-data.sh (--archive FILE | --latest) [options]
#
# Options:
#   --archive FILE      Archive to restore (a dsh-data-*.tar.gz file)
#   --latest            Restore the newest dsh-data-*.tar.gz under --output
#   --output DIR        Directory searched by --latest
#                     (default: $DSH_BACKUP_DIR or ./dsh-backups)
#   --data NAME         Destination volume: resource name or full Docker volume
#                     name (default: dsh-data; a Compose project prefix such as
#                      deepseek-harness_dsh-data is resolved automatically)
#   --replace           Delete existing volume contents before restoring
#   --verify-only       Check checksum and readability; change nothing
#   --service           Stop the container using the volume first, restart it
#                     afterwards (required for a clean restore of a live system)
#   --yes               Skip the interactive confirmation
#   --help              Show this help
#
# A restore merges by default: archive files overwrite volume files at the same
# path, and files that exist only in the volume survive. Sessions and settings
# are append-style, so a merge is usually safe; --replace reproduces the exact
# point-in-time state of the backup.
set -euo pipefail

IMAGE="${DSH_RESTORE_IMAGE:-alpine:3.20}"
DATA_RESOURCE="${DSH_DATA_VOLUME:-dsh-data}"
OUTPUT_DIR="${DSH_BACKUP_DIR:-$PWD/dsh-backups}"
ARCHIVE=""
LATEST=0
REPLACE=0
VERIFY_ONLY=0
STOP_SERVICE=0
ASSUME_YES=0

log() { printf '[dsh-restore] %s\n' "$*"; }
die() { printf '[dsh-restore] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
    awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --archive) [ "$#" -ge 2 ] || die "--archive requires a path"; ARCHIVE="$2"; shift 2 ;;
        --latest) LATEST=1; shift ;;
        --output) [ "$#" -ge 2 ] || die "--output requires a directory"; OUTPUT_DIR="$2"; shift 2 ;;
        --data) [ "$#" -ge 2 ] || die "--data requires a volume name"; DATA_RESOURCE="$2"; shift 2 ;;
        --replace) REPLACE=1; shift ;;
        --verify-only) VERIFY_ONLY=1; shift ;;
        --service) STOP_SERVICE=1; shift ;;
        --yes|-y) ASSUME_YES=1; shift ;;
        --help|-h) usage; exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac
done

[ "$LATEST" -eq 1 ] || [ -n "$ARCHIVE" ] || die "choose --archive FILE or --latest"
if [ -z "$ARCHIVE" ]; then
    ARCHIVE="$(find "$OUTPUT_DIR" -maxdepth 1 -name 'dsh-data-*.tar.gz' -type f 2>/dev/null | sort | tail -n 1)"
    [ -n "$ARCHIVE" ] || die "no dsh-data-*.tar.gz found under $OUTPUT_DIR"
fi
[ -f "$ARCHIVE" ] || die "archive not found: $ARCHIVE"
ARCHIVE_DIR="$(cd "$(dirname "$ARCHIVE")" && pwd)"
ARCHIVE_NAME="$(basename "$ARCHIVE")"

# tar exit code 1 means "some files changed while reading" — tolerated when
# reading, never expected when writing.
verify_archive() {
    if [ -f "$ARCHIVE_DIR/$ARCHIVE_NAME.sha256" ]; then
        ( cd "$ARCHIVE_DIR" && sha256sum -c "$ARCHIVE_NAME.sha256" >/dev/null ) \
            || die "checksum mismatch for $ARCHIVE_NAME — refusing to restore a possibly corrupted backup"
        log "Checksum verified: $ARCHIVE_NAME"
    else
        log "WARNING: no $ARCHIVE_NAME.sha256 beside the archive; skipping checksum verification."
    fi
    tar -tzf "$ARCHIVE_DIR/$ARCHIVE_NAME" >/dev/null 2>&1 \
        || die "archive is not a readable gzip tarball: $ARCHIVE"
}

verify_archive

if [ "$VERIFY_ONLY" -eq 1 ]; then
    log "Verification passed; nothing was changed (--verify-only)."
    exit 0
fi

docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"

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
    || die "no data volume named '$DATA_RESOURCE' (see: docker volume ls). Create it first with docker compose up -d."
log "Destination volume: $DATA_VOLUME"

STOPPED_CONTAINERS=""
stop_service() {
    [ "$STOP_SERVICE" -eq 1 ] || return 0
    STOPPED_CONTAINERS="$(docker ps -q --filter "volume=$DATA_VOLUME")"
    if [ -z "$STOPPED_CONTAINERS" ]; then
        log "No running container uses $DATA_VOLUME; nothing to stop."
        return 0
    fi
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

if [ "$ASSUME_YES" -ne 1 ]; then
    printf '[dsh-restore] Restore %s into volume %s (%s)? [y/N] ' \
        "$ARCHIVE_NAME" "$DATA_VOLUME" \
        "$([ "$REPLACE" -eq 1 ] && echo "--replace: current volume data will be DELETED" || echo "merge: only paths present in the archive are overwritten")"
    read -r answer
    case "$answer" in
        [yY]|[yY][eE][sS]) ;;
        *) die "aborted by user" ;;
    esac
fi

if [ "$STOP_SERVICE" -eq 1 ]; then
    stop_service
    trap 'restart_service || true' EXIT
fi

if [ "$REPLACE" -eq 1 ]; then
    log "Replacing volume contents: deleting everything currently in $DATA_VOLUME"
    docker run --rm -v "${DATA_VOLUME}:/mnt" "$IMAGE" \
        sh -c 'cd /mnt && rm -rf ./* ./.[!.]* 2>/dev/null || true'
fi

log "Restoring $ARCHIVE_NAME -> $DATA_VOLUME"
docker run --rm -v "${DATA_VOLUME}:/mnt" -v "${ARCHIVE_DIR}:/backup:ro" "$IMAGE" \
    tar -C /mnt -xzf "/backup/$ARCHIVE_NAME"

log "Restore completed."
log "The app's launch token and browser session cookie are authority-bound: after the service starts,"
log "copy the current http://<host>:<port>/?token=... URL from the container logs and open it again."
