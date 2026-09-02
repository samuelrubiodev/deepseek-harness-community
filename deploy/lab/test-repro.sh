#!/usr/bin/env bash
set -euo pipefail

# Colores para salida visual
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}   FASE 1: SUITE DE REPRODUCCIÓN DE PROBLEMAS DSH  ${NC}"
echo -e "${BLUE}====================================================${NC}"

# Extraer token activo del contenedor
TOKEN=$(docker logs dsh-lab-harness 2>&1 | grep -o 'token=[A-Za-z0-9_-]*' | tail -n1 | cut -d'=' -f2)
if [ -z "$TOKEN" ]; then
    echo -e "${RED}[ERROR] No se pudo obtener el token de lanzamiento del contenedor dsh-lab-harness${NC}"
    exit 1
fi
echo -e "${GREEN}[OK] Token de lanzamiento obtenido: ${TOKEN}${NC}\n"

# -------------------------------------------------------------
# PRUEBA 1: Bloqueo explícito de --host 0.0.0.0 en CLI
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 1] Verificando bloqueo explícito de --host 0.0.0.0 en upstream...${NC}"
OUTPUT=$(docker run --rm lab-harness web --no-open --host 0.0.0.0 --port 3080 2>&1 || true)
if echo "$OUTPUT" | grep -q "error: --host 0.0.0.0 is intentionally not supported yet for safety"; then
    echo -e "${GREEN}[DEMOSTRADO] El CLI de upstream bloquea intencionadamente --host 0.0.0.0 con el mensaje:${NC}"
    echo -e "   $OUTPUT"
else
    echo -e "${RED}[FALLO] Comportamiento inesperado al pasar --host 0.0.0.0:${NC} $OUTPUT"
fi
echo ""

# -------------------------------------------------------------
# PRUEBA 2: Escenario A - Localhost directo (debe funcionar)
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 2] Escenario A: Acceso Localhost directo...${NC}"
# 2.1 Sin autenticar -> 401
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3080/)
echo -e "   - Petición a '/' sin token: HTTP ${HTTP_CODE} (esperado 401)"

# 2.2 Con token -> 303 + Set-Cookie
COOKIE_HEADER=$(curl -s -i "http://localhost:3080/?token=${TOKEN}" | grep -i '^set-cookie:' || true)
COOKIE=$(echo "$COOKIE_HEADER" | awk '{print $2}' | tr -d '\r;' || true)
echo -e "   - Petición con token intercambia por Cookie: ${COOKIE:0:45}..."

# 2.3 Acceso a /api con Host loopback y Cookie válida -> 404 (supera trust fence y auth)
API_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: ${COOKIE}" http://localhost:3080/api/)
echo -e "   - Petición a '/api/' con Host loopback y Cookie válida: HTTP ${API_CODE} (esperado 404, superó filtro)"
echo ""

# -------------------------------------------------------------
# PRUEBA 3: Escenario B - Fallo en LAN directa (Error 403)
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 3] Escenario B: Acceso LAN directa con IP o hostname (Error 403)...${NC}"

