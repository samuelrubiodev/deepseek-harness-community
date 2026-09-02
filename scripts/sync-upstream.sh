#!/usr/bin/env bash
# ==============================================================================
# DeepSeek Harness Community Fork - Upstream Synchronization Script
# ==============================================================================
# Automates synchronization between official upstream repository and fork branches.
# Maintains a dedicated upstream-tracking branch and merges upstream updates cleanly
# into the target fork branch with conflict detection and pre/post-sync checks.
# ==============================================================================

set -euo pipefail

# ANSI color codes for readable output
if [[ -t 1 ]]; then
  BOLD="\033[1m"
  GREEN="\033[0;32m"
  YELLOW="\033[0;33m"
  RED="\033[0;31m"
  BLUE="\033[0;34m"
  CYAN="\033[0;36m"
  RESET="\033[0m"
else
  BOLD=""
  GREEN=""
  YELLOW=""
  RED=""
  BLUE=""
  CYAN=""
  RESET=""
fi

log_info() {
  echo -e "${BLUE}[INFO]${RESET} $*"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${RESET} ${BOLD}$*${RESET}"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${RESET} $*"
}

log_error() {
  echo -e "${RED}[ERROR]${RESET} ${BOLD}$*${RESET}" >&2
}

log_step() {
  echo -e "\n${CYAN}${BOLD}==>${RESET} ${BOLD}$*${RESET}"
}

# Default configuration values
DEFAULT_UPSTREAM_URL="https://github.com/deepseek-ai/deepseek-harness.git"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="master"
TARGET_BRANCH="master"
TRACKING_BRANCH="upstream-tracking"
MODE="merge" # Options: merge, check, fetch-only
AUTO_RUN_CHECKS=false
FORCE=false

show_help() {
  cat << EOF
DeepSeek Harness Community Fork - Upstream Sync Tool

Usage:
  $(basename "$0") [options]

Modes:
  -c, --check, --dry-run   Check divergence and simulate merge without modifying branches
  -m, --merge              Fetch upstream, update tracking branch, and merge into target (default)
      --fetch-only         Fetch upstream and update tracking branch, but do not merge

Options:
  --remote <name>          Upstream remote name (default: "${UPSTREAM_REMOTE}")
  --upstream-branch <name> Upstream branch to track (default: "${UPSTREAM_BRANCH}")
  --target-branch <name>   Local target branch to merge into (default: "${TARGET_BRANCH}")
  --tracking-branch <name> Dedicated upstream tracking branch (default: "${TRACKING_BRANCH}")
  --run-checks             Automatically execute post-merge validation suite upon success
  --force                  Bypass working directory clean check (use with caution)
  -h, --help               Show this help message and exit

Workflow:
  1. Validates that the git working directory is clean.
  2. Ensures the upstream remote (${UPSTREAM_REMOTE}) is configured.
  3. Fetches latest commits from ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}.
  4. Updates the local ${TRACKING_BRANCH} branch cleanly (fast-forward).
  5. Evaluates divergence (commits ahead/behind) and simulates conflict detection.
  6. Merges ${TRACKING_BRANCH} into ${TARGET_BRANCH} with a structured commit message.
  7. Provides actionable post-sync validation checklist or runs checks automatically.

Examples:
  # Check for new upstream commits without applying changes
  $(basename "$0") --check

  # Synchronize master branch with upstream and run validation checks
  $(basename "$0") --merge --run-checks

  # Fetch upstream commits and update upstream-tracking branch only
  $(basename "$0") --fetch-only

EOF
}

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      exit 0
      ;;
    -c|--check|--dry-run)
      MODE="check"
      shift
      ;;
    -m|--merge)
      MODE="merge"
      shift
      ;;
    --fetch-only)
      MODE="fetch-only"
      shift
      ;;
    --run-checks)
      AUTO_RUN_CHECKS=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --remote)
      UPSTREAM_REMOTE="$2"
      shift 2
      ;;
    --upstream-branch)
      UPSTREAM_BRANCH="$2"
      shift 2
      ;;
    --target-branch)
      TARGET_BRANCH="$2"
      shift 2
      ;;
    --tracking-branch)
      TRACKING_BRANCH="$2"
      shift 2
      ;;
    *)
      log_error "Unknown option: $1"
      echo "Run '$(basename "$0") --help' for usage."
      exit 1
      ;;
  esac
done

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$REPO_ROOT" ]]; then
  log_error "Not inside a git repository."
  exit 1
fi
cd "$REPO_ROOT"

log_step "Pre-flight Verification"

