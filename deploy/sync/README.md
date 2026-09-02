# Upstream Synchronization Strategy and Operational Runbook

This document defines the maintenance model, branching strategy, conflict resolution policies, and post-synchronization validation procedures for the **DeepSeek Harness Community Fork**.

---

## 1. Overview and Core Philosophy

The DeepSeek Harness Community Fork maintains an upstream-compatible, production-ready distribution optimized for local networks (LAN), private servers, Docker containers, and reverse proxy deployments (Nginx, Caddy, Traefik).

To ensure long-term sustainability, this fork adheres strictly to the **Upstream-First Rule**:

1. **Upstream First**: Core features, bug fixes, and architectural improvements from upstream (`deepseek-ai/deepseek-harness`) are incorporated continuously.
2. **Minimal Blast Radius**: Community adaptations reside strictly in declarative overlays, containerization scripts, or isolated capability extensions. No core files are rewritten or replaced with incompatible architectures.
3. **Preserve `node_modules` Integrity**: Never apply manual patches to `node_modules`. All changes exist in source code or Cordis runtime composition.
4. **Verifiable Invariants**: Every community change must be protected by unit tests, lint gates, and end-to-end laboratory reproduction suites.

---

## 2. Branching Architecture and Topology

The repository utilizes a three-tier branch topology to isolate upstream development from community fork enhancements:

```text
                  [ upstream: deepseek-ai/deepseek-harness ]
                                      │
                         git fetch upstream master
                                      │
                                      ▼
             [ local: refs/heads/upstream-tracking ] (Pristine Mirror)
              • Tracks upstream/master verbatim.
              • Never carries local commits or manual edits.
              • Serves as the baseline for divergence checks & merge-tree simulations.
                                      │
                          git merge --no-ff
                                      │
                                      ▼
                  [ local & origin: master ] (Community Fork)
              • Retains all upstream history.
              • Houses community enhancements:
                  - docker/ (Dockerfile, entrypoint, healthcheck)
                  - deploy/ (lab, reverse-proxy, sync)
                  - LAN trust fence & reverse proxy headers (packages/client/connection)
                  - 0.0.0.0 bind & DSH_HOST/PORT resolution (packages/bundle/web-app)
                  - Package manager stability in containers (packages/boot/app-boot, apps/cli)
                  - Structured diagnostic logging for 403 & 401 rejections
```

### Git Remotes Configuration

Ensure your local repository has both remotes properly configured:

```bash
# Verify configured remotes
git remote -v

# If "upstream" is missing, add it:
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git

# Expected configuration:
# origin    https://github.com/samuelrubiodev/deepseek-harness-community.git (fetch & push)
# upstream  https://github.com/deepseek-ai/deepseek-harness.git (fetch & push)
```

---

## 3. Automated Synchronization via `scripts/sync-upstream.sh`

The repository includes a dedicated synchronization engine located at `scripts/sync-upstream.sh`. It automates the full synchronization lifecycle with safety checks, conflict simulation, and regression testing.

### Command Reference

```bash
# Display help and options
./scripts/sync-upstream.sh --help

# 1. Inspection (Dry-Run): Check incoming commits and simulate merge without modifying branches
./scripts/sync-upstream.sh --check

# 2. Fetch-Only: Update the local upstream-tracking branch without merging into master
./scripts/sync-upstream.sh --fetch-only

# 3. Standard Merge: Fetch upstream, update tracking branch, and merge into master
./scripts/sync-upstream.sh --merge

# 4. Complete Sync with Automated Post-Merge Validation:
./scripts/sync-upstream.sh --merge --run-checks
```

### Script Execution Lifecycle

```text
[ Pre-flight Check ] ──────────► Verify git working directory is clean (or --force).
        │
[ Remote & Fetch ]   ──────────► Fetch latest commits from upstream/master.
        │
[ Fast-Forward ]     ──────────► Update local upstream-tracking atomically.
        │
[ Divergence Check ] ──────────► Calculate commits ahead / behind.
        │
[ Conflict Audit ]   ──────────► Run non-destructive git merge-tree simulation.
        │
[ Merge Execution ]  ──────────► Execute git merge --no-ff into target branch.
        │
[ Verification ]     ──────────► Run automated test suite or output checklist.
```

---

## 4. Manual Synchronization Workflow

For operators who prefer executing git commands manually, follow this sequential procedure:

### Step 1: Ensure Clean Working Tree
```bash
git status
# If uncommitted work exists:
git stash push -m "pre-sync-work"
```

### Step 2: Fetch Upstream References
```bash
git fetch upstream master --tags --prune
```

### Step 3: Fast-Forward Local `upstream-tracking`
```bash
# Update ref directly without checking out
git update-ref refs/heads/upstream-tracking refs/remotes/upstream/master
```

