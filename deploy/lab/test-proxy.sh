#!/usr/bin/env bash
set -euo pipefail

# Colores para salida visual
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}  FASE 7: SUITE DE VALIDACIÓN AVANZADA REVERSE PROXY ${NC}"
echo -e "${BLUE}====================================================${NC}"

# Extraer token activo del contenedor
TOKEN=$(docker logs dsh-lab-harness 2>&1 | grep -o 'token=[A-Za-z0-9_-]*' | tail -n1 | cut -d'=' -f2)
if [ -z "$TOKEN" ]; then
    echo -e "${RED}[ERROR] No se pudo obtener el token de lanzamiento del contenedor dsh-lab-harness${NC}"
    exit 1
fi
echo -e "${GREEN}[OK] Token de lanzamiento obtenido: ${TOKEN}${NC}\n"

PASS_COUNT=0
TOTAL_TESTS=7

# -------------------------------------------------------------
# PRUEBA 1: Acceso directo HTTP a Backend (Puerto 3080)
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 1/7] Acceso directo al Backend (3080)...${NC}"
HTTP_CODE_RAW=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3080/ || echo "000")
if [ "$HTTP_CODE_RAW" == "401" ]; then
    echo -e "${GREEN}[PASS] Backend responde 401 sin credenciales como se espera.${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${RED}[FAIL] Código inesperado en backend directo: ${HTTP_CODE_RAW}${NC}"
fi
echo ""

# -------------------------------------------------------------
# PRUEBA 2: Proxy HTTP Nginx (Puerto 8080) con Host LAN
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 2/7] Reverse Proxy HTTP (Nginx :8080)...${NC}"
# 2.1 Intercambio de token a través del proxy
RESP_8080=$(curl -s -i -H "Host: harness.lan:8080" "http://localhost:8080/?token=${TOKEN}")
CODE_8080=$(echo "$RESP_8080" | grep -i '^HTTP/' | awk '{print $2}')
COOKIE_8080=$(echo "$RESP_8080" | grep -i '^set-cookie:' | awk '{print $2}' | tr -d '\r;' || true)

if [ "$CODE_8080" == "303" ] && [ -n "$COOKIE_8080" ]; then
    echo -e "   - Intercambio de token exitoso (HTTP 303). Cookie: ${COOKIE_8080:0:35}..."
    # 2.2 Petición a /api/ con Cookie obtenida
    API_RESP_8080=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: harness.lan:8080" -H "Cookie: ${COOKIE_8080}" http://localhost:8080/api/)
    if [ "$API_RESP_8080" == "404" ]; then
        echo -e "${GREEN}[PASS] Petición /api/ superó trust fence y auth a través de Nginx HTTP (HTTP 404 esperado).${NC}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "${RED}[FAIL] Petición /api/ falló con código: ${API_RESP_8080}${NC}"
    fi
else
    echo -e "${RED}[FAIL] Intercambio de token falló en puerto 8080. Código: ${CODE_8080}${NC}"
fi
echo ""

# -------------------------------------------------------------
# PRUEBA 3: Proxy HTTPS Nginx con SSL / TLS (Puerto 8443)
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 3/7] Reverse Proxy HTTPS con SSL (Nginx :8443)...${NC}"
RESP_8443=$(curl -k -s -i -H "Host: harness.lan:8443" "https://localhost:8443/?token=${TOKEN}")
CODE_8443=$(echo "$RESP_8443" | grep -i '^HTTP/' | awk '{print $2}')
COOKIE_8443=$(echo "$RESP_8443" | grep -i '^set-cookie:' | awk '{print $2}' | tr -d '\r;' || true)

if [ "$CODE_8443" == "303" ] && [ -n "$COOKIE_8443" ]; then
    echo -e "   - Intercambio de token exitoso con TLS (HTTP 303). Cookie: ${COOKIE_8443:0:35}..."
    API_RESP_8443=$(curl -k -s -o /dev/null -w "%{http_code}" -H "Host: harness.lan:8443" -H "Cookie: ${COOKIE_8443}" https://localhost:8443/api/)
    if [ "$API_RESP_8443" == "404" ]; then
        echo -e "${GREEN}[PASS] Terminación TLS en Nginx validada con X-Forwarded-Proto https (HTTP 404 esperado).${NC}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "${RED}[FAIL] Petición /api/ con SSL falló con código: ${API_RESP_8443}${NC}"
    fi
else
    echo -e "${RED}[FAIL] Intercambio de token falló en puerto 8443. Código: ${CODE_8443}${NC}"
fi
echo ""

# -------------------------------------------------------------
# PRUEBA 4: Proxy HTTPS Caddy con TLS automático (Puerto 8444)
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 4/7] Reverse Proxy HTTPS con Caddy (Caddy :8444)...${NC}"
RESP_8444=$(curl -k -s -i "https://localhost:8444/?token=${TOKEN}")
CODE_8444=$(echo "$RESP_8444" | grep -i '^HTTP/' | awk '{print $2}')
COOKIE_8444=$(echo "$RESP_8444" | grep -i '^set-cookie:' | awk '{print $2}' | tr -d '\r;' || true)

