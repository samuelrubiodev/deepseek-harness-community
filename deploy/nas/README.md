# NAS and Server Deployment Templates

Ready-to-adapt `docker-compose.yml` files for hosts where the repository-root
compose file (which builds from source) does not fit:

| Template | Host | State location |
| :--- | :--- | :--- |
| `docker-compose.synology.yml` | Synology DSM (Container Tools / Container Manager) | `/volume1/docker/dsh/{data,workspace}` |
| `docker-compose.unraid.yml` | Unraid (Docker Compose Manager or a manual app) | `/mnt/user/appdata/deepseek-harness/{data,workspace}` |
| `docker-compose.truenas.yml` | TrueNAS SCALE (Apps > Install Manual App, or plain compose) | `/mnt/tank/apps/dsh-{data,workspace}` datasets |
| `docker-compose.server.yml` | Generic Linux server running prebuilt images (no toolchain, no checkout) | `/srv/dsh/{data,workspace}` |

These templates use bind mounts instead of named volumes so the NAS's own
storage tools (Synology Hyper Backup, Unraid CA Backup, TrueNAS ZFS snapshots)
see the application state directly. The scripts in
[`../operations/`](../operations/README.md) work with both layouts: they target
named volumes on the root compose deployment, and on bind-mount hosts you can
back up the host directory with any file archiver — stop the container first
(`docker stop deepseek-harness`) so SQLite stores are flushed and quiet.

## Getting the image onto the NAS

NAS appliances do not compile the TypeScript monorepo. Build once on any
machine with Docker (your workstation, or CI) and ship the artifact:

```sh
# On a workstation with the fork checked out:
docker compose build

# Pipe the image over SSH (no registry needed):
docker save deepseek-harness:latest | ssh nas 'docker load'
# Synology: prefix the remote command with sudo.
# TrueNAS SCALE 24.10+: sudo docker load; older middleware used k3s/ctr.
```

Alternatively push `deepseek-harness:latest` to a private registry and change
`image:` in the template to its pull address.

## Before the first start

1. Edit `DSH_TRUSTED_HOSTS` in the template: every address users type into the
   browser (LAN IP, mDNS name, or domain), comma-separated. Requests carrying
   any other `Host` header receive HTTP 403 by design.
2. Set `DSH_REVERSE_PROXY=true` only when a reverse proxy in front of the NAS
   forwards `X-Forwarded-Host` and `X-Forwarded-Proto` — see
   [../reverse-proxy/](../reverse-proxy/README.md).
3. Start the stack (`docker compose up -d`, or the host UI's equivalent) and
   copy the `http://<host>:3080/?token=…` URL from the container logs — the
   token is regenerated on every start and is the only way to sign a new
   browser in.

## Host-specific notes

- **Synology DSM**: expose the service through DSM's built-in reverse proxy
  (Control Panel > Portal); DSM's own login portal keeps ports 5000/5001.
  If 3080 is taken, the simplest fix is remapping only the host side
  (`"3081:3080"`) and adding the new address to `DSH_TRUSTED_HOSTS`. If you
  change `DSH_PORT` instead, update both sides of the mapping to match it —
  the app binds `DSH_PORT` inside the container and the healthcheck follows
  it, but the host side of the mapping never adapts on its own.
- **Unraid**: the image runs as root and has no PUID/PGID handling, so files
  the agent writes into `/workspace` appear root-owned on the array. If
  Windows/SMB users must edit them, chown periodically, share over NFS, or
  place `/workspace` on cache with an ownership-mapping mount.
- **TrueNAS SCALE**: prefer a dedicated dataset for `/data` and enable ZFS
  snapshots on it — the operations backup script stays a convenience, not the
  only recovery path. In the Apps UI form, paste the compose YAML from `image:`
  down (the form supplies its own enclosing keys).

## Upgrades and rollback

Templates pin `image: deepseek-harness:latest`. Update by loading a new image
with the same name and recreating the stack; pin a rollback point first with
[`../operations/update-image.sh`](../operations/update-image.sh) (`save`), and
undo a bad upgrade with `rollback`. Details in the
[operations guide](../operations/README.md).
