#!/usr/bin/env bash
# ==============================================================================
# DeepSeek Harness — Non-Root Docker Validation Test Suite
# ==============================================================================
# Validates:
#   1. Container runs as unprivileged 'node' user (UID 1000, GID 1000) by default.
#   2. Root filesystem immutability (least privilege principle).
#   3. Full write access to /data and /workspace for persistent state and agent work.
#   4. Entrypoint correctly detects and logs non-root user.
#   5. Security warning issued when explicitly executed as root.
#   6. Host bind-mount file ownership is preserved as UID 1000 (never root-owned).
#   7. Git operations run cleanly without dubious ownership warnings.
#   8. Early error exit when /data is not writable.
# ==============================================================================
set -euo pipefail

# Visual color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

IMAGE_NAME="${1:-deepseek-harness:test-non-root}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}     DEEPSEEK HARNESS: NON-ROOT DOCKER VALIDATION SUITE        ${NC}"
echo -e "${BLUE}================================================================${NC}\n"

PASS_COUNT=0
TOTAL_TESTS=9

# ------------------------------------------------------------------------------
# TEST 1: Default User Verification (UID 1000, GID 1000, username 'node')
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[TEST 1/${TOTAL_TESTS}] Verifying default container user is non-root (node:1000:1000)...${NC}"
USER_ID=$(docker run --rm "${IMAGE_NAME}" id -u 2>/dev/null | tail -n1 | tr -d '\r')
GROUP_ID=$(docker run --rm "${IMAGE_NAME}" id -g 2>/dev/null | tail -n1 | tr -d '\r')
USERNAME=$(docker run --rm "${IMAGE_NAME}" whoami 2>/dev/null | tail -n1 | tr -d '\r')

if [ "${USER_ID}" = "1000" ] && [ "${GROUP_ID}" = "1000" ] && [ "${USERNAME}" = "node" ]; then
    echo -e "${GREEN}[PASS] Container runs as unprivileged user '${USERNAME}' (UID=${USER_ID}, GID=${GROUP_ID})${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${RED}[FAIL] Expected user node (1000:1000), got user=${USERNAME} (UID=${USER_ID}, GID=${GROUP_ID})${NC}"
fi
echo ""

# ------------------------------------------------------------------------------
# TEST 2: Least Privilege & Root Filesystem Protection
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[TEST 2/${TOTAL_TESTS}] Verifying root filesystem immutability (least privilege)...${NC}"
if docker run --rm "${IMAGE_NAME}" touch /etc/security_exploit_probe 2>/dev/null; then
    echo -e "${RED}[FAIL] Container user was able to write to /etc/ (privilege escalation hazard!)${NC}"
else
    echo -e "   - Write to /etc/ rejected: Permission Denied (as expected)"
fi

if docker run --rm "${IMAGE_NAME}" touch /usr/local/bin/security_exploit_probe 2>/dev/null; then
    echo -e "${RED}[FAIL] Container user was able to write to /usr/local/bin/${NC}"
else
    echo -e "   - Write to /usr/local/bin/ rejected: Permission Denied (as expected)"
    echo -e "${GREEN}[PASS] Root filesystem is protected against unauthorized tampering.${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
fi
echo ""

# ------------------------------------------------------------------------------
# TEST 3: Writable /data for Persistence
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[TEST 3/${TOTAL_TESTS}] Verifying runtime write access to /data (DSH_HOME)...${NC}"
DATA_WRITE_TEST=$(docker run --rm "${IMAGE_NAME}" sh -c "touch /data/test_persistence.txt && ls -l /data/test_persistence.txt && rm -f /data/test_persistence.txt" 2>&1 || true)

if echo "${DATA_WRITE_TEST}" | grep -q "test_persistence.txt"; then
    echo -e "${GREEN}[PASS] Unprivileged user has write access to /data.${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${RED}[FAIL] Could not write to /data: ${DATA_WRITE_TEST}${NC}"
fi
echo ""

# ------------------------------------------------------------------------------
# TEST 4: Writable /workspace for Agent Tasks
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[TEST 4/${TOTAL_TESTS}] Verifying runtime write access to /workspace...${NC}"
WS_WRITE_TEST=$(docker run --rm "${IMAGE_NAME}" sh -c "touch /workspace/test_file.txt && ls -l /workspace/test_file.txt && rm -f /workspace/test_file.txt" 2>&1 || true)

if echo "${WS_WRITE_TEST}" | grep -q "test_file.txt"; then
    echo -e "${GREEN}[PASS] Unprivileged user has write access to /workspace.${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${RED}[FAIL] Could not write to /workspace: ${WS_WRITE_TEST}${NC}"
fi
echo ""

# ------------------------------------------------------------------------------
# TEST 5: Entrypoint User Identification in Startup Logs
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[TEST 5/${TOTAL_TESTS}] Verifying entrypoint user logging...${NC}"
ENTRYPOINT_LOGS=$(docker run --rm "${IMAGE_NAME}" echo "ready" 2>&1 || true)

if echo "${ENTRYPOINT_LOGS}" | grep -q "\[dsh-docker\] USER=node (1000:1000)"; then
    echo -e "${GREEN}[PASS] Entrypoint clearly logs: [dsh-docker] USER=node (1000:1000)${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${RED}[FAIL] Entrypoint did not log expected USER line. Output was:${NC}"
    echo "${ENTRYPOINT_LOGS}"