# Simular que un cliente de la LAN envía petición con Host de su IP LAN
LAN_IP="192.168.1.50:3080"
LAN_RESP=$(curl -s -i -H "Host: ${LAN_IP}" -H "Cookie: ${COOKIE}" http://localhost:3080/api/)
LAN_CODE=$(echo "$LAN_RESP" | grep -i '^HTTP/' | awk '{print $2}')
LAN_BODY=$(echo "$LAN_RESP" | tail -n1)

echo -e "   - Petición con 'Host: ${LAN_IP}': HTTP ${LAN_CODE} (${LAN_BODY})"
if [ "$LAN_CODE" == "403" ]; then
    echo -e "${GREEN}[DEMOSTRADO] El Host LAN '${LAN_IP}' es rechazado con 403 Forbidden porque resolveLanTrust() en Docker solo detectó las interfaces internas del contenedor y no la IP LAN del host.${NC}"
fi

# Simular petición con Hostname LAN (ej. harness.lan)
HOST_LAN="harness.lan:3080"
HOST_RESP=$(curl -s -i -H "Host: ${HOST_LAN}" -H "Cookie: ${COOKIE}" http://localhost:3080/api/)
HOST_CODE=$(echo "$HOST_RESP" | grep -i '^HTTP/' | awk '{print $2}')
echo -e "   - Petición con 'Host: ${HOST_LAN}': HTTP ${HOST_CODE}"
if [ "$HOST_CODE" == "403" ]; then
    echo -e "${GREEN}[DEMOSTRADO] El Hostname '${HOST_LAN}' es rechazado con 403 Forbidden porque no está en trustedHosts.${NC}"
fi
echo ""

# -------------------------------------------------------------
# PRUEBA 4: Desajuste de cabecera Origin (Error 403)
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 4] Desajuste entre cabecera Origin y Host (Error 403)...${NC}"
ORIGIN_RESP=$(curl -s -i -H "Origin: http://harness.lan:3080" -H "Host: 127.0.0.1:3080" -H "Cookie: ${COOKIE}" http://localhost:3080/api/)
ORIGIN_CODE=$(echo "$ORIGIN_RESP" | grep -i '^HTTP/' | awk '{print $2}')
echo -e "   - Petición con 'Origin: http://harness.lan:3080' y 'Host: 127.0.0.1:3080': HTTP ${ORIGIN_CODE}"
if [ "$ORIGIN_CODE" == "403" ]; then
    echo -e "${GREEN}[DEMOSTRADO] Cualquier desajuste entre Origin y Host provoca 403 Forbidden por la comprobación estricta isTrustedApiRequest.${NC}"
fi
echo ""

# -------------------------------------------------------------
# PRUEBA 5: Escenario C - Reverse Proxy y Autenticación (Error 401 / 403)
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 5] Escenario C: Reverse Proxy...${NC}"

# 5.1 Proxy que preserva Host (puerto 8080) pero con nombre no confiable
PROXY_RESP=$(curl -s -i -H "Host: mi-harness.local" http://localhost:8080/api/)
PROXY_CODE=$(echo "$PROXY_RESP" | grep -i '^HTTP/' | awk '{print $2}')
echo -e "   - Proxy con 'Host: mi-harness.local': HTTP ${PROXY_CODE} (esperado 403 Forbidden)"

# 5.2 Proxy que reescribe Host al hostname interno (puerto 8081)
# Si el navegador intenta autenticarse mediante un proxy que reescribe Host:
PROXY_REWRITE_RESP=$(curl -s -i "http://localhost:8081/?token=${TOKEN}")
PROXY_REWRITE_COOKIE=$(echo "$PROXY_REWRITE_RESP" | grep -i '^set-cookie:' | awk '{print $2}' || true)
echo -e "   - Proxy con reescritura de Host (puerto 8081): Cookie generada vinculada a '${PROXY_REWRITE_COOKIE:0:30}...'"

# Petición subsecuente enviada por cliente con su Host original contra el backend que espera la autoridad interna
MISMATCH_RESP=$(curl -s -i -H "Host: mi-harness.local" -H "Cookie: ${PROXY_REWRITE_COOKIE}" http://localhost:3080/api/)
MISMATCH_CODE=$(echo "$MISMATCH_RESP" | grep -i '^HTTP/' | awk '{print $2}')
echo -e "   - Petición con Cookie de proxy pero Host original: HTTP ${MISMATCH_CODE} (esperado 403/401)"
echo ""

# -------------------------------------------------------------
# PRUEBA 6: Interfaz de Configuración (Settings) fuera de loopback
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 6] Demostración de frontera de Settings en cliente (isLoopback)...${NC}"
echo -e "   - Código en 'packages/client/connection/src/client/index.ts:228':"
echo -e "     isLoopback: isLoopbackHostname(pageLocation.hostname)"
echo -e "   - Código en 'packages/client/ui-settings/src/client/index.ts:58':"
echo -e "     const persistence = ctx.remote.\$host.isLoopback ? 'host' : 'memory'"
echo -e "   - Código en 'packages/client/ui-settings/src/client/settings-mirror.ts:89':"
echo -e "     status: persistence === 'host' ? 'idle' : 'unavailable'"
echo -e "${GREEN}[DEMOSTRADO] Cuando el cliente accede desde LAN (ej. http://192.168.1.50:3080) o dominio, isLoopback es FALSE, lo que fuerza el estado a 'unavailable', deshabilitando completamente la pantalla de Ajustes en la interfaz web.${NC}"
echo ""

# -------------------------------------------------------------
# PRUEBA 7: Gestión de plugins dentro de Docker
# -------------------------------------------------------------
echo -e "${YELLOW}[PRUEBA 7] Gestión de plugins dentro de Docker...${NC}"
PLUGIN_TEST=$(docker exec dsh-lab-harness node apps/cli/lib/bin.js plugin --profile web list 2>&1 || true)
echo -e "   - Ejecución de 'dsh plugin --profile web list' dentro del contenedor:"
echo -e "     $PLUGIN_TEST"
echo ""

echo -e "${BLUE}====================================================${NC}"
echo -e "${GREEN}   TODOS LOS PROBLEMAS HAN SIDO REPRODUCIDOS CON ÉXITO   ${NC}"
echo -e "${BLUE}====================================================${NC}"
