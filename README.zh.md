# DeepSeek Harness — Community Fork

[English](README.md) | 中文

面向家庭服务器与局域网部署的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）自助发行版。它提供一条命令的 Docker 部署、局域网与反向代理访问，以及声明式环境配置——同时不重写上游代码，让 `git merge upstream/master` 保持低成本。

> **安全须知**：DeepSeek Harness 会执行模型生成的代码。在将其暴露到你的网络之前，请先阅读 [SAFETY.zh.md](SAFETY.zh.md)，并且只信任你自己控制的主机。

## 本 fork 的改动

上游默认只绑定 `127.0.0.1`，并有意拒绝局域网与代理访问。本 fork 保留上游的安全模型，但将其改为声明式：

- **局域网访问**（`http://<你的IP>:3080`）：通过显式的受信主机白名单（`DSH_TRUSTED_HOSTS`）实现，而不是硬编码的 403 拒绝。
- **反向代理支持**（Nginx、Caddy、Traefik、Cloudflare Tunnel）：代理转发 `X-Forwarded-Host` / `X-Forwarded-Proto` 后，信任栅栏与会话 Cookie 会跟随浏览器所见的权威地址。
- **设置界面解锁**：来自受信主机的客户端也能使用设置面板——不再局限于 `localhost`。
- **Docker 原生插件管理**：`pnpm` 已预装，其存储区持久化在 `/data` 卷上。
- **结构化诊断**：被拒绝的请求会在 `docker compose logs` 中输出精确且不含凭据的原因（`untrusted host "…"`、`origin mismatch (…)`、`session cookie expired at …`）。

其余一切——agent 循环、插件、会话存储——都是未修改的上游代码。

<a id="run"></a>

## 运行

### 使用 Docker 运行

