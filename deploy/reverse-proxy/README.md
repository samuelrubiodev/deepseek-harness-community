# Reverse Proxy Deployment Guide (Nginx, Caddy, Traefik, Cloudflare Tunnel)

This guide provides reference configurations and best practices for deploying **DeepSeek Harness** in production or home server environments behind a reverse proxy with SSL/TLS termination and WebSocket support.

---

## 1. Network Fundamentals and Prerequisites

To ensure DeepSeek Harness operates reliably behind a reverse proxy, configure the container with the following environment variables:

| Variable | Recommended Value | Purpose |
| :--- | :--- | :--- |
| `DSH_HOST` | `0.0.0.0` | Binds the HTTP server to all network interfaces within the container. |
| `DSH_PORT` | `3080` | Internal HTTP listening port. |
| `DSH_REVERSE_PROXY` | `true` | Enables extraction of `X-Forwarded-Host` and `X-Forwarded-Proto` for trust fence evaluation and authority-bound authentication cookies. |
| `DSH_TRUSTED_HOSTS` | `example.com,harness.local` | Comma-separated list of hostnames or IP addresses through which clients access the harness. |

### Essential Reverse Proxy Requirements

1. **Preserve the Public Host (`X-Forwarded-Host`)**:
   The reverse proxy must forward the browser-facing host via `X-Forwarded-Host` (or preserve `Host: $host`). Session cookies (`dsh-auth-<hash>`) and the trust fence validate against the exact authority present in the browser address bar.

2. **Propagate the Real Protocol (`X-Forwarded-Proto`)**:
   When terminating SSL at the proxy and connecting to the container over plain HTTP, the proxy must send `X-Forwarded-Proto: https`. Otherwise, the server rejects requests with `403 Forbidden` due to an origin mismatch between `https://` (the browser origin) and `http://` (the proxy scheme).

3. **Full WebSocket Support (`/api/remote.mux`)**:
   DeepSeek Harness relies on persistent WebSocket connections for real-time bi-directional agent streaming and event multiplexing. The proxy must pass the `Upgrade` and `Connection` headers.

4. **Disable Response Buffering**:
   DeepSeek reasoning models stream tokens character by character. If proxy buffering is enabled (default in Nginx), the output is held in memory buffers and delivered in delayed bursts instead of fluid real-time streaming.

5. **Extended Timeouts**:
   Deep reasoning steps (such as DeepSeek-R1 inference) can take upwards of 60 seconds before emitting the first token. Proxy read and send timeouts (`proxy_read_timeout`) should be configured to generous thresholds (e.g., `86400s` or `3600s`).

---

## 2. Supported Servers and Examples

### Option A: Nginx

Reference file: [`nginx.conf`](./nginx.conf)

Key configuration highlights in Nginx:
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name harness.example.com;

    client_max_body_size 300M; # Matches the 300 MiB attachment payload limit

    location / {
        proxy_pass http://harness:3080;
        proxy_http_version 1.1;

        # Authority and forwarding headers
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Disable buffering for real-time LLM token streaming
        proxy_buffering off;
        proxy_cache off;

        # Extended timeouts for reasoning loops
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

### Option B: Caddy

Reference file: [`Caddyfile`](./Caddyfile)

Caddy manages SSL certificates automatically and handles WebSockets natively:
```caddyfile
harness.example.com {
    reverse_proxy harness:3080 {
        header_up Host {host}
        header_up X-Forwarded-Host {host}
        header_up X-Forwarded-Proto https
        flush_interval -1 # Disables response buffering for instant streaming
    }
}
```

---

### Option C: Traefik (Docker Compose)

Reference file: [`docker-compose.traefik.yml`](./docker-compose.traefik.yml)

Docker service labels for DeepSeek Harness:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.dsh.rule=Host(`harness.example.com`)"
  - "traefik.http.routers.dsh.entrypoints=websecure"
  - "traefik.http.routers.dsh.tls.certresolver=myresolver"
  - "traefik.http.services.dsh.loadbalancer.server.port=3080"
  - "traefik.http.middlewares.dsh-headers.headers.customrequestheaders.X-Forwarded-Proto=https"
  - "traefik.http.routers.dsh.middlewares=dsh-headers"
```

---

### Option D: Cloudflare Tunnel / Dokploy / Coolify

When deploying behind Cloudflare Tunnels, Dokploy, or Coolify:
1. Route the tunnel HTTP service to `http://harness:3080`.
2. In the tunnel settings, enable **WebSockets**.
3. Set the environment variables in the DeepSeek Harness service:
   ```env
   DSH_REVERSE_PROXY=true
   DSH_TRUSTED_HOSTS=my-tunnel-domain.com
   ```

---

## 3. Diagnostics and Troubleshooting

If you encounter connection or authentication rejections when accessing through your proxy, inspect the container logs:
```bash
docker compose logs -f harness
```

The structured diagnostics introduced in Phase 6 output actionable explanations:

* `API request rejected (403): untrusted host "example.com"`:
  * **Cause**: The incoming host header is not listed in `DSH_TRUSTED_HOSTS`.
  * **Resolution**: Add `example.com` to `DSH_TRUSTED_HOSTS` in your `.env` or compose file.

* `API request rejected (403): origin mismatch ("https://example.com" vs "http://example.com")`:
  * **Cause**: The proxy terminates TLS but does not forward `X-Forwarded-Proto: https`.
  * **Resolution**: Add `proxy_set_header X-Forwarded-Proto https;` (or equivalent) in your proxy.

* `API request rejected (401): session cookie authority mismatch`:
  * **Cause**: The browser cookie was minted for a different host/port than the one currently requested.
  * **Resolution**: Access the initial web URL printed on startup using the proxy domain to issue a fresh cookie for that authority.
