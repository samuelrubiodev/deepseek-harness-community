# DeepSeek Harness — Community Fork

[English](README.zh.md) | 中文

A self-service distribution of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) for home servers and LAN deployments. It adds a one-command Docker setup, local-network and reverse-proxy access, and declarative environment configuration — without rewriting upstream code, so `git merge upstream/master` stays cheap.

> **Safety notice**: DeepSeek Harness executes model-generated code. Read [SAFETY.md](SAFETY.md) before exposing it to your network, and only trust hosts you control.

## What this fork changes

Upstream binds to `127.0.0.1` only and rejects LAN or proxy access by design. This fork keeps upstream's security model but makes it declarative:

- **LAN access** (`http://<your-ip>:3080`) through an explicit trusted-hosts allowlist (`DSH_TRUSTED_HOSTS`) instead of hard-coded 403 rejections.
- **Reverse-proxy support** (Nginx, Caddy, Traefik, Cloudflare Tunnel): forward `X-Forwarded-Host` / `X-Forwarded-Proto` and the trust fence and session cookies follow the browser-facing authority.
- **Settings UI unlocked** for clients on trusted hosts — not just `localhost`.
- **Docker-native plugin management**: `pnpm` is preinstalled and its store persists on the `/data` volume.
- **Structured diagnostics**: rejected requests log an exact, credential-free reason (`untrusted host "…"`, `origin mismatch (…)`, `session cookie expired at …`) to `docker compose logs`.

Everything else — the agent loop, plugins, session storage — is upstream code, unmodified.

<a id="run"></a>

## Run

### Run with Docker