参见上文的[快速开始（Docker）](#quick-start-docker)。

<a id="run-from-source"></a>

### 从源码运行

参见下文的[从源码运行（无 Docker）](#running-from-source-no-docker)。

<a id="quick-start-docker"></a>

## 快速开始（Docker）

环境要求：Docker Engine 24+ 与 Docker Compose v2。

```sh
git clone https://github.com/samuelrubiodev/deepseek-harness-community.git
cd deepseek-harness-community
cp .env.example .env
docker compose up -d --build
```

打开 `http://<服务器IP>:3080`，在引导对话框中填入你的 `DEEPSEEK_API_KEY`（也可先在 `.env` 中设置）。首次构建会编译 TypeScript monorepo，需要几分钟；之后的启动是即时的。

两个卷在升级与容器重建后保留全部状态：

| 卷 | 挂载点 | 内容 |
| :--- | :--- | :--- |
| `dsh-data` | `/data` | `$DSH_HOME`：会话、profile、插件、凭据、设置 |
| `dsh-workspace` | `/workspace` | agent 的工作目录与你的项目 |

检查健康状态与日志（期望 `Up (healthy)`）：

```sh
docker compose ps
docker compose logs -f harness
```

如果在 NAS（Synology、Unraid、TrueNAS）或缺少构建工具链的服务器上运行，请使用 [deploy/nas/](deploy/nas/README.md) 中的模板并加载预构建镜像。日常运维——`/data` 备份、恢复、更新锚定与回滚——已脚本化于 [deploy/operations/](deploy/operations/README.md)。

## 配置

所有配置项都是环境变量，在 [.env.example](.env.example) 中有详尽说明。将其复制为 `.env`，然后用 `docker compose up -d` 重启。

| 变量 | 默认值 | 用途 |
| :--- | :--- | :--- |
| `DSH_HOST` | `0.0.0.0` | 服务器在容器内绑定的网络接口。 |
| `DSH_PORT` | `3080` | 监听端口（Compose 同时映射该端口）。 |
| `DSH_TRUSTED_HOSTS` | *（空）* | 允许访问 Web UI 的主机名/IP 白名单，如 `192.168.1.50,harness.lan`。携带其他 `Host` 头的请求会得到 403。 |
| `DSH_REVERSE_PROXY` | `false` | 在 Nginx/Caddy/Traefik/隧道后设为 `true`：代理的 `X-Forwarded-Host` / `X-Forwarded-Proto` 随即决定信任与 Cookie 权威。 |
| `DEEPSEEK_API_KEY` | *（空）* | DeepSeek API 密钥；也可在 Web UI 中输入。 |
| `DSH_HOME` | `/data` | 容器内的持久状态根目录。 |

`DSH_*` 变量属于进程级引导配置：Compose 以原生方式注入它们，分层环境加载器会拒绝工作区 `.env` 文件中的此类变量——请放在仓库根目录的 `.env`（或 Compose 的 `environment:` 块）中，绝不放入 `/workspace/.env`。

### 局域网访问

把用户在浏览器中输入的每个地址加入 `DSH_TRUSTED_HOSTS`，然后重启：

```sh
DSH_TRUSTED_HOSTS=192.168.1.50,harness.lan docker compose up -d
```

该列表中的主机还能使用 Web UI 中持久的设置面板。

### 反向代理

针对 Nginx、Caddy、Traefik 与 Cloudflare Tunnel 的参考配置（含 TLS 终结、WebSocket 透传 `/api/remote.mux`、为流式输出关闭缓冲、长超时）位于 [deploy/reverse-proxy/](deploy/reverse-proxy/README.md)。任何代理的最低要求：

1. 设置 `DSH_REVERSE_PROXY=true`，并把公开主机名加入 `DSH_TRUSTED_HOSTS`。
2. 转发 `X-Forwarded-Host: $host` 与 `X-Forwarded-Proto: https`（在终结 TLS 的代理上）。
3. 传递 `Upgrade` / `Connection` 头，并关闭响应缓冲。

## 升级

```sh
./scripts/sync-upstream.sh --check
./scripts/sync-upstream.sh --merge
```

同步工具及其冲突解决手册见 [deploy/sync/README.md](deploy/sync/README.md)。合并前先固定回滚点并备份数据；合并本身不会触碰 `/data`：

```sh
./deploy/operations/update-image.sh save
./deploy/operations/backup-data.sh --service
```

构建后重建容器（`docker compose up -d --build`）；若新镜像行为异常，用 `./deploy/operations/update-image.sh rollback` 把标签切回。完整的更新、备份、恢复与回滚流程（以及 NAS 部署模板）见 [deploy/operations/README.md](deploy/operations/README.md)。

<a id="running-from-source-no-docker"></a>

## 从源码运行（无 Docker）

与上游相同的环境要求：Node.js ^22.19 或 24，以及 pnpm 11。

```sh
pnpm install
pnpm run build
DSH_HOST=0.0.0.0 DSH_TRUSTED_HOSTS=192.168.1.50 pnpm dsh web --no-open
```

`--host 0.0.0.0` 会打印一条安全警告并绑定所有网络接口；配合 `DSH_TRUSTED_HOSTS` 决定谁可以连接。

## 故障排查

先从日志读取拒绝原因——每个 403/401 都会说明确切原因：

| 日志消息 | 原因 | 解决办法 |
| :--- | :--- | :--- |
| `untrusted host "…"`, `trustedHosts: (…)` | `Host` 头不在白名单中 | 把该主机加入 `DSH_TRUSTED_HOSTS` 并重启 |
| `origin mismatch ("https://…" vs "http://…")` | 代理终结了 TLS 但未转发 `X-Forwarded-Proto` | 设置 `proxy_set_header X-Forwarded-Proto https;` |
| `session cookie authority mismatch` | Cookie 是为不同的主机/端口签发的 | 通过同一代理权威重新打开启动 URL |
| `session cookie expired at …` | 30 天 Cookie 有效期已过 | 重新打开 `dsh web` 打印的 URL 重新认证 |

健康检查：容器探测 `http://127.0.0.1:<port>/`，把 200/303/401 都视为健康——401 是预期的未认证质询，证明 HTTP 服务器与 Cordis 运行时存活。

## 仓库结构（fork 特有）

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

上游的 `packages/`、`apps/` 与文档均未修改，仅上文描述的受信主机、反向代理与诊断特性除外。

## 社区与支持

上游资源同样适用：[DeepSeek Harness 文档](https://deepseek-harness.github.io/deepseek-harness/)、[Discord 社区](https://discord.gg/Ycq5dCaS4)、[GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)。fork 特有的问题请提交到[本仓库的 issues](https://github.com/samuelrubiodev/deepseek-harness-community/issues)。

## 许可证

[MIT](LICENSE)，与上游一致。第三方声明：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