# Check working tree status
DIRTY_FILES=$(git status --porcelain)
if [[ -n "$DIRTY_FILES" ]]; then
  if [[ "$FORCE" == "true" ]]; then
    log_warn "Working directory has uncommitted changes, but --force was provided."
  else
    log_error "Working directory is not clean. Please commit or stash your changes before syncing:"
    git status -s
    echo -e "\nTip: To stash changes: ${BOLD}git stash${RESET} (restore later with ${BOLD}git stash pop${RESET})"
    exit 1
  fi
else
  log_info "Working directory is clean."
fi

# Ensure upstream remote is configured
if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  log_warn "Remote '${UPSTREAM_REMOTE}' not found. Adding default upstream URL: ${DEFAULT_UPSTREAM_URL}"
  git remote add "$UPSTREAM_REMOTE" "$DEFAULT_UPSTREAM_URL"
  log_info "Added remote '${UPSTREAM_REMOTE}' -> ${DEFAULT_UPSTREAM_URL}"
fi

UPSTREAM_FETCH_URL=$(git remote get-url "$UPSTREAM_REMOTE")
log_info "Upstream remote: ${BOLD}${UPSTREAM_REMOTE}${RESET} (${UPSTREAM_FETCH_URL})"
log_info "Target branch:   ${BOLD}${TARGET_BRANCH}${RESET}"
log_info "Tracking branch: ${BOLD}${TRACKING_BRANCH}${RESET}"
log_info "Sync mode:       ${BOLD}${MODE}${RESET}"

# Fetch from upstream
log_step "Fetching from ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH" --tags --prune
log_success "Fetched latest references from ${UPSTREAM_REMOTE}"

# Ensure local tracking branch exists and is updated to upstream/master
if ! git rev-parse --verify --quiet "refs/heads/${TRACKING_BRANCH}" >/dev/null 2>&1; then
  log_info "Creating local tracking branch '${TRACKING_BRANCH}' pointing to '${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}'..."
  git branch "$TRACKING_BRANCH" "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
else
  log_info "Updating local tracking branch '${TRACKING_BRANCH}' (fast-forward)..."
  git update-ref "refs/heads/${TRACKING_BRANCH}" "refs/remotes/${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
fi

# Divergence calculation
COMMITS_BEHIND=$(git rev-list --count "${TARGET_BRANCH}..${TRACKING_BRANCH}")
COMMITS_AHEAD=$(git rev-list --count "${TRACKING_BRANCH}..${TARGET_BRANCH}")
UPSTREAM_HEAD_SHA=$(git rev-parse --short "${TRACKING_BRANCH}")
TARGET_HEAD_SHA=$(git rev-parse --short "${TARGET_BRANCH}")

echo ""
echo -e "${BOLD}Divergence Summary:${RESET}"
echo -e "  - ${BOLD}${TARGET_BRANCH}${RESET} (HEAD: ${TARGET_HEAD_SHA}) is ${GREEN}${COMMITS_AHEAD}${RESET} commit(s) ahead of upstream."
echo -e "  - ${BOLD}${TARGET_BRANCH}${RESET} is ${YELLOW}${COMMITS_BEHIND}${RESET} commit(s) behind upstream (${UPSTREAM_HEAD_SHA})."

if [[ "$COMMITS_BEHIND" -gt 0 ]]; then
  echo ""
  echo -e "${BOLD}Incoming Upstream Commits:${RESET}"
  git log --oneline --no-merges -n 10 "${TARGET_BRANCH}..${TRACKING_BRANCH}" | sed 's/^/    /'
  if [[ "$COMMITS_BEHIND" -gt 10 ]]; then
    echo "    ... and $((COMMITS_BEHIND - 10)) more commit(s)."
  fi
fi

# Conflict simulation using git merge-tree
log_step "Simulating Merge & Conflict Detection"
if [[ "$COMMITS_BEHIND" -eq 0 ]]; then
  log_success "Target branch '${TARGET_BRANCH}' is already fully up to date with upstream."
else
  # Run non-destructive merge simulation
  SIMULATION_ERR=0
  SIM_OUTPUT=$(git merge-tree --write-tree "$TARGET_BRANCH" "$TRACKING_BRANCH" 2>&1) || SIMULATION_ERR=$?

  if [[ $SIMULATION_ERR -eq 0 ]]; then
    log_success "Simulation result: CLEAN MERGE. No conflicts anticipated."
  else
    log_warn "Simulation result: POTENTIAL CONFLICTS DETECTED."
    echo "$SIM_OUTPUT" | head -n 20 | sed 's/^/  /'
  fi
fi

# Handle modes
if [[ "$MODE" == "check" ]]; then
  log_step "Check Complete (Dry-Run Mode)"
  if [[ "$COMMITS_BEHIND" -eq 0 ]]; then
    log_success "No upstream updates pending. Fork is up to date."
    exit 0
  else
    log_info "There are ${COMMITS_BEHIND} upstream commit(s) ready to be merged."
    echo -e "To merge these changes, run: ${BOLD}$(basename "$0") --merge${RESET}"
    exit 0
  fi