See [Quick start (Docker)](#quick-start-docker) above.

### Run from source

See [Running from source (no Docker)](#running-from-source-no-docker) below.

## Quick start (Docker)

Requirements: Docker Engine 24+ and Docker Compose v2.

```sh
git clone https://github.com/samuelrubiodev/deepseek-harness-community.git
cd deepseek-harness-community
cp .env.example .env
docker compose up -d --build
```

Open `http://<server-ip>:3080` and paste your `DEEPSEEK_API_KEY` in the onboarding dialog (or set it in `.env` first). The first build compiles the TypeScript monorepo and takes a few minutes; later starts are immediate.

Two volumes persist all state across upgrades and container recreation:

| Volume | Mount | Contents |
| :--- | :--- | :--- |
| `dsh-data` | `/data` | `$DSH_HOME`: sessions, profiles, plugins, credentials, settings |
| `dsh-workspace` | `/workspace` | The directory the agent works in and your projects |

Check health and logs (expect `Up (healthy)`):

```sh
docker compose ps
docker compose logs -f harness
```

Running on a NAS (Synology, Unraid, TrueNAS) or a server without a build toolchain? Use the templates in [deploy/nas/](deploy/nas/README.md) and load a prebuilt image. Day-2 operations — backup of `/data`, restore, update pinning, and rollback — are scripted in [deploy/operations/](deploy/operations/README.md).

## Configuration

All knobs are environment variables, documented exhaustively in [.env.example](.env.example). Copy it to `.env` and restart with `docker compose up -d`.

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `DSH_HOST` | `0.0.0.0` | Interface the server binds to inside the container. |
| `DSH_PORT` | `3080` | Listening port (also mapped by Compose). |
| `DSH_TRUSTED_HOSTS` | *(empty)* | Comma-separated hostnames/IPs allowed to reach the Web UI, e.g. `192.168.1.50,harness.lan`. Requests with any other `Host` header get 403. |
| `DSH_REVERSE_PROXY` | `false` | Set `true` behind Nginx/Caddy/Traefik/tunnels: the proxy's `X-Forwarded-Host` / `X-Forwarded-Proto` then drive trust and cookie authority. |
| `DEEPSEEK_API_KEY` | *(empty)* | DeepSeek API key; can also be entered in the Web UI. |
| `DSH_HOME` | `/data` | Durable state root inside the container. |

`DSH_*` variables are process-level bootstrap configuration: Compose injects them natively, and the layered env loader rejects them inside project `.env` files — put them in the repository root `.env` (or the Compose `environment:` block), never in `/workspace/.env`.

### LAN access

Add every address users type into the browser to `DSH_TRUSTED_HOSTS`, then restart:

```sh
DSH_TRUSTED_HOSTS=192.168.1.50,harness.lan docker compose up -d
```

Hosts on that list also get the persistent Settings panel in the Web UI.

### Reverse proxy

Reference configurations with TLS termination, WebSocket passthrough (`/api/remote.mux`), streaming-friendly buffering off, and long timeouts live in [deploy/reverse-proxy/](deploy/reverse-proxy/README.md) for Nginx, Caddy, Traefik, and Cloudflare Tunnel. Minimum contract for any proxy:

1. Set `DSH_REVERSE_PROXY=true` and add the public hostname to `DSH_TRUSTED_HOSTS`.
2. Forward `X-Forwarded-Host: $host` and `X-Forwarded-Proto: https` (at TLS-terminating proxies).
3. Pass `Upgrade` / `Connection` headers and disable response buffering.

## Upgrading

```sh
./scripts/sync-upstream.sh --check
./scripts/sync-upstream.sh --merge
```

The sync tool and its conflict-resolution runbook are documented in [deploy/sync/README.md](deploy/sync/README.md). Before merging, pin a rollback point and back up your data; the merge itself never touches `/data`:

```sh
./deploy/operations/update-image.sh save
./deploy/operations/backup-data.sh --service
```

Recreate after building (`docker compose up -d --build`), and if the new image misbehaves, move the tag back with `./deploy/operations/update-image.sh rollback`. Full update, backup, restore, and rollback procedures — plus NAS deployment templates — are in [deploy/operations/README.md](deploy/operations/README.md).

## Running from source (no Docker)

Same requirements as upstream: Node.js ^22.19 or 24 and pnpm 11.

```sh
pnpm install
pnpm run build
DSH_HOST=0.0.0.0 DSH_TRUSTED_HOSTS=192.168.1.50 pnpm dsh web --no-open
```

`--host 0.0.0.0` prints a safety warning and binds all interfaces; combine it with `DSH_TRUSTED_HOSTS` to decide who may connect.

## Troubleshooting

Read the rejection reason from the logs first — every 403/401 names its exact cause:

| Log message | Cause | Fix |
| :--- | :--- | :--- |
| `untrusted host "…"`, `trustedHosts: (…)` | `Host` header not on the allowlist | Add the host to `DSH_TRUSTED_HOSTS` and restart |
| `origin mismatch ("https://…" vs "http://…")` | TLS terminated at the proxy but `X-Forwarded-Proto` not forwarded | Set `proxy_set_header X-Forwarded-Proto https;` |
| `session cookie authority mismatch` | Cookie minted for a different host/port | Reopen the startup URL through the same proxy authority |
| `session cookie expired at …` | 30-day cookie lifetime elapsed | Reopen the URL printed by `dsh web` to re-authenticate |

Healthcheck: the container probes `http://127.0.0.1:<port>/` and treats 200/303/401 as healthy — a 401 is the expected unauthenticated challenge, proving the HTTP server and Cordis runtime are alive.

## Repository layout (fork-specific)

```text
docker/                    Dockerfile, entrypoint, healthcheck, Cordis bind patch
docker-compose.yml         Production-ready orchestrator (uses .env)
.env.example               Exhaustive declarative configuration template
deploy/reverse-proxy/      Reference Nginx / Caddy / Traefik / Tunnel configs
deploy/nas/                Synology / Unraid / TrueNAS / server Compose templates
deploy/operations/         Backup, restore, update and rollback scripts and guide
deploy/sync/               Upstream sync runbook
scripts/sync-upstream.sh   Automated upstream merge with conflict simulation
deploy/lab/                Reproducible test lab (proxy scenarios, WebSockets, SSL)
```

Upstream `packages/`, `apps/`, and documentation are unmodified except for the trusted-hosts, reverse-proxy, and diagnostics features described above.

## Community and support

Upstream resources apply: [DeepSeek Harness documentation](https://deepseek-harness.github.io/deepseek-harness/), [Discord community](https://discord.gg/Ycq5dCaS4), and [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions). Fork-specific issues go to [this repository's issues](https://github.com/samuelrubiodev/deepseek-harness-community/issues).

## License

[MIT](LICENSE), matching upstream. Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