### Step 4: Evaluate Divergence
```bash
# View incoming upstream commits
git log --oneline --no-merges master..upstream-tracking

# Check divergence counts
echo "Commits ahead: $(git rev-list --count upstream-tracking..master)"
echo "Commits behind: $(git rev-list --count master..upstream-tracking)"
```

### Step 5: Merge into `master`
```bash
git checkout master
git merge --no-ff upstream-tracking -m "sync: merge upstream changes into master ($(date +'%Y-%m-%d'))"
```

---

## 5. Conflict Resolution Matrix and Fork Invariants

When merging upstream updates, merge conflicts might occur if upstream modifies files touched by community extensions. Use the following matrix to identify community invariants:

| File / Component | Community Responsibility | Conflict Resolution Strategy |
| :--- | :--- | :--- |
| `docker/` (all files) | Community-owned infrastructure (Dockerfile, entrypoint, healthcheck, patch). | **Always preserve community version.** |
| `deploy/` (all files) | Community-owned deployment configurations (lab, reverse-proxy, sync). | **Always preserve community version.** |
| `.env.example` & `docker-compose.yml` | Declarative environment variables and production Compose orchestrator. | **Always preserve community version.** |
| `packages/bundle/web-app/src/startup.ts` | Allows `0.0.0.0` with security warning; resolves `DSH_HOST`, `DSH_PORT`, `PORT`. | Integrate upstream CLI options while preserving community environment variable fallback and `0.0.0.0` warning logic. |
| `packages/bundle/web-app/src/index.ts` | Resolves `DSH_TRUSTED_HOSTS` and LAN URL fallback in `announceReady`. | Integrate upstream changes while retaining `DSH_TRUSTED_HOSTS` deduplication and container LAN fallback. |
| `packages/client/connection/src/api-request-trust.ts` | Handles `DSH_REVERSE_PROXY`, `X-Forwarded-*` headers, and structured 403 diagnostic evaluation. | Retain `evaluateApiRequestTrust` and `reverseProxy` options. Forward upstream trust checks into the result evaluator. |
| `packages/client/connection/src/browser-auth.ts` | Supports reverse proxy authorities and structured, secret-safe 401 diagnostics. | Retain `BrowserAuth.authenticate` and `reverseProxy` authority resolution. |
| `packages/client/connection/src/rpc-host.ts` | Emits structured warnings via `ctx.logger.warn` on 403 / 401 rejection. | Retain logger warning invocations in `requestRejection`. |
| `packages/client/connection/src/client/index.ts` | Authorizes LAN hosts (`isAuthorizedHost`) to unlock Settings UI persistence. | Retain `__DSH_TRUSTED_HOSTS__` evaluation and `isLoopback` calculation for authorized LAN clients. |
| `packages/boot/app-boot/src/profile.ts` | Injects `packageManager: 'pnpm@11.7.0'` into profile `package.json`. | Retain `packageManager` in `initProfile`. |
| `apps/cli/src/plugin.ts` | Backfills missing `packageManager` and disables Corepack prompt (`COREPACK_ENABLE_DOWNLOAD_PROMPT=0`). | Retain backfill logic and environment injection before `spawnSync`. |

### Conflict Commands
```bash
# View files with merge conflicts
git diff --name-only --diff-filter=U

# After resolving conflicts in editor, stage files:
git add <resolved-file>

# Complete merge commit:
git commit

# Or abort and reset state:
git merge --abort
```

---

## 6. Post-Synchronization Verification Checklist

Immediately after a successful merge, complete the following quality gates:

```bash
# 1. Update monorepo dependencies
pnpm install

# 2. Run unit tests for all community-modified packages
pnpm exec vitest run packages/bundle/web-app packages/client/connection packages/boot/app-boot apps/cli/tests/plugin.spec.ts

# 3. Run code contracts and linter
pnpm run lint:contracts-ready

# 4. Verify documentation pairing and markdown gates
pnpm run test:docs

# 5. Execute reverse proxy laboratory automated verification suite
./deploy/lab/test-proxy.sh

# 6. Rebuild Docker image and verify healthcheck
docker compose build --no-cache
docker compose up -d
docker compose ps # Verify "(healthy)" state
```

---

## 7. Rollback and Recovery Procedures

### Scenario A: In-Progress Merge Failure
If unexpected or unmanageable conflicts arise during merge:
```bash
git merge --abort
```

### Scenario B: Post-Merge Reversion
If an upstream merge passes compilation but introduces regressions discovered later:
```bash
# Identify the pre-merge commit SHA from reflog
git reflog

# Reset master to the state immediately before the merge
git reset --hard HEAD~1

# Force-push to origin if master was already pushed (coordinate with team)
git push --force-with-lease origin master
```

### Scenario C: Container Service Rollback
If a newly built container image experiences runtime issues:
```bash
# Stop current container
docker compose down

# Rebuild from previous working tag or checkout previous commit
git checkout <last-known-good-commit>
docker compose build
docker compose up -d
```
