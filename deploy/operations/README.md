# Production Operations Guide

Operational procedures for administrators running the DeepSeek Harness
Community Fork as a long-lived service: NAS and server deployment templates,
backup and restore of the `/data` volume, and image update and rollback.

All scripts in this directory use only the plain Docker CLI (plus the Compose
plugin when available), so they also work on hosts whose Docker cannot build
images or lacks a toolchain — Synology DSM, Unraid, and TrueNAS SCALE included.

| File | Purpose |
| :--- | :--- |
| `backup-data.sh` | Archive the data volume to a timestamped tarball + SHA-256 checksum. |
| `restore-data.sh` | Restore a data volume from an archive (merge or exact replace). |
| `update-image.sh` | Pin the running image before an update (`save`), move the tag back after a failed one (`rollback`), inspect state (`list`). |
| [`../nas/`](../nas/README.md) | Ready-made `docker-compose.yml` templates for Synology, Unraid, TrueNAS, and generic servers. |

---

## 1. Deployment targets

The application contract is identical on every host: image
`deepseek-harness`, environment variables from [.env.example](../../.env.example)
(see the configuration table in the [root README](../../README.md#configuration)),
and two writable paths — `/data` (state) and `/workspace` (agent files).

The templates in [`../nas/`](../nas/README.md) differ only in how those two paths map
onto host storage and how the image arrives:

| Template | Storage mapping | Image delivery |
| :--- | :--- | :--- |
| `docker-compose.synology.yml` | Bind mounts under `/volume1/docker/dsh/` (visible in File Station for Hyper Backup) | `docker save`/`load` over SSH or a private registry |
| `docker-compose.unraid.yml` | Bind mounts under `/mnt/user/appdata/deepseek-harness/` (covered by CA Backup) | `docker save`/`load` or registry |
| `docker-compose.truenas.yml` | Bind mounts to pool datasets (`/mnt/tank/apps/dsh-data`) — ZFS snapshots are the backup layer | `docker save` + `sudo docker load` |
| `docker-compose.server.yml` | Bind mounts under `/srv/dsh/`, no build context needed | Registry or `docker save`/`load` |

On every NAS, before first start, set `DSH_TRUSTED_HOSTS` to the address users
type in the browser — requests with any other `Host` header get HTTP 403, and
that is the expected, configured behavior, not a malfunction.

The repository-root [docker-compose.yml](../../docker-compose.yml) remains the
source checkout option: it builds the image locally (`docker compose up -d
--build`).

## 2. Routine operations

```sh
docker compose ps                                 # status + (healthy)
docker compose logs --tail 100 harness           # launch token URL, 403/401 diagnostics
docker compose restart harness                   # config re-read of process env only
docker compose up -d                             # apply .env changes (recreates if needed)
docker compose down                              # stop, KEEP volumes
```

- **Healthcheck**: the container probes `http://127.0.0.1:<port>/` and treats
  `200`/`303`/`401` as healthy — `401` is the unauthenticated challenge and
  proves the server and runtime are alive. The probe honors `DSH_PORT` then
  `PORT`, so a non-default port reports correctly.
- **Sign-in after any restart**: the launch token changes on every start. Read
  the fresh `http://<host>:<port>/?token=…` URL from the logs; the browser
  session cookie then re-mints for the authority you actually use.
- **Log rotation**: every template sets the `json-file` driver at 10 MB × 3
  files, so a chatty deployment cannot fill the NAS volume through logs.

## 3. Backup

### What lives in `/data` (`DSH_HOME`)

| Path | Contents | Regenerable? |
| :--- | :--- | :--- |
| `profiles/` | Installed plugin profiles (`cordis.yml`, manifests) and their `node_modules` | Partly — `pnpm install` rebuilds the links, but the profile definitions are yours |
| `sessions/` | JSONL session logs (chat history, commands) | **No** |
| `storages/` | Extension databases (SQLite and JSON) | **No** |
| `settings/` | User settings persisted by the Settings panel | **No** |
| `.credentials.yaml` | Stored credentials | **No** |
| `.anonymous-user-id` | Anonymous identity | No (re-generated on demand, changes telemetry identity) |
| `.pnpm-store/`, `.pnpm/` | Package download cache for plugin installs | **Yes** — re-downloaded on demand |

`backup-data.sh` excludes the pnpm store by default (`--full` includes it).
Add `--workspace` to also archive `/workspace` (the agent's working files) into
a second tarball.

### Run a backup

```sh
# from the deployment directory
./deploy/operations/backup-data.sh --output /volume1/homes/admin/dsh-backups

# crash-consistent: stop the container first, restart it afterwards
./deploy/operations/backup-data.sh --service

# also archive the workspace volume
./deploy/operations/backup-data.sh --workspace
```

The volume is opened read-only from a throwaway `alpine` container, tarball'ed
with gzip, verified with `tar -t`, and checksummed with `sha256sum` next to the
archive. Volume resolution accepts the Compose resource name (`dsh-data`) and
finds the real prefixed volume (`deepseek-harness_dsh-data`) automatically.

Schedule it with the host's planner (DSM Task Scheduler: a root scheduled task
running the command above with `--service`; cron elsewhere):

```cron
30 3 * * * cd /opt/deepseek-harness && ./deploy/operations/backup-data.sh --output /srv/backups --service >/var/log/dsh-backup.log 2>&1
```

**The archive contains credentials and full session history.** Keep it on
encrypted or access-controlled storage; ship it off-host (Synology Active
Backup / Cloud Sync, `rsync`, TrueNAS replication) — a backup next to the
volume it protects is not a backup.

### Restore

Stop nothing manually if you pass `--service` — the script stops the container
using the volume and restarts it on exit:

```sh
# latest archive, merged into the existing volume (files the backup lacks survive)
./deploy/operations/restore-data.sh --latest --service

# exact point-in-time state (deletes current volume contents first)
./deploy/operations/restore-data.sh --archive /srv/backups/dsh-data-20260902-030000.tar.gz --replace --service

# prove an archive is intact without touching anything
./deploy/operations/restore-data.sh --archive FILE --verify-only
```

Restores refuse to run on a checksum mismatch. After any restore, sign in
again from the token URL in the logs: cookies are bound to the authority that
minted them, and a restore usually accompanies a different host or port.

### Disaster recovery on a fresh machine

1. Install Docker, copy a template from [`../nas/`](../nas/README.md) (or the root
   compose file) and your `.env`.
2. `docker compose up -d` once to create the volumes, then `docker compose stop`.
3. `./deploy/operations/restore-data.sh --archive FILE --replace --yes`
4. `docker compose up -d`, read the token URL, open it.

Back up the `.env` (or its non-secret parts) alongside the archives — restoring
onto a host with different `DSH_TRUSTED_HOSTS` yields 403s that look like data
loss but are only configuration.

## 4. Updating the app image

Two update sources exist; both follow the same order of operations:

```sh
./deploy/operations/update-image.sh save      # 1. pin current image as rollback-<timestamp>
# 2. bring the new image in:
#    a) from source: ./scripts/sync-upstream.sh --merge && docker compose build --pull
#    b) prebuilt:    docker load < new-image.tar  (retagged deepseek-harness:latest)
docker compose up -d                          # 3. recreate the service on the new image
docker compose ps                             # 4. expect (healthy) within ~30 s
docker compose logs --tail 50 harness         # 5. boot looks clean?
docker image rm deepseek-harness:rollback-*   # 6. optional: drop the pin once satisfied
```

### Data compatibility warning

Upstream makes **no forward-compatibility promise for on-disk data**: session
logs and SQLite store `SCHEMA_VERSION`s only increase, and a backend asked to
read data written by a newer version refuses rather than migrates it down.
After an update that changed a format, `rollback` moves the image back but
`/data` may already hold new-format rows. Therefore:

1. Run `backup-data.sh` **immediately before** `update-image.sh save`, so the
   data matches the pinned image.
2. If a rolled-back app fails on startup with a version/refusal error, restore
   the matching backup too:
   `./deploy/operations/restore-data.sh --archive FILE --replace --service`.

## 5. Rollback after a failed update

```sh
./deploy/operations/update-image.sh list       # what can I go back to?
./deploy/operations/update-image.sh rollback   # newest rollback reference
./deploy/operations/update-image.sh rollback deepseek-harness:rollback-20260902-213500  # explicit
```

`rollback` retags `deepseek-harness:latest` to the pinned image and recreates
the service (`--force-recreate`), without touching volumes. On hosts where the
Compose project cannot be resolved (plain-Docker DSM UI deployments), it still
retags and prints the manual recreate steps; the Synology path is Container
Tools → stop → delete (keep volumes) → re-create.

Verify after rollback exactly as after an update: `(healthy)` in
`docker compose ps`, a clean log tail, and a successful sign-in through the
token URL.

## 6. Known failure modes

| Symptom | Diagnosis | Action |
| :--- | :--- | :--- |
| `unhealthy` right after deploy on a custom port | Older image healthcheck reads only `PORT` | Current images also honor `DSH_PORT`; rebuild the image or map the container port 1:1 with the host port |
| 403 after restore on a new host/IP | Logins use an address missing from `DSH_TRUSTED_HOSTS` | The log line names the rejected `Host`; add it and recreate |
| Rollback app refuses to boot | `/data` was written by a newer schema | Restore the backup taken before the update (§4) |
| `no data volume named 'dsh-data'` or `multiple volumes match` | No volume carries that Compose resource label, or several stacks reuse the name | `docker volume ls`, then pass the exact prefixed name to `--data` |
| Backup tarball lacks `profiles/`/`sessions/` | A different (empty) volume was resolved — several stacks reuse the resource name | Re-run with the exact `--data` name from `docker volume ls` |
