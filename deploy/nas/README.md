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

The fork publishes multi-architecture images (amd64 + arm64) to GHCR:

```text
ghcr.io/samuelrubiodev/deepseek-harness-community:stable                  # latest stable release
ghcr.io/samuelrubiodev/deepseek-harness-community:dsh-v<version>          # pinned releases
ghcr.io/samuelrubiodev/deepseek-harness-community:latest                  # current master
```

The templates above already point at the registry: `docker compose up -d`
pulls on its own — no login, no build, no repository checkout. Prefer clicking
on Synology/TrueNAS? Use the host's Registry/pull UI against the same address.

For the `:latest` tag the image follows master and can change under you; if
you want a stable install, pin the release tag (e.g.
`dsh-v0.1.2-alpha.5-community.1`) in `image:` and upgrade deliberately.

Offline hosts that cannot reach `ghcr.io`: build once on a workstation with
the fork checked out and transfer the artifact —

```sh
docker compose build
docker save deepseek-harness:latest | ssh nas 'sudo docker load'
```

(TrueNAS SCALE 24.10+ uses `sudo docker load`; older middleware used
k3s/`ctr images import`. A private registry works the same way: change
`image:` to its pull address.)

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
- **Unraid**: the image runs securely as the unprivileged `node` user (UID/GID 1000),
  preventing root file creation on the array. Ensure host directories under
  `/mnt/user/appdata/deepseek-harness/` are owned or writable by UID 1000 so the
  container and agent can read and write files without requiring root.
- **TrueNAS SCALE**: prefer a dedicated dataset for `/data` and enable ZFS
  snapshots on it — the operations backup script stays a convenience, not the
  only recovery path. In the Apps UI form, paste the compose YAML from `image:`
  down (the form supplies its own enclosing keys).

## Upgrades and rollback

Templates pin `image: ghcr.io/samuelrubiodev/deepseek-harness-community:latest`.
Update by pulling and recreating:

```sh
docker compose pull
./deploy/operations/update-image.sh save    # pin current as rollback-<timestamp>
docker compose up -d                        # recreate on the new image
```

If the new image misbehaves, `./deploy/operations/update-image.sh rollback`
moves `latest` back to the pinned image and recreates the service. To update a
*pinned-tag* install instead, edit `image:` to the new tag. Details in the
[operations guide](../operations/README.md).
