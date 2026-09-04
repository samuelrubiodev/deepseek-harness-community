# DeepSeek Harness Community Fork: Documento Maestro de Arquitectura, Auditoría, Estado y Hoja de Ruta

**Versión del documento**: 1.9 (Fases 0 a 10 Completadas con Éxito — Proyecto Finalizado)
**Fecha**: Septiembre 2026
**Repositorio local**: `/home/samuel/Documents/deepseek-harness` (Rama `master`)
**Remoto de Upstream**: `https://github.com/deepseek-ai/deepseek-harness.git`
**Remoto del Fork**: `https://github.com/samuelrubiodev/deepseek-harness-community`
**Versión de Upstream**: `0.1.3-alpha.1`
**Entorno de desarrollo**: Ubuntu sobre WSL2 en entorno portátil con Docker Engine 29.7.2 y Docker Compose v5.5.0

---

## ÍNDICE DE CONTENIDOS

1. [Visión, Filosofía y Reglas Fundamentales](#1-visión-filosofía-y-reglas-fundamentales)
2. [Metodología de Desarrollo en 10 Fases](#2-metodología-de-desarrollo-en-10-fases)
3. [FASE 0: Auditoría Completa del Código Fuente (Análisis en Profundidad)](#3-fase-0-auditoría-completa-del-código-fuente-análisis-en-profundidad)
   * 3.1 Estructura del Monorepo y Modelo Cordis
   * 3.2 El Enlace de Red (Binding) y el Bloqueo de 0.0.0.0
   * 3.3 El Modelo de Confianza (Trust Fence): Host, Origin y el Error 403
   * 3.4 Autenticación de Navegador: Tokens, Cookies y Autoridad
   * 3.5 La Frontera de Configuración en el Cliente: Desactivación de Settings
   * 3.6 Sistema de Configuración y Variables de Entorno (`loadLayeredEnv`)
   * 3.7 Persistencia y Home Paths (`DSH_HOME`)
   * 3.8 El Sistema de Plugins y Perfiles
4. [FASE 1: Reproducción Controlada en Entorno Docker WSL](#4-fase-1-reproducción-controlada-en-entorno-docker-wsl)
   * 4.1 Arquitectura del Laboratorio de Pruebas (`deploy/lab/`)
   * 4.2 Peculiaridades de Red en WSL2 / Docker
   * 4.3 Resultados Detallados de las 7 Pruebas Empíricas
5. [FASE 2: Docker Base Correcto y Reproducible (Implementación Actual)](#5-fase-2-docker-base-correcto-y-reproducible-implementación-actual)
   * 5.1 Arquitectura de Tres Capas: `/app`, `/data` y `/workspace`
   * 5.2 `docker/Dockerfile` (Compilación desacoplada de Git)
   * 5.3 `docker/entrypoint.sh` (Gestión de permisos y señales UNIX)
   * 5.4 `docker/healthcheck.sh` (Sonda HTTP no intrusiva)
   * 5.5 `docker/docker.patch.yml` (Enlace a 0.0.0.0 sin modificar upstream)
   * 5.6 `docker-compose.yml` (Orquestador principal)
   * 5.7 Pruebas de Salud y Persistencia Realizadas
6. [Hoja de Ruta Detallada de Fases Futuras (Fases 3 a 10)](#6-hoja-de-ruta-detallada-de-fases-futuras-fases-3-a-10)
   * 6.1 FASE 3: Modelo LAN / Host / Origin
   * 6.2 FASE 4: Configuración Declarativa por Variables de Entorno
   * 6.3 FASE 5: Plugins en Entornos Docker
   * 6.4 FASE 6: Diagnóstico y Observabilidad Estructurada
   * 6.5 FASE 7: Escenarios Avanzados de Reverse Proxy
   * 6.6 FASE 8: Sistema de Sincronización con Upstream
   * 6.7 FASE 9: Release Candidate y Validación Integral
   * 6.8 FASE 10: Despliegue en Producción y Operaciones
7. [Inventario de Archivos Creados y Modificados](#7-inventario-de-archivos-creados-y-modificados)
8. [Estado Final del Proyecto (Fases 0–10 Completadas)](#8-estado-final-del-proyecto-fases-010-completadas)

---

## 1. Visión, Filosofía y Reglas Fundamentales

### Objetivo General
DeepSeek Harness es un arnés de agentes avanzado modular basado en plugins sobre el framework Cordis. Sin embargo, su diseño original fue concebido principalmente para ejecuciones locales de escritorio (`127.0.0.1`), careciendo de una imagen Docker oficial y presentando múltiples barreras intencionadas que impiden el despliegue fluido en un servidor doméstico o en la red local (LAN).

Este fork busca crear una **distribución mantenible, robusta y amigable para autoservicio y despliegue doméstico/servidor**, resolviendo:
* El despliegue en un único paso con Docker (`docker compose up -d`).
* El acceso sin fricción desde IPs o dominios locales (LAN) sin errores 403 Forbidden.
* El soporte transparente de proxies inversos (Nginx, Caddy, Traefik, Cloudflare Tunnel, Dokploy) con SSL/HTTPS y WebSockets.
* La persistencia limpia de datos, sesiones y configuraciones.

### Reglas de Oro del Proyecto
1. **"Upstream primero, nuestros cambios después, y todos nuestros cambios deben estar documentados, aislados y justificados."**
2. **Mantenibilidad absoluta**: No bifurcar el proyecto rompiendo la compatibilidad con upstream. Debemos poder ejecutar periódicamente `git merge upstream/master` sin resolver cientos de conflictos en código reescrito.
3. **Prohibido tocar `node_modules`**: Ninguna solución puede basarse en parches manuales a `node_modules`. Todo debe residir en el código fuente, en la capa de composición de Cordis o en la infraestructura de contenedores.
4. **No debilitar la seguridad por atajos**: La solución a los errores 403 o 401 nunca es "desactivar la autenticación" o "permitir cualquier Host sin validar". La solución es dotar al sistema de mecanismos declarativos para que el administrador exprese de forma explícita qué hosts, dominios y proxies son confiables.
5. **Diferenciación estricta de afirmaciones**:
   * **HECHO**: Evidencia demostrada fehacientemente en el código fuente o mediante pruebas ejecutadas en consola.
   * **HIPÓTESIS**: Deducción técnica pendiente de verificación empírica.
   * **DECISIÓN PROPUESTA**: Acción técnica planificada para una fase concreta.

---

## 2. Metodología de Desarrollo en 10 Fases

El desarrollo se ejecuta estrictamente por fases secuenciales. Cada fase finaliza con una **parada obligatoria** para revisión del usuario antes de proceder a la siguiente:

```text
[FASE 0: Auditoría de Código]           --> COMPLETADA (Sin tocar código)
         │
[FASE 1: Reproducción de Fallos]       --> COMPLETADA (Laboratorio WSL/Docker)
         │
[FASE 2: Docker Base Reproducible]     --> COMPLETADA (Imagen base, volumes, healthcheck)
         │
[FASE 3: Modelo LAN / Host / Origin]   --> COMPLETADA (0.0.0.0, trustedHosts, reverseProxy)
         │
[FASE 4: Variables de Entorno]         --> COMPLETADA (DSH_HOST, DSH_PORT, .env.example)
         │
[FASE 5: Plugins en Docker]            --> COMPLETADA (packageManager, pnpm store)
         │
[FASE 6: Diagnóstico y Logging]        --> COMPLETADA (Logs estructurados 403/401 sin fugas)
         │
[FASE 7: Reverse Proxy Avanzado]       --> COMPLETADA (Nginx, Caddy, Traefik, WebSockets, SSL)
         │
[FASE 8: Actualizaciones Upstream]     --> COMPLETADA (scripts/sync-upstream.sh, upstream-tracking, deploy/sync/README.md)
         │
[FASE 9: Release Candidate]            --> COMPLETADA (Suite 17389 tests OK, labs 7/7, README bilingüe)
         │
[FASE 10: Producción y Operaciones]      --> COMPLETADA (plantillas NAS, backup/restore, rollback)
```

---

## 3. FASE 0: Auditoría Completa del Código Fuente (Análisis en Profundidad)

### 3.1 Estructura del Monorepo y Modelo Cordis
* **Gestor de paquetes**: PNPM v11.7.0 en modo monorepo workspaces.
* **Configuración de módulos**: ESM puro en todo el repositorio (`"type": "module"`). Las llamadas CLI desde código fuente usan la bandera `--import tsx/esm`.
* **Framework de composición**: **Cordis**. Cada capacidad es un servicio o plugin inyectable. Las composiciones se configuran mediante parches YAML jerárquicos (`cordis.patch.yml`).
* **Workspaces clave**:
  * `apps/cli`: Binario principal `dsh`. Punto de entrada en `apps/cli/src/bin.ts` -> `runProfile()`.
  * `apps/web`: Aplicación SPA cliente con React, Vite y Tailwind (`@deepseek-ai/dsh-web-frontend`).
  * `packages/host/webserver`: Servidor HTTP nativo sobre `node:http`.
  * `packages/client/connection`: Capa de transporte web RPC, middleware `/api`, trust fence y autenticación.
  * `packages/bundle/web-app`: Ensamblador del perfil web, cálculo de IPs de LAN y apertura de navegador.
  * `packages/boot/app-boot`: Arranque de aplicaciones, resolución de perfiles y carga de variables de entorno.
  * `packages/util/home-paths`: Resolución de rutas de datos de usuario `$DSH_HOME`.

### 3.2 El Enlace de Red (Binding) y el Bloqueo de 0.0.0.0
* **Capacidad técnica del servidor**:
  En `packages/host/webserver/src/index.ts` (líneas 125-131), el esquema Zod de configuración define:
  ```ts
  host: z.union([z.const('127.0.0.1'), z.const('0.0.0.0')]).required(),
  port: z.natural().max(65535).required()
  ```
  Por tanto, **el servidor HTTP subyacente soporta plenamente escuchar en `0.0.0.0`**.
* **El bloqueo en CLI**:
  En `packages/bundle/web-app/src/startup.ts` (líneas 74-76):
  ```ts
  if (options.host === '0.0.0.0') {
    program.error('error: --host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
  }
  ```
  Upstream introdujo este bloqueo explícito como medida temporal de seguridad, impidiendo que el usuario pueda usar `--host 0.0.0.0` desde la línea de comandos.

### 3.3 El Modelo de Confianza (Trust Fence): Host, Origin y el Error 403
En `packages/client/connection/src/api-request-trust.ts`, la función `isTrustedApiRequest(request, trustedHosts)` filtra cada petición HTTP que entra a `/api/`:

1. **Chequeo de la cabecera `Host`**:
   * Parsea la cabecera con WHATWG URL parser (`new URL('http://' + hostHeader)`).
   * Comprueba si es loopback (`isLoopbackHostname` valida: `127.0.0.1`, `::1`, `localhost`).
   * Si **no** es loopback, la autoridad debe figurar en la lista `trustedHosts`. Si no figura: **retorna false (HTTP 403 Forbidden)**.
2. **El error de cálculo en Docker (`resolveLanTrust`)**:
   En `packages/bundle/web-app/src/index.ts` (líneas 134-141):
   ```ts
   export function resolveLanTrust(bindHost: string, extra: readonly string[]): WebRuntimeValues {
     const lanAddresses = bindHost === ALL_INTERFACES_HOST
       ? Object.values(networkInterfaces()).flat()
         .filter((iface) => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
         .map(iface => iface.address)
       : []
     return { lanAddresses, trustedHosts: [...lanAddresses, ...extra] }
   }
   ```
   Dentro de un contenedor Docker, `os.networkInterfaces()` solo devuelve la interfaz virtual `eth0` del contenedor (habitualmente `172.17.0.x` o `172.18.0.x`). **La IP de la tarjeta de red del host físico (ej. `192.168.1.50`) y los nombres de dominio de la LAN nunca son detectados**.
   Como consecuencia, cualquier petición que un usuario envíe desde la red local con `Host: 192.168.1.50:3080` es rechazada inmediatamente con **HTTP 403 Forbidden**.
3. **Chequeo de la cabecera `Origin`**:
   ```ts
   new URL(origin).host === hostUrl.host
   ```
   Exige que la autoridad (`host:puerto`) del `Origin` coincida de manera exacta con la de `Host`. Cualquier alteración de puerto o protocolo (común tras reverse proxies con terminación SSL) provoca **HTTP 403 Forbidden**.
4. **Chequeo `Sec-Fetch-Site`**:
   Si el valor es `'cross-site'`, **retorna false (HTTP 403 Forbidden)**.

### 3.4 Autenticación de Navegador: Tokens, Cookies y Autoridad
En `packages/client/connection/src/browser-auth.ts`:
* Durante el arranque, el proceso genera un token criptográfico en memoria (`launchToken` de 32 bytes en base64url).
* La URL anunciada es `http://<host>:<port>/?token=<token>`.
* Cuando el navegador solicita esa URL:
  * Verifica la autoridad (`authority = requestAuthority(headers)`).
  * Genera una cookie firmada con HMAC-SHA256:
    * Nombre: `dsh-auth-${base64url(sha256(authority))}`
    * Payload: `{ version: 1, authority, issuedAt, expiresAt }`
    * Propiedades: `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`
  * Redirige con HTTP 303 a `/` limpio.
* En cada petición a `/api/`, el middleware busca la cookie que corresponde al hash de la autoridad `Host` de la petición.
* **Problema con Proxies**: Si el proxy reescribe el `Host` (ej. de `harness.midominio.com` a `harness:3080`), la cookie esperada cambia de nombre y de payload, resultando en **HTTP 401 Unauthorized**.

### 3.5 La Frontera de Configuración en el Cliente: Desactivación de Settings
* En `packages/client/connection/src/client/index.ts:228`:
  ```ts
  isLoopback: transport?.ownsHost === true || pageLocation === undefined || isLoopbackHostname(pageLocation.hostname)
  ```
* En `packages/client/ui-settings/src/client/index.ts:58`:
  ```ts
  const persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'
  ```
* En `packages/client/ui-settings/src/client/settings-mirror.ts:89`:
  ```ts
  status: persistence === 'host' ? 'idle' : 'unavailable'
  ```
* **Consecuencia**: Si el navegador no está en `localhost` o `127.0.0.1` (es decir, en cualquier acceso LAN o dominio), `isLoopback` es `false`, lo que pone el estado de configuración en `'unavailable'`, **deshabilitando permanentemente el panel de Ajustes en la interfaz web**.

### 3.6 Sistema de Configuración y Variables de Entorno (`loadLayeredEnv`)
En `packages/boot/app-boot/src/index.ts:158`:
* `loadLayeredEnv` carga archivos `.env` pero prohíbe terminantemente que contengan variables que comiencen por `DSH_` o variables de arranque como `DEEPSEEK_BASE_URL`. Si las encuentra, aborta el arranque con error.
* **Hecho**: Las variables `DSH_*` deben inyectarse exclusivamente a través del entorno de proceso (`process.env`), como variables del contenedor Docker.
* En upstream no existían variables para `HOST`, `PORT` o `TRUSTED_HOSTS`.

### 3.7 Persistencia y Home Paths (`DSH_HOME`)
En `packages/util/home-paths/src/index.ts`:
* La raíz de datos se define por `resolveDshHome()` (por defecto `~/.dsh` o la variable `DSH_HOME`).
* Subdirectorios:
  * `$DSH_HOME/profiles/`: Perfiles de Cordis, archivos `cordis.patch.yml`, `package.json` y `node_modules`.
  * `$DSH_HOME/sessions/`: Almacenamiento JSONL de sesiones de chat y comandos.
  * `$DSH_HOME/storages/`: Bases de datos locales de extensiones.
  * `$DSH_HOME/settings/`: Ajustes del usuario.
  * `$DSH_HOME/.credentials.yaml`: Credenciales cifradas del usuario.

### 3.8 El Sistema de Plugins y Perfiles
En `apps/cli/src/plugin.ts` y `packages/boot/app-boot/src/profile.ts`:
* Administra plugins ejecutando subprocesos de `pnpm add` en `$DSH_HOME/profiles/<perfil>`.
* Requiere que `pnpm` esté disponible en el PATH del sistema.
* Genera enlaces simbólicos (`healProfilesModuleFallback`) entre `$DSH_HOME/profiles/node_modules` y las dependencias base de la aplicación. En Docker, si el volumen de datos se desacopla o se monta sobre rutas distintas, estos symlinks se rompen.

---

## 4. FASE 1: Reproducción Controlada en Entorno Docker WSL

### 4.1 Arquitectura del Laboratorio de Pruebas (`deploy/lab/`)
Para demostrar empíricamente los problemas sin conjeturas, construimos un entorno aislado en `deploy/lab/`:
* `Dockerfile`: Imagen Node 24 slim con compilación completa.
* `docker-compose.yml`: Orquestador con dos contenedores en la misma red puente:
  * `dsh-lab-harness`: Contenedor con la aplicación.
  * `dsh-lab-proxy`: Contenedor Nginx (puerto 8080 con preservación de cabeceras, puerto 8081 con reescritura de Host).
* `nginx.conf`: Configuración del reverse proxy.
* `bind-all.patch.yml`: Parche Cordis para sortear el bloqueo de CLI y enlazar a `0.0.0.0`.
* `test-repro.sh`: Script ejecutable de pruebas automatizadas.

### 4.2 Peculiaridades de Red en WSL2 / Docker
* Durante la compilación de la imagen en WSL2, el resolver DNS predeterminado de WSL (`10.255.255.254`) provocó cuelgues en `apt-get` dentro de contenedores puente (`Temporary failure resolving deb.debian.org`).
* **Solución técnica**: Se configuró `network: host` y DNS explícito `[8.8.8.8, 1.1.1.1]` durante la fase de compilación en Docker Compose, resolviendo inmediatamente la conectividad.
* Se detectó que el script de compilación `scripts/build.ts` exigía Git (`git rev-parse HEAD`). Se resolvió declarando el argumento de compilación `ARG DSH_CLIENT_COMMIT_HASH=0000000`, permitiendo compilar en contenedores sin incluir el pesado directorio `.git`.

### 4.3 Resultados Detallados de las 7 Pruebas Empíricas
Al ejecutar `./deploy/lab/test-repro.sh` se obtuvieron los siguientes resultados demostrados:

| Nº | Escenario | Entrada / Configuración | Comportamiento Observado | Diagnóstico |
| :---: | :--- | :--- | :--- | :--- |
| **1** | Bloqueo CLI 0.0.0.0 | `dsh web --host 0.0.0.0` | Código de salida 1: `error: --host 0.0.0.0 is intentionally not supported yet for safety...` | Bloqueo artificial intencionado en `startup.ts`. |
| **2** | Localhost Directo | Petición a `127.0.0.1:3080` con token | HTTP 401 sin token -> HTTP 303 con token y `Set-Cookie` -> HTTP 404 en `/api` (petición aceptada). | En loopback puro el sistema funciona como se concibió. |
| **3** | LAN IP / Hostname | `Host: 192.168.1.50:3080` o `Host: harness.lan:3080` | **HTTP 403 Forbidden (`forbidden`)** | `resolveLanTrust` en Docker solo confió en `172.18.0.2` (IP interna del contenedor). |
| **4** | Desajuste Origin | `Origin: http://harness.lan` con `Host: 127.0.0.1:3080` | **HTTP 403 Forbidden** | `isTrustedApiRequest` rechaza orígenes que no coincidan idénticamente con Host. |
| **5** | Reverse Proxy | Reescritura de Host en puerto 8081 | **HTTP 401 Unauthorized / HTTP 403** | La cookie `dsh-auth-<hash>` queda atada a la autoridad reescrita y no a la externa. |
| **6** | Settings UI | Cliente conectando desde IP no loopback | `persistence = 'memory'`, `status = 'unavailable'` | La interfaz web desactiva permanentemente el panel de ajustes para clientes remotos. |
| **7** | Plugins en Docker | `dsh plugin --profile web list` | Intenta invocar Corepack/pnpm dinámicamente | Fricción en contenedores inmutables sin dependencias de compilación en caliente. |

---

## 5. FASE 2: Docker Base Correcto y Reproducible (Implementación Actual)

En la Fase 2 se construyó la base Docker oficial sin alterar ningún archivo del core de upstream, alcanzando una experiencia limpia y reproducible para el usuario.

### 5.1 Arquitectura de Tres Capas
* `/app` (Inmutable): Código fuente, dependencias compiladas (`node_modules`), artefactos generados (`apps/cli/lib`, `apps/web/dist`, `packages/*/lib`).
* `/data` (Persistente): Directorio de usuario `$DSH_HOME`. Gestionado mediante el volumen Docker `dsh-data`.
* `/workspace` (Espacio de trabajo): Directorio de trabajo del agente y de proyectos del usuario. Gestionado mediante el volumen Docker `dsh-workspace`.

### 5.2 `docker/Dockerfile`
* Basado en `node:24-bookworm-slim`.
* Dependencias del sistema: `git`, `ca-certificates`, `curl`.
* Habilitación de `corepack` para fijar `pnpm@11.7.0`.
* Inyección de `ARG DSH_CLIENT_COMMIT_HASH=0000000` para compilaciones autónomas.
* Enlace global de la CLI: `ln -sf /app/apps/cli/lib/bin.js /usr/local/bin/dsh`.
* Declaración de volúmenes: `VOLUME ["/data", "/workspace"]`.
* Puerto expuesto: `EXPOSE 3080`.
* Configuración de directorio seguro para git: `git config --system --add safe.directory '*'`.
* Creación de `/data`, `/workspace` y `/home/node/.cache` asignados al usuario sin privilegios `node:node` (UID:GID 1000:1000) con permisos `775`.
* Ejecución segura no-root: Directiva `USER node` por defecto (principio de mínimo privilegio).
* Instrucción de salud integrada ejecutada como usuario `node`:
  ```dockerfile
  HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
      CMD /app/docker/healthcheck.sh
  ```
* Directorio de trabajo: `WORKDIR /workspace`.
* Punto de entrada: `ENTRYPOINT ["/app/docker/entrypoint.sh"]`.

### 5.3 `docker/entrypoint.sh`
* Asegura `/data` y `/workspace` y comprueba permisos de escritura para el usuario activo:
  - Falla de forma temprana con mensaje claro y accionable si `/data` no tiene permisos de escritura (evitando errores silenciosos en montajes de host).
  - Emite una advertencia de seguridad si se detecta ejecución explícita como `root` (UID 0).
* Imprime logs informativos claros identificando el usuario y UID/GID:
  ```text
  [dsh-docker] Starting DeepSeek Harness...
  [dsh-docker] USER=node (1000:1000)
  [dsh-docker] DSH_HOME=/data
  [dsh-docker] WORKSPACE=/workspace
  ```
* Si no se pasan argumentos, arranca automáticamente `dsh web` aplicando el parche `/app/docker/docker.patch.yml`.
* Utiliza `exec` para asegurar que las señales de parada (`SIGTERM`, `SIGINT`) se propaguen directamente al proceso Node para un apagado ordenado.

### 5.4 `docker/healthcheck.sh`
* Ejecuta un sondeo HTTP no destructivo:
  ```bash
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 5 "http://127.0.0.1:${PORT:-3080}/" 2>/dev/null || echo "000")
  ```
* Si el código es `401` (desafío de autenticación de Harness), `200` o `303`, retorna `0` (exitoso). Esto confirma de forma infalible que el servidor HTTP y el runtime de Cordis están respondiendo activamente.

### 5.5 `docker/docker.patch.yml`
Parche de composición de Cordis aplicado en el arranque para enlazar el servidor web a `0.0.0.0` dentro del contenedor sin alterar el código de upstream:
```yaml
- id: webserver
  config:
    host: 0.0.0.0
    port: 3080
```

### 5.6 `docker-compose.yml` (Raíz del Repositorio)
Orquestador de producción listo para usar:
```yaml
services:
  harness:
    build:
      context: .
      dockerfile: docker/Dockerfile
      network: host
    image: deepseek-harness:latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "3080:3080"
    environment:
      - NODE_ENV=production
      - DSH_HOME=/data
      - WORKSPACE_DIR=/workspace
      - PORT=3080
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
    volumes:
      - dsh-data:/data
      - dsh-workspace:/workspace
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  dsh-data:
  dsh-workspace:
```

### 5.7 Pruebas de Salud y Persistencia Realizadas
1. **Compilación limpia**: `docker compose build` compila la imagen en ~90 segundos sin advertencias ni fallos.
2. **Arranque y Healthcheck**: `docker compose up -d` arranca en menos de 5 segundos. `docker compose ps` reporta `Up 7 seconds (healthy)`.
3. **Persistencia demostrada**:
   * Se crearon archivos testigo `/data/persistence_witness.txt` y `/workspace/project_file.txt`.
   * Se destruyó el contenedor con `docker compose down`.
   * Se recreó el contenedor con `docker compose up -d`.
   * Se verificó que ambos archivos permanecieron intactos.
   * Se comprobó que las credenciales generadas (`/data/.credentials.yaml`) y el ID anónimo persistieron sin cambios.

---

## 6. Hoja de Ruta Detallada de Fases Futuras (Fases 3 a 10)

Esta sección documentaba las tareas de cada fase. **Las Fases 3 a 10 están completadas y validadas**.

---

### 6.1 FASE 3: Modelo LAN / Host / Origin (COMPLETADA CON ÉXITO)
* **Objetivo**: Permitir el acceso seguro desde la red local (IPs y hostnames) y a través de reverse proxies sin recibir HTTP 403 Forbidden ni 401 por desajuste de autoridad, y desbloquear la pantalla de ajustes para administradores remotos / de red local.
* **Estado**: **100% IMPLEMENTADA Y VALIDADA**.
* **Cambios en código implementados**:
  1. **Eliminación del bloqueo de `0.0.0.0`**:
     * Archivo: `packages/bundle/web-app/src/startup.ts`.
     * Cambio: Sustituido `program.error(...)` por `console.warn(...)` cuando `--host 0.0.0.0` se especifica. El CLI acepta el comando, emite la advertencia de seguridad requerida y provee los valores de arranque correspondientes.
     * Pruebas actualizadas en `packages/bundle/web-app/tests/startup.spec.ts`.
  2. **Alimentación declarativa de `trustedHosts`**:
     * Archivo: `packages/bundle/web-app/src/index.ts` (`resolveLanTrust`).
     * Cambio: Se incorpora la variable de entorno `process.env.DSH_TRUSTED_HOSTS` (separada por comas) y se unifica de forma deduplicada (`Set`) con las interfaces físicas no internas de la máquina y las opciones CLI `--trusted-host`. Asimismo, `announceReady` usa el primer `trustedHost` como fallback para la URL LAN cuando se enlaza en contenedores donde las interfaces locales son solo internas.
     * Pruebas añadidas en `packages/bundle/web-app/tests/trusted-hosts.spec.ts`.
  3. **Normalización de `Origin` y soporte de Reverse Proxy**:
     * Archivos: `packages/client/connection/src/api-request-trust.ts`, `packages/client/connection/src/browser-auth.ts`, `packages/client/connection/src/rpc-host.ts`, `packages/client/connection/src/index.ts`.
     * Cambio:
       - Incorporación de la opción `reverseProxy?: boolean` y variable de entorno `DSH_REVERSE_PROXY=true/1`.
       - En `isTrustedApiRequest`: Cuando `reverseProxy` está activo, se extrae la autoridad del primer segmento de `X-Forwarded-Host` y el protocolo de `X-Forwarded-Proto`, validando contra `trustedHosts` y normalizando `Origin` contra la autoridad efectiva (resolviendo el fallo 403 con terminación TLS o proxies intermedios).
       - En `BrowserAuth`: `requestAuthority` respeta `X-Forwarded-Host` y `X-Forwarded-Proto` bajo modo `reverseProxy`, permitiendo que el intercambio de tokens (`/?token=...`) y la verificación de cookies firmadas HMAC-SHA256 se sincronicen con la autoridad del proxy (resolviendo el fallo 401).
     * Pruebas añadidas en `packages/client/connection/tests/api-request-trust.host.spec.ts` y `packages/client/connection/tests/browser-auth.host.spec.ts`.
  4. **Desbloqueo de la UI de Settings para accesos LAN / Hostnames Confiables**:
     * Archivos: `packages/client/connection/src/index.ts` (host) y `packages/client/connection/src/client/index.ts` (browser).
     * Cambio:
       - El plugin host de conexión inyecta la lista autorizada en la plantilla HTML mediante el listener `'webserver/index-inject'`, registrando `{ kind: 'global', name: '__DSH_TRUSTED_HOSTS__', value: trustedHosts }`.
       - El runtime del navegador en `connection/client/index.ts` evalúa `isAuthorizedHost(hostname, trustedHosts)`: si la página se está sirviendo desde loopback O desde un host confiable declarado, `ConnectionHandle.isLoopback` se resuelve a `true`.
       - En consecuencia, `ui-settings` asigna `persistence = 'host'`, activando por completo el panel de Ajustes y el almacenamiento durable para clientes autorizados.
     * Pruebas añadidas en `packages/client/connection/tests/client-apply.client.spec.ts`.
* **Métricas de Calidad y Validación**:
  - `pnpm exec vitest run packages/bundle/web-app packages/client/connection`: **17 suites, 160 tests PASADOS (100%)**.
  - `pnpm exec vitest run packages/client/ui-settings packages/client/ui-settings-general`: **25 suites, 445 tests PASADOS (100%)**.
  - `pnpm run lint` (`build:lib:host` + `run-oxlint.ts`): **2990 ficheros analizados, 0 errores, 0 advertencias**.
  - `git diff --check`: **Sin errores de espacios en blanco ni sintaxis**.

---

### 6.2 FASE 4: Configuración Declarativa por Variables de Entorno (COMPLETADA CON ÉXITO)
* **Objetivo**: Estandarizar la configuración del contenedor y del servidor mediante variables de entorno limpias, documentadas y compatibles con la arquitectura de capas de DeepSeek Harness.
* **Estado**: **100% IMPLEMENTADA Y VALIDADA**.
* **Cambios implementados**:
  1. **Soporte nativo de `DSH_HOST` y `DSH_PORT` en el CLI**:
     * Archivo: `packages/bundle/web-app/src/startup.ts`.
     * Implementación: `web-startup` evalúa `options.host ?? process.env.DSH_HOST` y `options.port ?? process.env.DSH_PORT ?? process.env.PORT`. Esto permite que un despliegue Docker o servidor sin argumentos CLI aplique inmediatamente el host y puerto declarados, respetando en todo momento la precedencia de los flags de línea de comandos si se especifican.
     * Pruebas añadidas en `packages/bundle/web-app/tests/startup.spec.ts` (10 tests pasando, cubriendo lectura de variables, sobreescritura por CLI y validación numérica).
  2. **Plantilla exhaustiva de variables de entorno (`.env.example`)**:
     * Archivo creado: `.env.example` en la raíz del repositorio.
     * Contenido: Documentación completa de las 5 secciones de configuración (`DSH_HOST`, `DSH_PORT`, `DSH_TRUSTED_HOSTS`, `DSH_REVERSE_PROXY`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DSH_HOME`, `WORKSPACE_DIR`).
     * Explicación arquitectónica clara de la regla de seguridad de `loadLayeredEnv` (evitando que variables bootstrap se intenten cargar desde `.env` en directorios de proyectos internos y promoviendo la inyección a nivel de proceso vía Docker).
  3. **Actualización del Entrypoint de Docker**:
     * Archivo: `docker/entrypoint.sh`.
     * Implementación: Exporta las variables por defecto (`DSH_HOST=0.0.0.0`, `DSH_PORT=3080`), emite diagnósticos limpios en el log del contenedor al arrancar (`BIND=...`, `DSH_TRUSTED_HOSTS=...`, `DSH_REVERSE_PROXY=enabled`) e invoca `dsh web --no-open` directamente sin requerir de forma obligatoria un parche `docker.patch.yml`.
  4. **Sincronización con Docker Compose**:
     * Archivo: `docker-compose.yml`.
     * Implementación: Vincula `env_file: .env` (opcional, no bloqueante si no existe), mapea el puerto dinámicamente con `${DSH_PORT:-3080}` y propaga todas las variables declarativas al contenedor.
* **Métricas de Calidad y Validación**:
  - `pnpm exec vitest run packages/bundle/web-app`: **4 suites, 27 tests PASADOS (100%)**.
  - Compilación TypeScript de `packages/bundle/web-app`: **0 errores**.

---

### 6.3 FASE 5: Plugins en Entornos Docker (COMPLETADA CON ÉXITO)
* **Objetivo**: Permitir que el ecosistema de plugins y herramientas de DeepSeek Harness funcione de forma fiable dentro de un contenedor sin depender de descargas frágiles en caliente ni sufrir bloqueos por Corepack.
* **Estado**: **100% IMPLEMENTADA Y VALIDADA**.
* **Diagnóstico Empírico del Fallo**:
  - Al ejecutar `dsh plugin --profile web list` en Docker, el subproceso `pnpm` arrojaba un error de Corepack: `Error when performing the request to https://registry.npmjs.org/pnpm/latest` con `ConnectTimeoutError: Connect Timeout Error`.
  - Causa raíz: `initProfile` generaba un `package.json` sin el campo `packageManager`. En ausencia de este campo, Corepack intenta consultar de forma síncrona el registro de npm en busca de la versión más reciente, bloqueando y fallando en entornos offline o con resolución DNS restringida en contenedores.
* **Cambios implementados**:
  1. **Declaración explícita de `packageManager` en la inicialización del perfil**:
     * Archivo: `packages/boot/app-boot/src/profile.ts`.
     * Cambio: Se añadió `packageManager?: string` a la interfaz `ProfileManifest` y se configuró `packageManager: 'pnpm@11.7.0'` en el manifiesto inicial creado por `initProfile`.
  2. **Backfill automático y prevención de prompts en `runPlugin`**:
     * Archivo: `apps/cli/src/plugin.ts`.
     * Cambio: Si un perfil ya existente en disco carece de `packageManager`, `runPlugin` lo actualiza automáticamente a `pnpm@11.7.0` antes de invocar el subproceso. Se inyecta `COREPACK_ENABLE_DOWNLOAD_PROMPT: '0'` en las variables de entorno de ejecución de `spawnSync`.
     * Pruebas añadidas: `apps/cli/tests/plugin.spec.ts` (verificando la inicialización con `packageManager`, el backfill en perfiles heredados y la propagación de entorno).
  3. **Preinstalación global desacoplada en Dockerfile**:
     * Archivo: `docker/Dockerfile`.
     * Cambio: Se incorporó `RUN npm install -g pnpm@11.7.0 && corepack enable && corepack prepare pnpm@11.7.0 --activate`, garantizando que el binario de `pnpm` esté preinstalado en el contenedor de forma nativa e inmutable, sin depender de descargas en caliente en runtime.
  4. **Caché persistente de paquetes en volumen de datos**:
     * Archivo: `docker/entrypoint.sh`.
     * Cambio: Se configuró `export PNPM_HOME="${DSH_HOME:-/data}/.pnpm"`, `export PATH="$PNPM_HOME:$PATH"` y `export npm_config_store_dir="${DSH_HOME:-/data}/.pnpm-store"`. Cualquier paquete instalado por el usuario persiste en el volumen `/data` y sobrevive a la recreación del contenedor.
* **Métricas de Calidad y Validación**:
  - Demostración en contenedor real: `docker run --rm deepseek-harness:latest dsh plugin --profile web list` ejecutado con éxito inmediato (código de salida 0, sin cuelgues ni accesos externos a red).
  - Tests de `app-boot` y `apps/cli`: **8 suites, 136 tests PASADOS (100%)**.
  - Linter (`oxlint`): **2991 archivos analizados, 0 errores, 0 advertencias**.

---

### 6.4 FASE 6: Diagnóstico y Observabilidad Estructurada (COMPLETADA CON ÉXITO)
* **Objetivo**: Que ante cualquier fallo de conexión o autenticación, los logs expliquen con exactitud qué ha fallado sin comprometer la seguridad ni filtrar credenciales.
* **Estado**: **100% IMPLEMENTADA Y VALIDADA**.
* **Cambios implementados**:
  1. **Instrumentación y diagnóstico detallado de `isTrustedApiRequest` (HTTP 403)**:
     * Archivo: `packages/client/connection/src/api-request-trust.ts`.
     * Cambio:
       - Se introdujo el tipo `ApiRequestTrustResult = { trusted: true } | { trusted: false, reason: string }`.
       - Se implementó la función `evaluateApiRequestTrust(request, trustedHosts, options): ApiRequestTrustResult` que diagnostica con precisión quirúrgica el motivo del rechazo:
         * `missing Host header` (cabecera Host ausente).
         * `unparseable Host header "<host>"` (Host con formato sintáctico inválido).
         * `untrusted host "<host>" (<trustedHosts>)` (Host no confiable, indicando los hosts declarados o su ausencia).
         * `Sec-Fetch-Site is "cross-site"` (solicitud cross-site rechazada).
         * `unparseable Origin header "<origin>"` (Origin con sintaxis URL inválida).
         * `origin mismatch ("<origin>" vs "<host>")` (desajuste de autoridad entre Origin y Host/X-Forwarded-Host).
       - `TrustedApiRequestOptions` se amplió con `onReject?: (reason: string) => void` y `logger?: { warn: ... }`.
       - `isTrustedApiRequest` delega en `evaluateApiRequestTrust` y emite diagnósticos cuando se proporciona un callback o logger.
     * Pruebas añadidas: `packages/client/connection/tests/api-request-trust.host.spec.ts` (cubriendo los 7 motivos de rechazo, `onReject` y advertencias de log).
  2. **Instrumentación y diagnóstico detallado de `BrowserAuth` (HTTP 401)**:
     * Archivo: `packages/client/connection/src/browser-auth.ts`.
     * Cambio:
       - Se introdujo `BrowserAuthResult = { authenticated: true } | { authenticated: false, reason: string }` e interfaz `BrowserAuthLogger`.
       - Se implementó `BrowserAuth.authenticate(request): BrowserAuthResult` diagnosticando el motivo exacto:
         * `missing or unparseable request authority (Host)`.
         * `missing Cookie header for authority "<authority>"`.
         * `missing session cookie for authority "<authority>"`.
         * `invalid or unparseable session cookie signature for authority "<authority>"`.
         * `session cookie authority mismatch ("<cookieAuthority>" vs "<requestAuthority>")`.
         * `session cookie expired at <fecha> (now: <fecha>)`.
         * `session cookie issued in the future (issuedAt: ..., now: ...)`.
         * `session cookie has invalid lifetime bounds`.
       - `isAuthenticated(request)` delega transparentemente en `this.authenticate(request).authenticated`.
       - `authorizeIndex` evalúa diagnósticos ante tokens erróneos (`invalid launch token`, `multiple launch tokens provided in query`, `method "<method>" is not GET`, `pathname "<path>" is not root (/)`) o falta de cookie, emitiendo warnings estructurados mediante `this.logger?.warn(...)`.
     * Pruebas añadidas: `packages/client/connection/tests/browser-auth.host.spec.ts` (cubriendo todos los motivos diagnósticos, control temporal de expiración y verificación estricta de que tokens y firmas nunca se imprimen).
  3. **Integración con el Gateway RPC y el Logger de Cordis**:
     * Archivo: `packages/client/connection/src/rpc-host.ts`.
     * Cambio: En `HostConnectionService.requestRejection`:
       - Si `evaluateApiRequestTrust` falla, emite `this.ctx.logger.warn('client-connection: API request rejected (403): <reason>')` y retorna 403.
       - Si `this.browserAuth.authenticate` falla, emite `this.ctx.logger.warn('client-connection: API request rejected (401): <reason>')` y retorna 401.
     * Archivo: `packages/client/connection/src/index.ts`:
       - Se inyecta `ctx.logger` en `BrowserAuth.create(...)`.
       - Se exportan `evaluateApiRequestTrust`, `BrowserAuth`, `ApiRequestTrustResult`, `BrowserAuthResult` y `BrowserAuthLogger`.
     * Pruebas añadidas: `packages/client/connection/tests/node-half.host.spec.ts` (verificando mediante espías que `ctx.logger.warn` emite las advertencias correspondientes en 403 y 401).
  4. **Seguridad Estricta Garantizada**:
     * Los valores de tokens de inicialización (`launchToken`), tokens de query (`/?token=...`), secretos de cifrado y firmas HMAC de cookies **NUNCA** se incluyen en los logs bajo ninguna circunstancia.
     * Los mensajes de log contienen únicamente descriptores autoritativos (`Host`, `Origin`, expiraciones de tiempo), otorgando al administrador información 100% accionable para depurar proxies y accesos LAN sin comprometer la seguridad del sistema.
* **Métricas de Calidad y Validación**:
  - `pnpm exec vitest run packages/client/connection`: **13 suites, 140 tests PASADOS (100%)**.
  - `pnpm exec vitest run packages/bundle/web-app packages/boot/app-boot`: **11 suites, 161 tests PASADOS (100%)**.
  - `npm run build:lib:host`: **Compilación TypeScript sin errores**.
  - `pnpm run lint:contracts-ready`: **2991 ficheros analizados con oxlint, 0 errores, 0 advertencias**.
  - `pnpm run test:docs`: **15 checks de documentación pasados con éxito**.
  - `scripts/verify-export-jsdoc.ts`: **100% de símbolos exportados documentados**.

---

### 6.5 FASE 7: Escenarios Avanzados de Reverse Proxy (COMPLETADA CON ÉXITO)
* **Objetivo**: Validar el funcionamiento en despliegues reales con servidores web de terminación TLS, streaming bidireccional mediante WebSockets y empaquetar configuraciones de referencia.
* **Estado**: **100% IMPLEMENTADA Y VALIDADA**.
* **Hitos y Entregables Cumplidos**:
  1. **Configuración y Validación en Laboratorio de Nginx con SSL y WebSockets**:
     * Archivo: `deploy/lab/nginx.conf`.
     * Se configuró el puerto `8443` con terminación TLS autofirmada (`/etc/nginx/ssl/cert.pem` con SAN para `localhost`, `harness.lan` y `127.0.0.1`).
     * Se configuró el mapeo dinámico de cabeceras de actualización `map $http_upgrade $connection_upgrade`.
     * Se verificó la propagación obligatoria de `proxy_set_header X-Forwarded-Proto https` y `proxy_set_header X-Forwarded-Host $host:$server_port`.
     * Se ampliaron los timeouts (`proxy_read_timeout 86400s; proxy_send_timeout 86400s`) y se desactivó el buffer (`proxy_buffering off`) para streaming en vivo de tokens LLM.
  2. **Configuración y Validación en Laboratorio de Caddy con TLS y HTTP/2**:
     * Archivo: `deploy/lab/Caddyfile`.
     * Se configuró el servicio `proxy-caddy` con imagen oficial `caddy:alpine` en el puerto `8444`.
     * Se utilizó `tls internal` para emisión automática de certificados en memoria.
     * Caddy negocia HTTP/2 con el navegador, termina TLS, reenvía WebSockets de forma transparente y propaga `X-Forwarded-Proto` y `X-Forwarded-Host`.
  3. **Verificación de Conexiones Persistentes WebSockets (`/api/remote.mux`)**:
     * Se verificó mediante handshake HTTP Upgrade que la ruta de streaming bidireccional `/api/remote.mux` responde `HTTP/1.1 101 Switching Protocols` tanto a través de Nginx como a través de Caddy.
     * Se comprobó que peticiones de actualización no autenticadas son rechazadas de inmediato con `401 Unauthorized` por `rejectRemoteStreamUpgrade`.
  4. **Suite de Automatización del Laboratorio (`deploy/lab/test-proxy.sh`)**:
     * Suite de pruebas automatizada de 7 pasos que valida de extremo a extremo:
       1. Acceso directo backend (401 esperado).
       2. Reverse Proxy Nginx HTTP (303 intercambio de token y 404 en `/api/`).
       3. Reverse Proxy Nginx HTTPS con SSL (303 intercambio de token y 404 en `/api/` con TLS).
       4. Reverse Proxy Caddy HTTPS con TLS interno (303 intercambio de token y 404 en `/api/` con HTTP/2).
       5. WebSocket Upgrade exitoso en Nginx SSL (`HTTP 101 Switching Protocols`).
       6. WebSocket Upgrade exitoso en Caddy TLS (`HTTP 101 Switching Protocols`).
       7. Rechazo de host no confiable (HTTP 403) y verificación del diagnóstico estructurado en logs.
     * Resultado: **7/7 PRUEBAS PASADAS CON ÉXITO (100%)**.
  5. **Configuraciones de Referencia para Producción (`deploy/reverse-proxy/`)**:
     * `deploy/reverse-proxy/nginx.conf`: Configuración completa de Nginx para producción con redirección HTTP->HTTPS, buffers optimizados para streaming LLM, límite de subida de 300MB y WebSockets.
     * `deploy/reverse-proxy/Caddyfile`: Configuración limpia para Caddy con Let's Encrypt o red local, `flush_interval -1` y proxy reverso.
     * `deploy/reverse-proxy/docker-compose.traefik.yml`: Despliegue completo con Traefik v3, labels de autodescubrimiento, certificados ACME automáticos y middleware de cabeceras.
     * `deploy/reverse-proxy/README.md`: Guía de arquitectura, explicación de variables (`DSH_REVERSE_PROXY`, `DSH_TRUSTED_HOSTS`), consideraciones de buffers y guía de resolución de problemas.
* **Métricas de Calidad y Validación**:
  - `deploy/lab/test-proxy.sh`: **7/7 tests PASADOS**.
  - `pnpm exec vitest run packages/client/connection`: **13 suites, 140 tests PASADOS**.
  - `pnpm run lint:contracts-ready`: **2991 ficheros analizados con oxlint, 0 errores, 0 advertencias**.
  - `pnpm run test:docs`: **15 checks de documentación pasados con éxito**.

---

### 6.6 FASE 8: Sistema de Sincronización con Upstream (COMPLETADA CON ÉXITO / COMPLETED SUCCESSFULLY)
* **Objetivo / Goal**: Establish a sustainable, production-grade maintenance and synchronization workflow to seamlessly integrate upstream improvements, features, and security patches from the official DeepSeek Harness repository into the community fork.
* **Estado / Status**: **100% IMPLEMENTADA Y VALIDADA / 100% IMPLEMENTED AND VALIDATED**.
* **Entregables e Hitos Cumplidos / Deliverables and Completed Milestones**:
  1. **Automated Synchronization Tool (`scripts/sync-upstream.sh`)**:
     * Implemented executable shell script with full POSIX/Bash strictness (`set -euo pipefail`).
     * Supports multi-mode operations:
       - `--check` / `--dry-run`: Inspects upstream divergence, displays incoming commit logs, and executes an in-memory conflict simulation without mutating working files.
       - `--merge`: Fetches upstream, atomically fast-forwards `upstream-tracking`, checks out the target branch, and executes `git merge --no-ff` with a standardized audit commit message.
       - `--fetch-only`: Synchronizes the local tracking branch with upstream while leaving working branches untouched.
       - `--run-checks`: Automatically runs the post-merge regression suite (`pnpm install`, vitest, oxlint, doc gates).
     * Modern conflict simulation using `git merge-tree --write-tree`: predicts whether a merge will be clean or produce conflicts prior to applying any changes.
     * Comprehensive error handling and user guidance when conflicts occur, detailing community-owned files (`docker/`, `deploy/`, community additions in `packages/bundle/web-app`, `packages/client/connection`, `packages/boot/app-boot`, `apps/cli`) versus upstream files, with instructions to abort (`git merge --abort`) or commit.
  2. **Branching Architecture and Tracking Topology**:
     * Structured three-tier branch hierarchy:
       - `upstream/master`: Official remote authority (`deepseek-ai/deepseek-harness.git`).
       - `upstream-tracking`: Pristine local mirror tracking `upstream/master` verbatim (never carries local commits or manual edits).
       - `master`: Main community fork branch incorporating deployment and networking features.
     * Atomic fast-forwarding using `git update-ref refs/heads/upstream-tracking refs/remotes/upstream/master` without needing to switch active working branches.
  3. **Comprehensive Operational Runbook (`deploy/sync/README.md`)**:
     * Created complete English technical guide covering:
       - Upstream-first core philosophy and minimal blast radius.
       - Branch topology diagram and remotes configuration.
       - Command reference for automated tool and step-by-step manual git workflow.
       - Conflict resolution matrix identifying fork-owned files and invariants.
       - Post-synchronization verification checklist.
       - Multi-level rollback procedures (in-progress abort, commit reset, container rollback).
  4. **Documentation System and Gate Exclusions**:
     * Registered `deploy/sync/README.md` in `scripts/translation-pairing.manifest.json`.
     * Verified that all upstream documentation gates (`pnpm run test:docs`) pass 15/15 checks with 0 errors.
* **Métricas de Calidad y Validación / Quality Metrics and Validation**:
  - `scripts/sync-upstream.sh --check --force`: **Exit code 0 (clean dry-run simulation, 0 conflicts detected)**.
  - `scripts/sync-upstream.sh --merge --force`: **Exit code 0 (verified up-to-date validation)**.
  - `pnpm exec vitest run packages/bundle/web-app packages/client/connection packages/boot/app-boot apps/cli/tests/plugin.spec.ts`: **25 suites, 303 tests PASSED (100%)**.
  - `pnpm run lint:contracts-ready`: **2991 files analyzed with oxlint, 0 errors, 0 warnings (100%)**.
  - `pnpm run test:docs`: **15 passed, 0 failed, 0 skipped (100%)**.
  - `git diff --check`: **Clean whitespace, 0 syntax violations**.

---

### 6.7 FASE 9: Release Candidate y Validación Integral (COMPLETADA CON ÉXITO / COMPLETED SUCCESSFULLY)
* **Objetivo / Goal**: Freeze the first community release ready for public use, validating the full upstream suite, both Docker laboratories, and the end-user README.
* **Estado / Status**: **100% IMPLEMENTADA Y VALIDADA / 100% IMPLEMENTED AND VALIDATED** (el gate `test:coverage` queda delegado a CI en el push; ver nota de validación).
* **Entregables e Hitos Cumplidos / Deliverables and Completed Milestones**:
  1. **Corrección de fixtures no herméticas detectadas por la validación integral**:
     * `packages/spill/spill-local/tests/spill-local.spec.ts` y `loader-composition.spec.ts`: los fixtures creaban directorios de sesión con `mkdirSync` en modo por defecto (0777 & ~umask). Bajo umask `0002` (estándar en Ubuntu/WSL) resultaban `0775` (writable by group) y el sweep los rechazaba correctamente como inseguros: **10 tests fallaban en cualquier equipo con umask 0002 y pasaban en CI con umask 022**. Corregido fijando `mode: 0o700` (idéntico al modo que la producción usa en `store.ts`), determinista en cualquier host POSIX e inmune a la umask del usuario. El rechazo de `isTrustedDirectory` es el comportamiento correcto de seguridad; los fixtures ahora lo respetan en todas las plataformas.
     * `packages/host/frontend-static/tests/frontend-static.spec.ts`: la inyección de `__DSH_TRUSTED_HOSTS__` (Fase 3) desplazó el marcador `shell` del `<body>` más allá de la ventana de 200 caracteres del helper `request()`; ventana ampliada a 400 con comentario del contrato.
  2. **Suite completa de tests** (`pnpm run test`): **1025 ficheros, 17.389 tests PASSED, 0 fallos, 9 skipped** (skips por plataforma/dependencias externas, por diseño).
  3. **Laboratorios Docker validados con la imagen del fork (`deepseek-harness:latest` reconstruida)**:
     * `deploy/lab/test-repro.sh`: suite de reproducción ejecutada; los antiguos fallos de Fase 1 se comportan ahora según el modelo de confianza del fork (403 estructurado con diagnóstico para hosts no confiables, 303/cookie para loopback, plugins operativos exit 0 en el contenedor — el backfill de `packageManager` de Fase 5 eliminó el bloqueo de Corepack).
     * `deploy/lab/test-proxy.sh`: **7/7 PASSED** — backend 401, Nginx HTTP, Nginx HTTPS+SSL, Caddy TLS+HTTP/2, WebSocket 101 en ambos proxies, y rechazo 403 con diagnóstico estructurado `untrusted host "untrusted-attacker.com"` en logs.
  4. **README.md orientado al usuario final (en inglés, con par bilingüe)**:
     * Reescritura completa de `README.md` y `README.zh.md`: qué cambia el fork, quick start Docker (`docker compose up -d --build`), tabla de configuración (`DSH_HOST`, `DSH_PORT`, `DSH_TRUSTED_HOSTS`, `DSH_REVERSE_PROXY`, `DEEPSEEK_API_KEY`), LAN access, contrato mínimo de reverse proxy, flujo de actualización con `scripts/sync-upstream.sh`, ejecución desde fuente, tabla de troubleshooting mapeada a los diagnósticos estructurados de Fase 6, y layout fork-specific.
     * Preservadas las anclas `#run` y `#run-from-source` que la documentación upstream enlaza (`docs/user/guide/index.md`, `docs/user/develop/basic/*`), evitando romper `verify-md-links` en futuras sincronizaciones upstream.
     * Par bilingüe re-registrado (`README.i18n.yaml`): **1118 pares consistentes**.
  5. **Gates de calidad**:
     * `pnpm run lint:contracts-ready` (oxlint): **2991 ficheros, 0 errores, 0 warnings**.
     * `pnpm run test:docs`: **14 passed** (markdown links 2239 ficheros OK, translation pairing OK, README gates OK).
     * `git diff --check`: limpio.
  6. **Nota de validación sobre `test:coverage` local**: el gate de cobertura instrumentada (100% por fichero con v8 coverage) satura este entorno WSL (7,6 GB RAM, 16 hilos): timeouts en cascada de workers vitest y `spawnSync` bajo carga, no regressions del fork. La misma suite sin instrumentar pasa al 100% (ver métrica del punto 2). **Evidencia cruzada**: `pnpm run test:coverage` ejecutado sobre el commit puro de upstream (`49a606bc5b`, sin cambios del fork) también falla en este host (1 test fallido por timeout, mismo patrón de saturación), confirmando que la limitación es del entorno, no del fork. **El gate corre en CI sobre `pull_request`** (`.github/workflows/ci.yml` es pull-request-only, así como sus jobs de cobertura Linux/Windows; los pushes a master ejecutan `ci-master.yml` más `Release (dsh)`/`Sandbox`); aquí se documentan las evidencias locales alcanzables.
* **Métricas de Calidad y Validación / Quality Metrics and Validation**:
  - `pnpm run test`: **1025 files, 17389 tests PASSED (100%), 9 skipped**.
  - `deploy/lab/test-proxy.sh`: **7/7 PASSED**.
  - `pnpm run test:docs`: **14 passed, 0 failed**.
  - `pnpm run verify-translation-pairing`: **1118 pairs consistent**.
  - `pnpm run verify-md-links`: **2239 files, all links resolve**.
  - `git diff --check`: **clean**.

---

### 6.8 FASE 10: Despliegue en Producción y Operaciones (COMPLETED SUCCESSFULLY)
* **Goal**: Ship the production operations materials for system administrators and home users — NAS/server deployment templates, `/data` backup and restore, and rollback procedures for failed updates.
* **Status**: **100% IMPLEMENTED AND VALIDATED**.
* **Deliverables and Completed Milestones**:
  1. **NAS and server deployment templates (`deploy/nas/`)**:
     * `docker-compose.synology.yml` — Synology DSM (Container Tools), bind mounts under `/volume1/docker/dsh/` so Hyper Backup sees the state; sudo-aware image import notes.
     * `docker-compose.unraid.yml` — Unraid via Docker Compose Manager, `/mnt/user/appdata/` layout, CA Backup compatibility; runs securely as unprivileged `node` user (UID 1000).
     * `docker-compose.truenas.yml` — TrueNAS SCALE custom app or plain compose, dedicated datasets with ZFS snapshots as the platform backup layer.
     * `docker-compose.server.yml` — generic Linux server with no build toolchain: prebuilt image, `/srv/dsh/` bind mounts, `.env`-driven port mapping.
     * `deploy/nas/README.md` — guide: `docker save`/`load` image delivery, pre-start trust configuration, host-specific port/proxy/ownership notes.
  2. **Backup and restore of `/data` (`deploy/operations/`)**:
     * `backup-data.sh` — archives the data volume (optionally `/workspace` too) from a throwaway read-only container into a timestamped gzip tarball, verified with `tar -t` and a SHA-256 sidecar. Excludes the regenerable pnpm store by default (`--full` includes it). Resolves Compose resource names to project-prefixed volumes (`dsh-data` → `deepseek-harness_dsh-data`) through the `com.docker.compose.volume` label, with an explicit error on ambiguity. `--service` stops and restarts the attached containers via `docker ps --filter volume=`, so it works without the Compose CLI (Synology).
     * `restore-data.sh` — refuses to restore on checksum mismatch, `--verify-only` proves archives, merge-by-default restore (append-style session data survives) with `--replace` for exact point-in-time recovery, `--service` stop/restart around the write.
     * `deploy/operations/README.md` — full operations guide: what lives in `/data` and what is regenerable, cron/DSM scheduling, off-host copies, disaster recovery on a fresh machine, and the security note that archives contain credentials and session history.
  3. **Image update and rollback procedures**:
     * `update-image.sh` — `save` pins the image the harness container runs as `deepseek-harness:rollback-<timestamp>`; `rollback [REF]` moves `latest` back and recreates the service with `--force-recreate` (volumes never touched); `list` shows references and the running image. Falls back to the plain container name and prints manual recreate steps on Compose-less hosts.
     * The guide documents the compatibility rule the upstream pre-release stance implies: session/SQLite schema versions only move forward, so the safe upgrade order is `backup-data.sh` → `update-image.sh save` → new image → `up -d`, and a rolled-back app that refuses new-format data is recovered by restoring the matching backup.
     * Root `README.md` / `README.zh.md` upgraded with the pin-and-backup update flow and links to both new directories; directory layout updated in both languages.
  4. **Bug fix discovered by real-deployment testing**:
     * `docker/healthcheck.sh` read only `PORT`; deployments setting only `DSH_PORT` (root compose maps `${DSH_PORT}` and the entrypoint exports it) probed the wrong port and reported the container unhealthy. The probe now follows `DSH_PORT` → `PORT` → 3080, matching the entrypoint precedence exactly.
  5. **Public image registry (GHCR)** — follow-up so NAS/server hosts no longer clone the repo or run the Dockerfile:
     * `.github/workflows/docker-publish.yml`: multi-arch (amd64 + arm64 via QEMU) build & push to `ghcr.io/<owner>/deepseek-harness` on every push to `master` (`:latest` + `:sha-<sha>`) and on every `dsh-v*` tag; authenticates with the built-in `GITHUB_TOKEN` (`packages: write`), GHA layer caching, manual `workflow_dispatch` with platform override.
     * The four `deploy/nas/` templates now reference the published image directly (anonymous pull for a public repo), and `deploy/nas/README.md` documents GHCR as the default delivery path with `docker save`/`load` as the offline fallback; the root README pair gained the registry note.
     * `update-image.sh` rollback semantics with a registry image documented in the operations guide (local retag is undone by the next `docker compose pull`; re-pin to a release tag after rolling back).
* **Quality Metrics and Validation**:
  - Backup → checksum → restore cycle executed end-to-end against a live isolated Compose project: `--replace` deleted post-backup witness files; a separate scratch-volume run proved merge restore keeps volume-only files while restoring archived ones: **PASSED**.
  - Tampered-archive guard: restore aborted with exit 1 on SHA-256 mismatch: **PASSED**.
  - `update-image.sh save / list / rollback` exercised against a real container, including recovery from a deliberately broken `latest` tag (rolled back to the pinned image, recreated container reached `(healthy)`): **PASSED**.
  - Healthcheck fix verified in-container on a `DSH_PORT=3081` deployment: script exits 0, container transitions to `(healthy)`: **PASSED**.
  - All four NAS templates and the root compose: `docker compose config -q` validation **0 errors**.
  - `deploy/operations/README.md`, `deploy/nas/README.md` and all scripts in English, registered as translation-pairing exclusions; `pnpm run test:docs`: **15 passed, 0 failed**.
  - `git diff --check`: **clean**.

---

## 7. Inventario de Archivos Creados y Modificados

### Archivos de Infraestructura y Configuración (Raíz y Docker)
```text
├── .dockerignore                           # Exclusiones de contexto de compilación Docker
├── .env.example                            # Plantilla declarativa exhaustiva de variables de entorno (Fase 4)
├── docker-compose.yml                      # Orquestador Docker Compose de producción con soporte .env y puertos dinámicos
├── .github/workflows/docker-publish.yml    # Publicación multi-arquitectura (amd64/arm64) de la imagen en GHCR (Fase 10)
├── PROJECT_STATUS.md                       # Documento maestro actualizado a v1.9
├── docker/
│   ├── Dockerfile                          # Imagen reproducible Node 24 con compilación integrada y pnpm preinstalado
│   ├── entrypoint.sh                       # Entrypoint con variables DSH_*, PNPM_HOME persistente y arranque dsh web
│   ├── healthcheck.sh                      # Sonda HTTP de salud (401/200/303), sigue DSH_PORT → PORT (Fase 10)
│   └── docker.patch.yml                    # Parche Cordis para bind 0.0.0.0 sin alterar el core
├── deploy/sync/                            # Estrategia de sincronización upstream y runbook operativo (Fase 8)
│   └── README.md                           # Guía exhaustiva en inglés sobre sincronización, topología de ramas y resolución de conflictos
├── deploy/reverse-proxy/                   # Configuraciones de referencia para producción (Fase 7)
│   ├── README.md                           # Guía completa de despliegue con proxies inversos
│   ├── nginx.conf                          # Plantilla Nginx con SSL, WebSockets y streaming
│   ├── Caddyfile                           # Plantilla Caddy con TLS automático y streaming
│   └── docker-compose.traefik.yml          # Plantilla Compose con Traefik v3 y ACME Let's Encrypt
├── deploy/nas/                             # Plantillas de despliegue NAS/servidor (Fase 10)
│   ├── README.md                           # Guía en inglés: imagen GHCR multi-arq, entrega offline, notas por host
│   ├── docker-compose.synology.yml         # Synology DSM con bind mounts en /volume1 y Hyper Backup
│   ├── docker-compose.unraid.yml           # Unraid con appdata en /mnt/user y compatibilidad CA Backup
│   ├── docker-compose.truenas.yml          # TrueNAS SCALE con datasets ZFS como capa de snapshots
│   └── docker-compose.server.yml           # Servidor Linux genérico con imagen GHCR preconstruida y .env
├── deploy/operations/                      # Operaciones de producción: backup, restore, rollback (Fase 10)
│   ├── README.md                           # Guía operativa completa en inglés (targets, backup, update, rollback, fallos)
│   ├── backup-data.sh                      # Backup tar.gz + SHA-256 del volumen /data, exclusión de pnpm store, --service
│   ├── restore-data.sh                     # Restore con verificación de checksum, merge o --replace exacto, --verify-only
│   └── update-image.sh                     # save/rollback/list de referencias rollback-<timestamp> sobre la imagen local
└── deploy/lab/                             # Laboratorio de pruebas y reproducción (Fases 1 y 7)
    ├── Dockerfile                          # Imagen específica del laboratorio
    ├── docker-compose.yml                  # Composición con Harness + Nginx Proxy (8080/8443) + Caddy Proxy (8444)
    ├── nginx.conf                          # Configuración de Nginx con SSL y WebSockets
    ├── Caddyfile                           # Configuración de Caddy con TLS interna
    ├── test-repro.sh                       # Suite automatizada de reproducción de fallos (Fase 1)
    └── test-proxy.sh                       # Suite automatizada de validación de proxies y WebSockets (Fase 7)
```

### Archivos de Código Fuente y Scripts Modificados (Evolución Modular de Fases 3 a 10)
```text
scripts/
├── sync-upstream.sh                        # Script automatizado de sincronización upstream con simulación de conflictos (Fase 8)
└── translation-pairing.manifest.json       # Exclusiones de pairing: deploy/{reverse-proxy,sync,operations,nas}/README.md (Fases 7, 8 y 10)

packages/bundle/web-app/
├── src/startup.ts                          # Soporte 0.0.0.0 con warning y lectura de DSH_HOST/DSH_PORT (Fases 3 y 4)
├── src/index.ts                            # Inclusión de DSH_TRUSTED_HOSTS y fallback LAN (Fase 3)
├── tests/startup.spec.ts                   # Tests unitarios de startup y variables de entorno
└── tests/trusted-hosts.spec.ts             # Tests unitarios de resolución de trustedHosts

packages/client/connection/
├── src/api-request-trust.ts                # reverseProxy, evaluateApiRequestTrust y diagnóstico 403 (Fases 3 y 6)
├── src/browser-auth.ts                     # reverseProxy, authenticate y diagnóstico 401 seguro (Fases 3 y 6)
├── src/rpc-host.ts                         # Propagación de reverseProxy y logs warning en requestRejection (Fases 3 y 6)
├── src/index.ts                            # Inyección de trustedHosts en HTML y paso de ctx.logger a BrowserAuth (Fases 3 y 6)
├── src/client/index.ts                     # isAuthorizedHost para activar Settings UI en clientes LAN (Fase 3)
├── tests/api-request-trust.host.spec.ts    # Tests unitarios de trust fence y diagnóstico de rechazo 403
├── tests/browser-auth.host.spec.ts         # Tests unitarios de browser auth y diagnóstico seguro 401
└── tests/node-half.host.spec.ts            # Tests unitarios de logging warning en requestRejection

packages/boot/app-boot/
└── src/profile.ts                          # packageManager explícito ('pnpm@11.7.0') en manifiesto de perfil (Fase 5)

packages/spill/spill-local/
├── tests/spill-local.spec.ts               # Fixtures herméticos (mode 0o700) inmunes a la umask del host (Fase 9)
└── tests/loader-composition.spec.ts        # Fixture de composición con modo explícito (Fase 9)

packages/host/frontend-static/
└── tests/frontend-static.spec.ts           # Ventana del helper request() ampliada por la inyección de trusted hosts (Fase 9)

apps/cli/
├── src/plugin.ts                           # Backfill automático de packageManager y COREPACK_ENABLE_DOWNLOAD_PROMPT=0 (Fase 5)
└── tests/plugin.spec.ts                    # Tests unitarios de inicialización y migración de packageManager

README.md / README.zh.md / README.i18n.yaml # README del fork reescrito para usuarios finales (Fase 9), actualizado con flujo save+backup y enlaces a deploy/{nas,operations} (Fase 10)

docker/healthcheck.sh                       # Puerto de sonda sigue DSH_PORT → PORT → 3080 (fix Fase 10)
```

---

## 8. Estado Final del Proyecto (Fases 0–10 Completadas)

**Las diez fases están terminadas y verificadas.** El repositorio cuenta con:

* Infraestructura Docker reproducible (imagen base, volúmenes, healthcheck).
* Acceso LAN y tras proxies inversos (Nginx, Caddy, Traefik, tunnels) con modelo de confianza declarativo.
* Configuración por variables de entorno (`DSH_HOST`, `DSH_PORT`, `DSH_TRUSTED_HOSTS`, `DSH_REVERSE_PROXY`).
* Gestión de plugins fiable en contenedores (`packageManager`, store pnpm persistente).
* Diagnósticos estructurados 403/401 sin fuga de credenciales.
* Sincronización con upstream automatizada con simulación de conflictos.
* Release candidate validada (suite completa 17.389 tests, laboratorios 7/7, README bilingüe).
* Operaciones de producción: plantillas NAS (Synology/Unraid/TrueNAS/servidor), backup/restore de `/data` con verificación SHA-256, y rollback de imagen anclado (`update-image.sh save/rollback`).

### Comandos de Verificación Rápida
```bash
# 1. Comprobar script de sincronización upstream en modo dry-run
./scripts/sync-upstream.sh --check

# 2. Comprobar que los tests de las áreas modificadas pasan limpiamente
pnpm exec vitest run packages/bundle/web-app packages/client/connection packages/boot/app-boot apps/cli/tests/plugin.spec.ts

# 3. Comprobar sintaxis shell, linter, documentación y whitespace
bash -n deploy/operations/*.sh
docker compose -f deploy/nas/docker-compose.synology.yml -p dsh-check config -q   # (repetir para cada plantilla)
git diff --check
pnpm run test:docs

# 4. Comprobar el ciclo de operaciones sobre el despliegue activo
./deploy/operations/backup-data.sh --output /tmp/dsh-backups
./deploy/operations/restore-data.sh --latest --output /tmp/dsh-backups --verify-only
./deploy/operations/update-image.sh list
```

### Trabajo Futuro Sugerido (fuera del alcance de las 10 fases)
* El gate `test:coverage` ya corre en CI sobre `pull_request` (ver nota de Fase 9); abrir PRs del fork para activarlo si se desea esa señal además de los pushes a master.
* Cuando se disponga de una `DEEPSEEK_API_KEY`: `gh secret set DEEPSEEK_API_KEY_EXTERNAL` + re-activar el workflow E2E (`e2e.yml`, hoy deshabilitado en el fork al no haber clave).
* Primera ejecución del workflow `Docker image (ghcr.io)`: valida la publicación multi-arquitectura real y que el pull anónimo funciona desde un NAS.
* Validar manualmente una plantilla NAS en hardware real cuando esté disponible.