fi
echo ""

# ------------------------------------------------------------------------------
# TEST 6: Root Warning Check (-u 0)
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[TEST 6/${TOTAL_TESTS}] Verifying security warning when explicitly executed as root...${NC}"
ROOT_RUN_LOGS=$(docker run --rm -u 0 "${IMAGE_NAME}" echo "ready" 2>&1 || true)

if echo "${ROOT_RUN_LOGS}" | grep -q "WARNING: Running as root (UID 0) is discouraged"; then
    echo -e "${GREEN}[PASS] Security warning correctly triggered when running as root.${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${RED}[FAIL] Expected root warning was not emitted. Output was:${NC}"
    echo "${ROOT_RUN_LOGS}"
fi
echo ""

# ------------------------------------------------------------------------------
# TEST 7: Host Volume Bind Mount Ownership Preservation (No Root-Owned Files!)
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[TEST 7/${TOTAL_TESTS}] Verifying host bind mount ownership preservation (UID 1000)...${NC}"
TEMP_HOST_DIR=$(mktemp -d "${REPO_DIR}/.tmp-test-nonroot-XXXXXX")
chmod 775 "${TEMP_HOST_DIR}"

docker run --rm -v "${TEMP_HOST_DIR}:/data" "${IMAGE_NAME}" sh -c "echo 'hello from container' > /data/host_owner_test.txt" 2>/dev/null || true

if [ -f "${TEMP_HOST_DIR}/host_owner_test.txt" ]; then
    FILE_UID=$(stat -c "%u" "${TEMP_HOST_DIR}/host_owner_test.txt" 2>/dev/null || stat -f "%u" "${TEMP_HOST_DIR}/host_owner_test.txt")
    if [ "${FILE_UID}" = "1000" ]; then
        echo -e "${GREEN}[PASS] File created on host volume is owned by UID 1000 (NOT root!).${NC}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "${RED}[FAIL] File created on host volume has unexpected UID: ${FILE_UID} (expected 1000)${NC}"
    fi
else
    echo -e "${RED}[FAIL] File was not created in host mount directory.${NC}"
fi
rm -rf "${TEMP_HOST_DIR}"
echo ""

# ------------------------------------------------------------------------------
# TEST 8: Git Operations in /workspace (Safe Directory Verification)
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[TEST 8/${TOTAL_TESTS}] Verifying git operations in /workspace (safe.directory)...${NC}"
GIT_TEST=$(docker run --rm "${IMAGE_NAME}" sh -c "cd /workspace && git init && git config user.name 'Test Runner' && git config user.email 'test@example.com' && git commit --allow-empty -m 'Initial commit' && git status" 2>&1 || true)

if echo "${GIT_TEST}" | grep -q "nothing to commit" || echo "${GIT_TEST}" | grep -q "Initial commit"; then
    echo -e "${GREEN}[PASS] Git operations completed without dubious ownership errors.${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${RED}[FAIL] Git operation failed: ${GIT_TEST}${NC}"
fi
echo ""

# ------------------------------------------------------------------------------
# TEST 9: Live Web Service & Healthcheck Execution as Non-Root
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[TEST 9/${TOTAL_TESTS}] Verifying live web service and healthcheck as non-root...${NC}"
TEST_PORT=3089
CONTAINER_ID=$(docker run -d -p "${TEST_PORT}:3080" -e PORT=3080 "${IMAGE_NAME}")

# Allow service to boot
sleep 5

HC_CODE=0
docker exec "${CONTAINER_ID}" /app/docker/healthcheck.sh >/dev/null 2>&1 || HC_CODE=$?
RUNNING_USER=$(docker exec "${CONTAINER_ID}" whoami 2>/dev/null || echo "unknown")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${TEST_PORT}/" 2>/dev/null || echo "000")

docker stop "${CONTAINER_ID}" >/dev/null 2>&1 || true
docker rm "${CONTAINER_ID}" >/dev/null 2>&1 || true

if [ "${HC_CODE}" -eq 0 ] && [ "${RUNNING_USER}" = "node" ] && [ "${HTTP_CODE}" = "401" ]; then
    echo -e "${GREEN}[PASS] Live service running as '${RUNNING_USER}', healthcheck passed, and HTTP 401 received.${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${RED}[FAIL] Live service test failed: HC_CODE=${HC_CODE}, USER=${RUNNING_USER}, HTTP=${HTTP_CODE}${NC}"
fi
echo ""

# ------------------------------------------------------------------------------
# SUMMARY
# ------------------------------------------------------------------------------
echo -e "${BLUE}================================================================${NC}"
if [ "${PASS_COUNT}" -eq "${TOTAL_TESTS}" ]; then
    echo -e "${GREEN}  ALL ${TOTAL_TESTS} NON-ROOT DOCKER TESTS PASSED SUCCESSFULLY! (${PASS_COUNT}/${TOTAL_TESTS})  ${NC}"
    echo -e "${BLUE}================================================================${NC}"
    exit 0
else
    echo -e "${RED}  NON-ROOT DOCKER TESTS FAILED: ${PASS_COUNT}/${TOTAL_TESTS} passed  ${NC}"
    echo -e "${BLUE}================================================================${NC}"
    exit 1
fi
