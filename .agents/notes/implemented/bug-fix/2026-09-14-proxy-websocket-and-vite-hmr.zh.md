# Agent 记录：动态端口代理 WebSocket 升级与 Vite HMR 支持

状态：implemented

[English](2026-09-14-proxy-websocket-and-vite-hmr.md) | 中文

## 问题

像 Vite 这样的开发服务器依赖 WebSocket 连接来实现热模块替换（HMR）和实时重载。当通过 `/proxy/<port>/` 访问时，浏览器会加载 `@vite/client` 等开发脚本。由于客户端脚本默认将 HMR WebSocket 目标设为根路径（`ws://<host>/?token=...`）或目标环回端口（`ws://localhost:<port>/?token=...`），WebSocket 请求在没有根升级处理器的 DeepSeek Harness 上会失败。此外，`WebServer` 之前仅按精确 pathname 匹配升级路由，阻碍了针对 `/proxy` 的前缀路由与回退升级处理。

## 决策

`WebServer` 为 `WebUpgradeRoute` 扩展了 `kind?: WebRouteKind`，支持精确路径和最长前缀优先的前缀升级路由，并新增 `registerFallbackUpgrade` 用于认领未匹配的升级请求。

动态代理在 `/proxy` 下注册了前缀升级路由，并注册了从请求 `Referer` 标头解析内部端口的回退升级处理器。发往目标的代理升级请求将 `Host` 和 `Origin` 规范化为环回地址（`127.0.0.1:<port>`），保留 WebSocket 协议和握手标头，并在收到 `101 Switching Protocols` 时建立双工流桥接。

`rewriteHtml` 中的 HTML 重写步骤扩展了其客户端代理垫片，对 `window.WebSocket` 和 `window.EventSource` 进行拦截补丁。指向同源或目标环回端口的 URL 在套接字构造之前会被重写为 `/proxy/<port>/...`，同时完整保留原型、静态常量和子协议数组。

## 备选方案

**要求手动配置 Vite HMR。** 强制用户或智能体在 `vite.config.ts` 中设置 `server.hmr.path` 会导致零配置项目、Python 开发服务器及交互原型失效。

**仅依赖基于 Referer 的回退升级。** 虽然发送 Referer 时有效，但隐私设置或剥离标头可能导致连接无法路由。客户端 WebSocket 垫片确保从一开始就请求显式的 `/proxy/<port>/` URL。

## 后果

使用 WebSocket 或 Server-Sent Events 的内部开发服务器能够在受信任主机上通过 `/proxy/<port>/` 无缝运行，无需自定义配置或额外开放容器端口。`WebServer` 保留了 `/api/remote.mux` 等现有路由的精确路径优先级，同时支持前缀和回退升级扩展。

## 测试

`webserver.spec.ts` 验证精确与前缀升级分发、重复拒绝及回退升级处理。`proxy.spec.ts` 验证 WebSocket 升级转发、双向双工流传输、客户端垫片脚本注入、Referer 回退提取以及 400/403/502 错误处理。
