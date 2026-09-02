# Guía de Despliegue con Reverse Proxy (Nginx, Caddy, Traefik, Cloudflare Tunnel)

Esta guía contiene las configuraciones de referencia y las mejores prácticas para desplegar **DeepSeek Harness** en producción o en servidores domésticos detrás de un proxy inverso con terminación SSL/TLS y soporte de WebSockets.

---

## 1. Fundamentos de Red y Requisitos Previos

Para que DeepSeek Harness funcione correctamente detrás de cualquier proxy inverso, el contenedor debe configurarse con las siguientes variables de entorno:

| Variable | Valor Recomendado | Propósito |
| :--- | :--- | :--- |
| `DSH_HOST` | `0.0.0.0` | Permite que el proceso escuche en todas las interfaces de red del contenedor. |
| `DSH_PORT` | `3080` | Puerto HTTP interno en el que escucha el arnés. |
| `DSH_REVERSE_PROXY` | `true` | Habilita la lectura de `X-Forwarded-Host` y `X-Forwarded-Proto` en la capa de transporte y autenticación. |
| `DSH_TRUSTED_HOSTS` | `midominio.com,harness.local` | Lista de nombres de dominio o IPs separados por comas que el proxy presentará al arnés. |

### Reglas Esenciales del Proxy Inverso

1. **Preservar el Host Público (`X-Forwarded-Host`)**:
   El proxy **no** debe reescribir el `Host` interno a `harness:3080` sin pasar `X-Forwarded-Host`. La cookie de sesión (`dsh-auth-<hash>`) y el trust fence se calculan a partir de la autoridad que el navegador del usuario ve en la barra de direcciones.

2. **Propagar el Protocolo Real (`X-Forwarded-Proto`)**:
   Cuando el proxy termina SSL y se conecta al contenedor por HTTP plano, debe enviar `X-Forwarded-Proto: https`. De lo contrario, el sistema rechazará la petición con `403 Forbidden` al detectar un desajuste entre el protocolo del `Origin` (`https://`) y el del `Host` (`http://`).

3. **Soporte Completo de WebSockets (`/api/remote.mux`)**:
   DeepSeek Harness utiliza WebSockets para streaming bidireccional y multiplexación de eventos del agente. El proxy debe reenviar las cabeceras `Upgrade` y `Connection`.

4. **Desactivar el Buffering de Respuestas**:
   Los modelos de DeepSeek transmiten tokens carácter a carácter en tiempo real. Si el proxy tiene activado el buffer de salida (como ocurre por defecto en Nginx), el usuario experimentará pausas y las respuestas aparecerán en bloques grandes en lugar de fluir en tiempo real.

5. **Timeouts Prolongados**:
   Los turnos de razonamiento profundo (ej. DeepSeek-R1) pueden tardar más de 60 segundos antes de emitir el primer token. Los timeouts de lectura y envío del proxy (`proxy_read_timeout`) deben fijarse en valores amplios (ej. `86400s` o `3600s`).

---

## 2. Servidores Soportados y Ejemplos

### Opción A: Nginx

Archivo de referencia: [`nginx.conf`](./nginx.conf)

Puntos clave en Nginx:
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name harness.midominio.com;

    client_max_body_size 300M; # Límite alineado con imágenes

    location / {
        proxy_pass http://harness:3080;
        proxy_http_version 1.1;

        # Autoridad y cabeceras
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # WebSockets
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Streaming en vivo sin búfer
        proxy_buffering off;
        proxy_cache off;

        # Timeouts de streaming
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

### Opción B: Caddy

Archivo de referencia: [`Caddyfile`](./Caddyfile)

Caddy gestiona certificados SSL automáticamente y soporta WebSockets de forma transparente:
```caddyfile
harness.midominio.com {
    reverse_proxy harness:3080 {
        header_up Host {host}
        header_up X-Forwarded-Host {host}
        header_up X-Forwarded-Proto https
        flush_interval -1 # Desactiva buffer para streaming instantáneo
    }
}
```

---

### Opción C: Traefik (Docker Compose)

Archivo de referencia: [`docker-compose.traefik.yml`](./docker-compose.traefik.yml)

Etiquetas para el contenedor de DeepSeek Harness:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.dsh.rule=Host(`harness.midominio.com`)"
  - "traefik.http.routers.dsh.entrypoints=websecure"
  - "traefik.http.routers.dsh.tls.certresolver=myresolver"
  - "traefik.http.services.dsh.loadbalancer.server.port=3080"
  - "traefik.http.middlewares.dsh-headers.headers.customrequestheaders.X-Forwarded-Proto=https"
  - "traefik.http.routers.dsh.middlewares=dsh-headers"
```

---

### Opción D: Cloudflare Tunnel / Dokploy / Coolify

Si utilizas un túnel de Cloudflare o plataformas PaaS como Dokploy o Coolify:
1. Apunta el servicio HTTP interno a `http://harness:3080`.
2. En la configuración del túnel, asegúrate de activar el soporte de **WebSockets**.
3. En las variables de entorno del contenedor DeepSeek Harness, define:
   ```env
   DSH_REVERSE_PROXY=true
   DSH_TRUSTED_HOSTS=midominio-tunnels.com
   ```

---

## 3. Diagnóstico y Resolución de Problemas

Si recibes errores de conexión al acceder a través de tu proxy, ejecuta:
```bash
docker compose logs -f harness
```

Gracias al sistema de diagnóstico estructurado implementado en la Fase 6, verás explicaciones exactas:

* `API request rejected (403): untrusted host "midominio.com"`:
  * **Causa**: El nombre de dominio no está incluido en `DSH_TRUSTED_HOSTS`.
  * **Solución**: Añade `midominio.com` a `DSH_TRUSTED_HOSTS` en tu `.env` o `docker-compose.yml`.

* `API request rejected (403): origin mismatch ("https://midominio.com" vs "http://midominio.com")`:
  * **Causa**: El proxy no está enviando `X-Forwarded-Proto https`.
  * **Solución**: Añade la cabecera `proxy_set_header X-Forwarded-Proto https;` en tu proxy.

* `API request rejected (401): session cookie authority mismatch`:
  * **Causa**: El usuario inició sesión a través de una URL o puerto distinto al configurado en el proxy.
  * **Solución**: Reabre la URL de inicio del arnés a través del dominio del proxy para renovar la cookie.
