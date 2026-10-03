# DeepSeek Harness — Community Fork

[English](README.md) | [中文](README.zh.md) | Español

Distribución autoinstalable de [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) para servidores domésticos y despliegues en red local. Añade una instalación Docker de un solo comando, acceso por red local y por proxy inverso, y configuración declarativa por variables de entorno, sin reescribir el código de upstream, de modo que `git merge upstream/master` sigue siendo barato.

> **Aviso de seguridad**: DeepSeek Harness ejecuta código generado por el modelo. Lee [SAFETY.md](SAFETY.md) antes de exponerlo a tu red y confía únicamente en hosts que controles.

## Qué cambia este fork

Upstream se enlaza solo a `127.0.0.1` y rechaza por diseño el acceso por red local o por proxy. Este fork conserva el modelo de seguridad de upstream, pero lo vuelve declarativo:

- **Acceso por red local** (`http://<tu-ip>:3080`) mediante una lista explícita de hosts de confianza (`DSH_TRUSTED_HOSTS`) en lugar de rechazos 403 codificados.
- **Compatibilidad con proxy inverso** (Nginx, Caddy, Traefik, Cloudflare Tunnel): al reenviar `X-Forwarded-Host` / `X-Forwarded-Proto`, la barrera de confianza y las cookies de sesión siguen la autoridad que ve el navegador.
- **Interfaz de ajustes desbloqueada** para los clientes de hosts de confianza, no solo para `localhost`.
- **Proxy dinámico de puertos integrado** (`/proxy/<puerto>/`): abre en el navegador los servidores web, frontends y vistas previas que el agente inicie en cualquier puerto interno (por ejemplo `http://<ip-servidor>:3080/proxy/8210/`, `5173`, `3000`) a través del único puerto de DSH, sin abrir puertos adicionales en Docker.
- **Navegador sin interfaz e inspección visual**: la imagen Docker incluye Chromium, las bibliotecas gráficas del sistema y Playwright preinstalado, de modo que los agentes pueden ejecutar navegadores sin interfaz, capturar pantallas WebGL y autoverificarse visualmente desde el primer arranque.
- **Gestión de complementos nativa de Docker**: `pnpm` viene preinstalado y su almacén persiste en el volumen `/data`.
- **Diagnóstico estructurado**: las peticiones rechazadas registran en `docker compose logs` un motivo exacto y sin credenciales (`untrusted host "…"`, `origin mismatch (…)`, `session cookie expired at …`).
- **Telemetría denegada por defecto**: la telemetría de sesión por OTel, la analítica de producto de escritorio y los metadatos no relacionados con la inferencia que viajan en las peticiones al API oficial de DeepSeek (`dsh_session_log`, `dsh_plugin_packages`) se envían desactivados, y no hay ninguna dirección de recopilador incorporada. Cada uno tiene su propia activación explícita, y `DSH_TELEMETRY_DISABLED` las anula todas. Consulta [Telemetría y privacidad](#telemetry-and-privacy).
- **Interfaz en español**: la interfaz web se distribuye en inglés, chino y español. Sigue el idioma de tu navegador y los ajustes permiten fijar una elección explícita.

Todo lo demás —el bucle del agente, los complementos, el almacenamiento de sesiones— es código de upstream sin modificar.

<a id="run"></a>

## Ejecución

### Ejecutar con Docker

Consulta el [Inicio rápido (Docker)](#quick-start-docker) más arriba.

### Ejecutar desde el código fuente

Consulta [Ejecución desde el código fuente (sin Docker)](#running-from-source-no-docker) más abajo.

<a id="quick-start-docker"></a>

## Inicio rápido (Docker)

Requisitos: Docker Engine 24 o superior y Docker Compose v2.

```sh
git clone https://github.com/samuelrubiodev/deepseek-harness-community.git
cd deepseek-harness-community
cp .env.example .env
docker compose up -d --build
```

Abre `http://<ip-servidor>:3080` y pega tu `DEEPSEEK_API_KEY` en el diálogo de inicio (o defínela antes en `.env`). La primera compilación compila el monorepo de TypeScript y tarda unos minutos; los arranques posteriores son inmediatos.

¿Prefieres no compilar? El fork publica imágenes multiarquitectura (amd64/arm64) en GitHub Container Registry (GHCR) como `ghcr.io/samuelrubiodev/deepseek-harness-community`, con las etiquetas `:stable` (última versión etiquetada), `:latest` (última compilación de la rama por defecto `master`) y `:dsh-v<versión>` (versiones fijadas, por ejemplo `dsh-v0.1.7-alpha.2-community.1`); las plantillas de [deploy/nas/](deploy/nas/README.md) tiran de ella sin inicio de sesión, sin clonar y sin compilar, pensadas para hosts NAS (Synology, Unraid, TrueNAS) y servidores.

Dos volúmenes conservan todo el estado entre actualizaciones y recreaciones del contenedor:

| Volumen | Punto de montaje | Contenido |
| :--- | :--- | :--- |
| `dsh-data` | `/data` | `$DSH_HOME`: sesiones, perfiles, complementos, credenciales, ajustes |
| `dsh-workspace` | `/workspace` | El directorio en el que trabaja el agente y tus proyectos |

Comprueba el estado y los registros (deberías ver `Up (healthy)`):

```sh
docker compose ps
docker compose logs -f harness
```

¿Vas a desplegar en un NAS (Synology, Unraid, TrueNAS) o en un servidor sin cadena de compilación? Usa las plantillas de [deploy/nas/](deploy/nas/README.md) y carga una imagen precompilada. Las operaciones del día a día —copia de seguridad de `/data`, restauración, fijación de actualizaciones y reversión— están automatizadas en [deploy/operations/](deploy/operations/README.md).

## Configuración

Todos los parámetros son variables de entorno y están documentados en detalle en [.env.example](.env.example). Cópialo a `.env` y reinicia con `docker compose up -d`.

| Variable | Por defecto | Propósito |
| :--- | :--- | :--- |
| `DSH_HOST` | `0.0.0.0` | Interfaz de red a la que se enlaza el servidor dentro del contenedor. |
| `DSH_PORT` | `3080` | Puerto de escucha (Compose también lo publica). |
| `DSH_TRUSTED_HOSTS` | *(vacío)* | Lista separada por comas de nombres de host o IP con permiso para acceder a la interfaz web, por ejemplo `192.168.1.50,harness.lan`. Las peticiones con cualquier otro encabezado `Host` reciben 403. |
| `DSH_REVERSE_PROXY` | `false` | Ponlo en `true` detrás de Nginx/Caddy/Traefik o un túnel: el `X-Forwarded-Host` / `X-Forwarded-Proto` del proxy pasa a determinar la confianza y la autoridad de las cookies. |
| `DSH_AUTH_MODE` | `token` | `token`: el inicio de sesión exige `/?token=…`. `none`: sin token ni cookie; solo `DSH_TRUSTED_HOSTS` controla el acceso (ver más abajo). |
| `DSH_AUTH_TOKEN` | *(vacío)* | Token de inicio de sesión fijo que sustituye al token aleatorio de cada arranque, de modo que tu URL sobrevive a los reinicios. |
| `DEEPSEEK_API_KEY` | *(vacío)* | Clave del API de DeepSeek; también puede introducirse en la interfaz web. |
| `DSH_HOME` | `/data` | Raíz del estado duradero dentro del contenedor. |

Las variables `DSH_*` son configuración de arranque a nivel de proceso: Compose las inyecta de forma nativa y el cargador de entorno por capas las rechaza dentro de archivos `.env` del proyecto. Ponlas en el `.env` de la raíz del repositorio (o en el bloque `environment:` de Compose), nunca en `/workspace/.env`.

### Acceso por red local

Añade a `DSH_TRUSTED_HOSTS` todas las direcciones que los usuarios escriban en el navegador y reinicia:

```sh
DSH_TRUSTED_HOSTS=192.168.1.50,harness.lan docker compose up -d
```

Los hosts de esa lista también obtienen el panel de ajustes persistente en la interfaz web.

### Token de inicio de sesión

Por defecto, cada arranque genera un token aleatorio y anuncia `http://<host>:<puerto>/?token=…`, así que hay que buscarlo en los registros en cada reinicio. Dos formas de dejar de hacerlo:

```sh
# 1. Stable URL: set your own token once; the sign-in link never changes again.
DSH_AUTH_TOKEN=my-long-random-secret docker compose up -d
# open http://192.168.1.50:3080/?token=my-long-random-secret

# 2. No token at all: any host on the trust fence reaches the UI directly.
DSH_AUTH_MODE=none docker compose up -d
```

Con `DSH_AUTH_MODE=none`, la interfaz web —incluidas las herramientas de ejecución de código del agente— queda al alcance de cualquier máquina cuya dirección pase `DSH_TRUSTED_HOSTS`. Úsalo solo en redes que controles por completo; la barrera de confianza de Host/Origin (sección anterior) sigue activa en ambos casos, y la imagen Docker de este fork registra un aviso al arrancar cuando el modo está desactivado.

### Proxy inverso

Las configuraciones de referencia con terminación TLS, paso de WebSocket (`/api/remote.mux`), buffering desactivado para streaming y tiempos de espera largos están en [deploy/reverse-proxy/](deploy/reverse-proxy/README.md) para Nginx, Caddy, Traefik y Cloudflare Tunnel. Contrato mínimo para cualquier proxy:

1. Define `DSH_REVERSE_PROXY=true` y añade el nombre de host público a `DSH_TRUSTED_HOSTS`.
2. Reenvía `X-Forwarded-Host: $host` y `X-Forwarded-Proto: https` (en los proxies que terminan TLS).
3. Propaga los encabezados `Upgrade` / `Connection` y desactiva el buffering de respuestas.

<a id="telemetry-and-privacy"></a>

### Telemetría y privacidad

Nada sale de tu despliegue a menos que lo actives explícitamente. Cada canal de telemetría y cada contribución no relacionada con la inferencia en las peticiones al API oficial de DeepSeek están denegados por defecto, y no hay ninguna dirección de recopilador incorporada.

| Variable | Por defecto | Propósito |
| :--- | :--- | :--- |
| `DSH_TELEMETRY_ENABLED` | *(vacío)* | Activa los canales de OpenTelemetry. La telemetría de sesión necesita además `DSH_TELEMETRY_MODE=FEEDBACK_ONLY` y `DSH_TELEMETRY_OTLP_URL`; la analítica de producto de escritorio necesita además `DSH_PRODUCT_ANALYTICS_OTLP_URL`. |
| `DSH_TELEMETRY_MODE` | `DISABLED` | Política de compartición de la telemetría de sesión. `FEEDBACK_ONLY` libera el prefijo canónico de la sesión solo tras un nuevo comentario explícito; `FULL` se rechaza. |
| `DSH_TELEMETRY_OTLP_URL` | *(vacío)* | Endpoint de registros OTLP para la telemetría de sesión. Un modo de subida lo exige, y un proceso activado sin él falla al cargar. |
| `DSH_PRODUCT_ANALYTICS_OTLP_URL` | *(vacío)* | Endpoint de registros OTLP para la analítica de producto de escritorio. |
| `DSH_SESSION_LOG_UPLOAD` | *(vacío)* | Activa la incorporación del registro canónico de sesión a las peticiones al API oficial de DeepSeek. |
| `DSH_PLUGIN_INVENTORY_UPLOAD` | *(vacío)* | Activa la incorporación del inventario de complementos instalados a las peticiones al API oficial de DeepSeek. |
| `DSH_TELEMETRY_DISABLED` | *(vacío)* | Anula todas las activaciones anteriores. Cualquier valor no vacío deniega, incluidos `0` y `false`. |

La ruta de inferencia de DeepSeek no se ve afectada: las peticiones a `api.deepseek.com`, los encabezados de identidad del harness y `user-agent` se comportan igual con telemetría activada o desactivada.

## Actualización

```sh
./scripts/sync-upstream.sh --check
./scripts/sync-upstream.sh --merge
```

La herramienta de sincronización y su guía de resolución de conflictos están documentadas en [deploy/sync/README.md](deploy/sync/README.md). Antes de fusionar, fija un punto de reversión y haz copia de seguridad de tus datos; la fusión en sí nunca toca `/data`:

```sh
./deploy/operations/update-image.sh save
./deploy/operations/backup-data.sh --service
```

Recrea los contenedores después de compilar (`docker compose up -d --build`) y, si la nueva imagen se comporta mal, devuelve la etiqueta con `./deploy/operations/update-image.sh rollback`. Los procedimientos completos de actualización, copia de seguridad, restauración y reversión, junto con las plantillas de despliegue en NAS, están en [deploy/operations/README.md](deploy/operations/README.md).

<a id="running-from-source-no-docker"></a>

## Ejecución desde el código fuente (sin Docker)

Los mismos requisitos que upstream: Node.js ^22.19 o 24 y pnpm 11.

```sh
pnpm install
pnpm run build
DSH_HOST=0.0.0.0 DSH_TRUSTED_HOSTS=192.168.1.50 pnpm dsh web --no-open
```

`--host 0.0.0.0` imprime un aviso de seguridad y se enlaza a todas las interfaces; combínalo con `DSH_TRUSTED_HOSTS` para decidir quién puede conectarse.

## Solución de problemas

Lee primero el motivo del rechazo en los registros: cada 403 o 401 indica su causa exacta.

| Mensaje del registro | Causa | Solución |
| :--- | :--- | :--- |
| `untrusted host "…"`, `trustedHosts: (…)` | El encabezado `Host` no está en la lista de permitidos | Añade el host a `DSH_TRUSTED_HOSTS` y reinicia |
| `origin mismatch ("https://…" vs "http://…")` | TLS termina en el proxy pero no se reenvía `X-Forwarded-Proto` | Define `proxy_set_header X-Forwarded-Proto https;` |
| `session cookie authority mismatch` | La cookie se emitió para otro host o puerto | Vuelve a abrir la URL de arranque a través de la misma autoridad del proxy |
| `session cookie expired at …` | Pasaron los 30 días de vida de la cookie | Vuelve a abrir la URL que imprime `dsh web` para reautenticarte |

Comprobación de estado: el contenedor sondea `http://127.0.0.1:<puerto>/` y considera sanos los códigos 200, 303 y 401; un 401 es el desafío sin autenticar esperado y demuestra que el servidor HTTP y el runtime de Cordis están vivos.

## Estructura del repositorio (específica del fork)

```text
docker/                    Dockerfile, entrypoint, healthcheck, Cordis bind patch
docker-compose.yml         Production-ready orchestrator (uses .env)
.env.example               Exhaustive declarative configuration template
deploy/reverse-proxy/      Reference Nginx / Caddy / Traefik / Tunnel configs
deploy/nas/                Synology / Unraid / TrueNAS / server Compose templates
deploy/operations/         Backup, restore, update and rollback scripts and guide
deploy/sync/               Upstream sync runbook
scripts/sync-upstream.sh   Automated upstream merge with conflict simulation
.github/workflows/docker-publish.yml  Multi-arch image publishing to GHCR
deploy/lab/                Reproducible test lab (proxy scenarios, WebSockets, SSL)
```

Los directorios `packages/`, `apps/` y la documentación de upstream están sin modificar salvo por las funciones de hosts de confianza, proxy inverso y diagnóstico descritas arriba.

## Comunidad y soporte

- Envía comentarios o informes de errores a través de [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions). Los problemas específicos del fork van a [los issues de este repositorio](https://github.com/samuelrubiodev/deepseek-harness-community/issues).
- Añade el tema [`dsh-plugin`](https://github.com/topics/dsh-plugin) a tu repositorio de complementos para que sea más fácil de encontrar.
- Únete a la <a href="https://discord.gg/4MrtZUhpxg">comunidad de Discord de DeepSeek Harness</a>.

## Contribuir

Consulta [CONTRIBUTING.md](CONTRIBUTING.md).

## Desarrollo

Empieza por la [guía de desarrollo](docs/development.md) y la [documentación de arquitectura](docs/architecture.md).

`pnpm run dev:web` compila, sirve y recompila los paquetes de cliente al editar el código fuente en una sola terminal, y `make help` lista los objetivos de Make equivalentes para Web y Desktop; la sección de comandos de la aplicación de la guía es la dueña de la tabla completa.

Si eres un agente, sigue [AGENTS.md](AGENTS.md).

## Cita

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## Licencia

[MIT](LICENSE), igual que upstream. Avisos de terceros: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