fi

if [[ "$MODE" == "fetch-only" ]]; then
  log_step "Fetch-Only Complete"
  log_success "Tracking branch '${TRACKING_BRANCH}' has been updated to '${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}'."
  exit 0
fi

# MODE: merge
if [[ "$COMMITS_BEHIND" -eq 0 ]]; then
  log_step "Merge Step"
  log_success "No merge required. Target branch '${TARGET_BRANCH}' already incorporates all upstream commits."
  exit 0
fi

log_step "Merging Upstream Changes into ${TARGET_BRANCH}"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]]; then
  log_info "Checking out target branch '${TARGET_BRANCH}'..."
  git checkout "$TARGET_BRANCH"
fi

PRE_MERGE_SHA=$(git rev-parse HEAD)
MERGE_DATE=$(date +'%Y-%m-%d')
MERGE_MSG="sync: merge upstream changes from ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} into ${TARGET_BRANCH} (${MERGE_DATE})"

log_info "Executing git merge --no-ff '${TRACKING_BRANCH}'..."
if git merge --no-ff "$TRACKING_BRANCH" -m "$MERGE_MSG"; then
  POST_MERGE_SHA=$(git rev-parse --short HEAD)
  log_success "Merge successful! New HEAD: ${POST_MERGE_SHA}"

  echo ""
  echo -e "${BOLD}Changes integrated:${RESET}"
  git diff --stat "${PRE_MERGE_SHA}..HEAD" | tail -n 15 | sed 's/^/  /'
else
  log_error "Merge encountered conflicts!"
  echo ""
  echo -e "${BOLD}Conflicting files:${RESET}"
  git diff --name-only --diff-filter=U | sed 's/^/  - /'

  echo ""
  echo -e "${YELLOW}${BOLD}How to Resolve Conflicts:${RESET}"
  echo "  1. Review each conflict in your editor or diff tool."
  echo "  2. Remember community fork assets and invariants:"
  echo "     - docker/ and deploy/ are fork-specific directories."
  echo "     - packages/bundle/web-app/src/startup.ts (DSH_HOST, DSH_PORT, 0.0.0.0 support)."
  echo "     - packages/client/connection/ (DSH_TRUSTED_HOSTS, DSH_REVERSE_PROXY, diagnostics)."
  echo "     - packages/boot/app-boot/src/profile.ts (packageManager: pnpm@11.7.0)."
  echo "     - apps/cli/src/plugin.ts (packageManager backfill)."
  echo "  3. After resolving, stage files with:   ${BOLD}git add <file>${RESET}"
  echo "  4. Complete the merge commit with:     ${BOLD}git commit${RESET}"
  echo "  5. Or abort the merge cleanly with:    ${BOLD}git merge --abort${RESET}"
  exit 1
fi

# Run checks or print checklist
if [[ "$AUTO_RUN_CHECKS" == "true" ]]; then
  log_step "Running Post-Synchronization Validation Suite"

  log_info "1. Updating workspace dependencies (pnpm install)..."
  pnpm install

  log_info "2. Running modified packages unit tests..."
  pnpm exec vitest run packages/bundle/web-app packages/client/connection packages/boot/app-boot apps/cli/tests/plugin.spec.ts

  log_info "3. Running code linter (oxlint)..."
  pnpm run lint:contracts-ready

  log_info "4. Running documentation verification gates..."
  pnpm run test:docs

  log_success "All post-synchronization checks passed successfully!"
else
  log_step "Post-Synchronization Checklist"
  echo -e "${BOLD}Please run the following validation steps to ensure full stability:${RESET}"
  echo ""
  echo "  1. Update dependencies:"
  echo -e "     ${CYAN}pnpm install${RESET}"
  echo ""
  echo "  2. Run regression unit tests on modified packages:"
  echo -e "     ${CYAN}pnpm exec vitest run packages/bundle/web-app packages/client/connection packages/boot/app-boot apps/cli/tests/plugin.spec.ts${RESET}"
  echo ""
  echo "  3. Validate code contracts and linting:"
  echo -e "     ${CYAN}pnpm run lint:contracts-ready${RESET}"
  echo ""
  echo "  4. Check documentation consistency:"
  echo -e "     ${CYAN}pnpm run test:docs${RESET}"
  echo ""
  echo "  5. Rebuild and verify Docker container:"
  echo -e "     ${CYAN}docker compose build && docker compose up -d && docker compose ps${RESET}"
  echo ""
  echo -e "  For detailed guidance, refer to: ${BOLD}deploy/sync/README.md${RESET}"
fi

log_success "Upstream synchronization completed."
exit 0
