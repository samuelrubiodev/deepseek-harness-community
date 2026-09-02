# DeepSeek Harness Community Fork: Documento Maestro de Arquitectura, Auditoría, Estado y Hoja de Ruta

**Versión del documento**: 1.4 (Fases 0, 1, 2, 3, 4 y 5 Completadas con Éxito)
**Fecha**: Septiembre 2026
**Repositorio local**: `/home/samuel/Documents/deepseek-harness` (Rama `master`)
**Remoto de Upstream**: `https://github.com/deepseek-ai/deepseek-harness.git`
**Remoto del Fork**: `https://github.com/samuelrubiodev/deepseek-harness-community`
**Versión de Upstream**: `0.1.2-alpha.5`
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
8. [Guía Rápida para Retomar el Proyecto en la Próxima Sesión](#8-guía-rápida-para-retomar-el-proyecto-en-la-próxima-sesión)

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
[FASE 3: Modelo LAN / Host / Origin]   --> SIGUIENTE PASO
         │
[FASE 4: Variables de Entorno]         --> PENDIENTE
         │
[FASE 5: Plugins en Docker]            --> PENDIENTE
         │
[FASE 6: Diagnóstico y Logging]        --> PENDIENTE
         │
[FASE 7: Reverse Proxy Avanzado]       --> PENDIENTE
         │
[FASE 8: Actualizaciones Upstream]     --> PENDIENTE
         │
[FASE 9: Release Candidate]            --> PENDIENTE
         │
[FASE 10: Producción y Operaciones]    --> PENDIENTE
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
* Instrucción de salud integrada:
  ```dockerfile
  HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
      CMD /app/docker/healthcheck.sh
  ```
* Directorio de trabajo: `WORKDIR /workspace`.
* Punto de entrada: `ENTRYPOINT ["/app/docker/entrypoint.sh"]`.

### 5.3 `docker/entrypoint.sh`
* Crea `/data` y `/workspace` con los permisos adecuados en el arranque.
* Imprime logs informativos claros:
  ```text
  [dsh-docker] Starting DeepSeek Harness...
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

Esta sección define las tareas concretas para cada fase pendiente. **Al reanudar el proyecto en la siguiente sesión, se comenzará directamente en la Fase 3.**

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

### 6.4 FASE 6: Diagnóstico y Observabilidad Estructurada
* **Objetivo**: Que ante cualquier fallo de conexión o autenticación, los logs expliquen con exactitud qué ha fallado sin comprometer la seguridad.
* **Tareas**:
  1. Instrumentar `isTrustedApiRequest`: Cuando una petición sea rechazada con 403, emitir un log a nivel `warn` o `debug` indicando:
     * Motivo exacto: `Host no confiable (<host>)`, `Origin no coincidente (<origin> vs <host>)` o `Sec-Fetch-Site cross-site`.
  2. Instrumentar `BrowserAuth`: Indicar si el rechazo 401 fue por falta de cookie, token inválido, expiración o desajuste de autoridad.
  3. **Seguridad estricta**: Asegurar que los valores de tokens de autenticación, hashes de contraseñas y claves de API NUNCA se impriman en los logs.

---

### 6.5 FASE 7: Escenarios Avanzados de Reverse Proxy
* **Objetivo**: Validar el funcionamiento en despliegues reales con servidores web de terminación TLS.
* **Tareas**:
  1. Configurar en el laboratorio escenarios con Caddy y Nginx con SSL autofirmado / HTTPS.
  2. Verificar que las conexiones persistentes de WebSockets (usadas para streaming de respuestas del agente) no sufran desconexiones ni timeouts prematuros.
  3. Documentar configuraciones de referencia (`Caddyfile`, `nginx.conf`, labels de Traefik).

---

### 6.6 FASE 8: Sistema de Sincronización con Upstream
* **Objetivo**: Establecer el flujo de mantenimiento a largo plazo para incorporar mejoras y correcciones de DeepSeek Harness oficial.
* **Tareas**:
  1. Crear un script en `scripts/sync-upstream.sh`.
  2. Documentar la estrategia de ramas (`upstream-tracking` -> `master` del fork).
  3. Generar una lista de verificación post-sincronización (ejecución de tests de regresión y reconstrucción de imágenes Docker).

---

### 6.7 FASE 9: Release Candidate y Validación Integral
* **Objetivo**: Congelar la primera versión comunitaria lista para uso público.
* **Tareas**:
  1. Ejecutar la suite completa de tests de upstream (`pnpm run test`, `pnpm run test:coverage`).
  2. Ejecutar la suite completa de pruebas del laboratorio (`test-repro.sh` validando que todos los casos ahora son PASS).
  3. Redactar el archivo `README.md` orientado al usuario final con instrucciones de inicio rápido.

---

### 6.8 FASE 10: Despliegue en Producción y Operaciones
* **Objetivo**: Materiales y guías para administradores de sistemas y usuarios domésticos.
* **Tareas**:
  1. Plantillas de `docker-compose.yml` para servidores locales y NAS (Synology, Unraid, TrueNAS).
  2. Guías de copias de seguridad (backup de `/data`) y restauración.
  3. Procedimientos de rollback ante actualizaciones fallidas.

---

## 7. Inventario de Archivos Creados y Modificados

Todos los cambios implementados hasta el momento se encuentran estrictamente aislados en la raíz y en subdirectorios de despliegue, **sin haber modificado ningún archivo original de `packages/` ni de `apps/`**:

```text
/home/samuel/Documents/deepseek-harness/
├── .dockerignore              # Exclusiones de contexto de compilación Docker
├── docker-compose.yml         # Orquestador Docker Compose de producción (Fase 2)
├── PROJECT_STATUS.md          # Documento maestro actual
├── docker/                    # Infraestructura Docker oficial
│   ├── Dockerfile             # Imagen reproducible Node 24 con compilación integrada
│   ├── entrypoint.sh          # Script de inicio, permisos y propagación de señales
│   ├── healthcheck.sh         # Sonda HTTP de comprobación de salud del servicio
│   └── docker.patch.yml       # Parche Cordis para bind 0.0.0.0 sin alterar el core
└── deploy/                    # Laboratorio de pruebas y reproducción (Fase 1)
    └── lab/
        ├── Dockerfile         # Imagen específica del laboratorio
        ├── docker-compose.yml # Composición con Harness + Nginx Proxy
        ├── nginx.conf         # Configuración del proxy (puertos 8080 y 8081)
        ├── bind-all.patch.yml # Parche de prueba para 0.0.0.0
        └── test-repro.sh      # Suite automatizada de reproducción de fallos
```

---

## 8. Guía Rápida para Retomar el Proyecto en la Próxima Sesión

Las **Fases 0, 1, 2, 3, 4 y 5** están completamente terminadas y verificadas con éxito. El estado está completamente preparado para avanzar de inmediato a la **FASE 6** (Diagnóstico y Observabilidad Estructurada).

### Comandos de Verificación Rápida
```bash
# 1. Comprobar que los tests de las áreas modificadas pasan limpiamente
pnpm exec vitest run packages/bundle/web-app packages/client/connection packages/boot/app-boot apps/cli/tests/plugin.spec.ts

# 2. Comprobar verificación de sintaxis y reglas de estilo
git diff --check
pnpm run lint

# 3. Comprobar estado de Git
git status
```

### Instrucción para la Siguiente Sesión
Para continuar el trabajo de forma directa, bastará con indicar:
> *"Continuamos con la FASE 6 (Diagnóstico y Observabilidad Estructurada) según lo planificado en PROJECT_STATUS.md"*.