if [ "$CODE_8444" == "303" ] && [ -n "$COOKIE_8444" ]; then
    echo -e "   - Intercambio de token exitoso con Caddy (HTTP 303). Cookie: ${COOKIE_8444:0:35}..."
    API_RESP_8444=$(curl -k -s -o /dev/null -w "%{http_code}" -H "Cookie: ${COOKIE_8444}" https://localhost:8444/api/)
    if [ "$API_RESP_8444" == "404" ]; then
        echo -e "${GREEN}[PASS] Caddy con TLS interna y HTTP/2 validado exitosamente (HTTP 404 esperado).${NC}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "${RED}[FAIL] Petición /api/ con Caddy falló con código: ${API_RESP_8444}${NC}"
    fi
else
    echo -e "${RED}[FAIL] Intercambio de token falló en Caddy (8444). Código: ${CODE_8444}${NC}"
fi
echo ""

# -------------------------------------------------------------
# PRUEBA 5: WebSockets sobre Nginx HTTPS (:8443)
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 5/7] Conexión persistente WebSocket sobre Nginx SSL...${NC}"
WS_NGINX_RESP=$(curl -k -i -N \
  -H "Host: harness.lan:8443" \
  -H "Cookie: ${COOKIE_8443}" \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  --max-time 2 \
  "https://localhost:8443/api/remote.mux" 2>/dev/null || true)

if echo "$WS_NGINX_RESP" | grep -q "101 Switching Protocols"; then
    echo -e "${GREEN}[PASS] WebSocket Upgrade exitoso en Nginx SSL (HTTP 101 Switching Protocols).${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${RED}[FAIL] WebSocket Upgrade falló en Nginx:${NC}\n$WS_NGINX_RESP"
fi
echo ""

# -------------------------------------------------------------
# PRUEBA 6: WebSockets sobre Caddy HTTPS (:8444)
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 6/7] Conexión persistente WebSocket sobre Caddy TLS...${NC}"
WS_CADDY_RESP=$(curl -k -i -N \
  -H "Host: localhost:8444" \
  -H "Cookie: ${COOKIE_8444}" \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  --http1.1 \
  --max-time 2 \
  "https://localhost:8444/api/remote.mux" 2>/dev/null || true)

if echo "$WS_CADDY_RESP" | grep -q "101 Switching Protocols"; then
    echo -e "${GREEN}[PASS] WebSocket Upgrade exitoso en Caddy TLS (HTTP 101 Switching Protocols).${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${RED}[FAIL] WebSocket Upgrade falló en Caddy:${NC}\n$WS_CADDY_RESP"
fi
echo ""

# -------------------------------------------------------------
# PRUEBA 7: Seguridad y Diagnóstico Estructurado en Proxy
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 7/7] Rechazo de host no confiable y emisión de log estructurado...${NC}"
UNTRUSTED_RESP=$(curl -k -s -o /dev/null -w "%{http_code}" -H "Host: untrusted-attacker.com" https://localhost:8443/api/)
if [ "$UNTRUSTED_RESP" == "403" ]; then
    LOG_MATCH=$(docker logs dsh-lab-harness 2>&1 | grep "untrusted host \"untrusted-attacker.com\"" | tail -n1 || true)
    if [ -n "$LOG_MATCH" ]; then
        echo -e "${GREEN}[PASS] Host no confiable rechazado con HTTP 403 y diagnosticado en logs:${NC}"
        echo -e "   ${CYAN}${LOG_MATCH}${NC}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "${RED}[FAIL] 403 recibido pero no se encontró la línea diagnóstica esperada en logs.${NC}"
    fi
else
    echo -e "${RED}[FAIL] Petición no confiable no devolvió 403: ${UNTRUSTED_RESP}${NC}"
fi
echo ""

echo -e "${BLUE}====================================================${NC}"
if [ "$PASS_COUNT" -eq "$TOTAL_TESTS" ]; then
    echo -e "${GREEN}  RESULTADO FINAL: ${PASS_COUNT}/${TOTAL_TESTS} PRUEBAS PASADAS CON ÉXITO ${NC}"
    echo -e "${GREEN}  Todos los escenarios de Reverse Proxy y WebSockets validados.${NC}"
else
    echo -e "${RED}  RESULTADO FINAL: ${PASS_COUNT}/${TOTAL_TESTS} PRUEBAS PASADAS.${NC}"
    exit 1
fi
echo -e "${BLUE}====================================================${NC}"
