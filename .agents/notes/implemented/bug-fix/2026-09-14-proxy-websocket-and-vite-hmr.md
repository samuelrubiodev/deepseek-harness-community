# Agent Note: Dynamic port proxy WebSocket upgrade and Vite HMR support

Status: implemented

English | [中文](2026-09-14-proxy-websocket-and-vite-hmr.zh.md)

## Problem

Development servers such as Vite rely on WebSocket connections for Hot Module Replacement (HMR) and live reload. When accessed through `/proxy/<port>/`, the browser loads dev scripts like `@vite/client`. Because client scripts default their HMR WebSocket target to root (`ws://<host>/?token=...`) or target loopback (`ws://localhost:<port>/?token=...`), the WebSocket fails against DeepSeek Harness where no root upgrade handler exists. Furthermore, `WebServer` previously matched upgrade routes only by exact pathname, preventing prefix routing and fallback upgrade handling for `/proxy`.

## Decision

`WebServer` extends `WebUpgradeRoute` with `kind?: WebRouteKind`, supporting both exact-path and prefix upgrade routes with longest-prefix precedence, and adds `registerFallbackUpgrade` for claiming unmatched upgrade requests.

The dynamic proxy registers a prefix upgrade route under `/proxy` and a fallback upgrade handler that resolves the internal port from the request `Referer` header. Outgoing proxy upgrade requests normalize `Host` and `Origin` to loopback (`127.0.0.1:<port>`), preserve WebSocket protocol and handshake headers, and bridge duplex streams upon receiving `101 Switching Protocols`.

The HTML rewriting pass in `rewriteHtml` extends its client-side proxy shim to patch `window.WebSocket` and `window.EventSource`. URLs targeting the same host or the target loopback port are rewritten to `/proxy/<port>/...` before socket construction, preserving prototypes, static constants, and subprotocol arrays.

## Alternatives considered

**Require manual Vite HMR configuration.** Forcing users or agents to set `server.hmr.path` in `vite.config.ts` fails on zero-config projects, Python dev servers, and interactive prototypes.

**Rely solely on Referer-based fallback upgrades.** While effective when Referer is sent, privacy settings or stripped headers could leave connections unrouted. The client-side WebSocket shim ensures the explicit `/proxy/<port>/` URL is requested from the start.

## Consequences

Internal dev servers using WebSockets or Server-Sent Events work seamlessly through `/proxy/<port>/` on trusted hosts without requiring custom configuration or extra open ports. `WebServer` retains exact-path priority for existing routes such as `/api/remote.mux` while enabling prefix and fallback upgrade extensions.

## Testing

`webserver.spec.ts` verifies exact and prefix upgrade dispatch, duplicate rejection, and fallback upgrade handling. `proxy.spec.ts` verifies WebSocket upgrade forwarding, bidirectional duplex streaming, client shim script injection, Referer fallback extraction, and 400/403/502 failure handling.
