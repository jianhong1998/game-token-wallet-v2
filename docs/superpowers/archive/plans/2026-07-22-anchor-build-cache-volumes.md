# Anchor Build Cache Volumes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-07-22-anchor-build-cache-volumes-design.md](../specs/2026-07-22-anchor-build-cache-volumes-design.md)

**Goal:** Make the local-dev `program-deploy` Docker service's `anchor build` step incremental across `docker compose up`/`down` cycles by persisting its Cargo/Anchor build cache in named Docker volumes, instead of recompiling from scratch on every run.

**Architecture:** Add three named Docker volumes to `docker-compose.yml`'s `program-deploy` service — one for `apps/on-chain-program/target` (the Rust/Anchor build output, mounted at a sub-path of the existing `.:/workspace` bind mount so it takes precedence over the host's gitignored, non-existent `target/`), one for `/root/.cargo/registry` (downloaded crate sources — avoids re-fetching crates.io packages every run), and one for `/root/.cache/solana` (the Solana BPF/SBF `platform-tools` toolchain `cargo build-sbf` downloads on first use). No Dockerfile or CMD changes are needed — `anchor build` keeps running at container start exactly as today; only the paths it reads/writes now persist across container recreations.

**Tech Stack:** Docker Compose v2, Anchor CLI 1.1.2, Cargo (rustup-installed toolchain), `just` task runner.

## Global Constraints

- Do NOT commit directly to `main` (see `.claude/rules/branch-name-rule.md`).
- Branch naming: `<type>/<ticket_or_000>-<description>`, allowed types include `perf`. Current checked-out branch (`feat/001-repo-bootstrap-connection-utility`) is unrelated to this change — create `perf/000-anchor-build-cache-volumes` before the implementation commit (Task 2).
- Commits MUST follow Conventional Commits (enforced by `.hooks/commit-msg`).
- Scope is `docker-compose.yml` / `docker/local/Dockerfile.anchor` only (the local dev loop the user flagged as slow). `docker-compose.e2e.yml` runs the same `anchor build` but on ephemeral CI runners where Docker named volumes don't persist between separate CI job runs — out of scope, not touched by this plan.
- No application source code changes — this is Docker Compose infra config. There is no unit-test framework applicable; verification is done by observing actual `docker compose` run behavior/timing on the running system, per the project's "Done Means" rule (behavior observed, not inferred).

---

## File Structure

- **Modify: `docker-compose.yml`** — add three named volumes under `program-deploy`'s `volumes:` list and declare them in the top-level `volumes:` block. No other service needs them (only `program-deploy` runs `anchor build`).
- **Modify: `docs/technical-related/challenges/001-program-deployment-performance-issue/001-issue-analysis.md`** — append an "Implementation Outcome" section recording the volumes added and the measured before/after timings once verified.

---

### Task 1: Capture baseline (pre-change) timing

**Files:** none (measurement only)

**Interfaces:** none

- [ ] **Step 1: Reset to a clean slate**

```bash
just down-clean
```
Expected: containers and volumes for this project removed (or "No resources found" if nothing was up).

- [ ] **Step 2: Bring the stack up detached, forcing a rebuild**

```bash
docker compose up --build -d
```
Expected: exits back to shell after builds complete and containers start (detached mode). `surfpool` becomes healthy, `program-deploy` runs its `CMD` (airdrop → `anchor build` → `anchor deploy` → `pnpm codegen`) and exits 0, then `frontend` starts.

- [ ] **Step 3: Confirm program-deploy exited successfully**

```bash
docker compose ps program-deploy
```
Expected: `State` column shows `exited (0)`.

- [ ] **Step 4: Read first and last log timestamps to compute wall-clock duration**

```bash
docker compose logs -t program-deploy | head -1
docker compose logs -t program-deploy | tail -1
```
Expected: two timestamped lines (RFC3339). Subtract first from last — this is the baseline cold-build duration (expect several minutes, dominated by `anchor build`'s from-scratch Rust compile). Write this number down; Task 3 compares against it.

- [ ] **Step 5: Tear down (keep volumes off for now — Task 2 changes the compose file first)**

```bash
just down
```

No commit for this task — it's measurement only.

---

### Task 2: Add cache volumes to `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: three named Docker volumes — `on_chain_program_target`, `cargo_registry`, `solana_platform_tools_cache` — mounted into the `program-deploy` container at `/workspace/apps/on-chain-program/target`, `/root/.cargo/registry`, and `/root/.cache/solana` respectively.

- [ ] **Step 1: Create a branch matching this change**

```bash
git checkout -b perf/000-anchor-build-cache-volumes
```
Expected: `Switched to a new branch 'perf/000-anchor-build-cache-volumes'`.

- [ ] **Step 2: Edit `program-deploy`'s `volumes:` block**

In `docker-compose.yml`, the `program-deploy` service currently ends with (around line 33-52):

```yaml
    environment:
      ANCHOR_PROVIDER_URL: http://surfpool:8899
    volumes:
      - .:/workspace
      # node_modules is deliberately NOT part of the bind mount above: the
      # host (macOS/arm64) and this container (linux/amd64) both running
      # `pnpm install` against the same on-disk node_modules corrupts
      # whichever side installed second (wrong-platform native binaries —
      # e.g. lightningcss, esbuild, sharp — and, worse, a `pnpm install`
      # on either side while the frontend dev server is live crashes it
      # mid-flight). Named volumes below give each workspace package's
      # node_modules an isolated, container-only home so container and
      # host installs never touch the same files. `apps/on-chain-client/
      # src/generated` is intentionally still bind-mounted (via `.` above)
      # since Codama's codegen output must land on the host to be
      # committed to git.
      - node_modules:/workspace/node_modules
      - frontend_node_modules:/workspace/apps/frontend/node_modules
      - on_chain_program_e2e_node_modules:/workspace/apps/on-chain-program-e2e/node_modules
      - e2e_node_modules:/workspace/apps/e2e/node_modules
      - on_chain_client_node_modules:/workspace/apps/on-chain-client/node_modules
```

Replace it with:

```yaml
    environment:
      ANCHOR_PROVIDER_URL: http://surfpool:8899
    volumes:
      - .:/workspace
      # node_modules is deliberately NOT part of the bind mount above: the
      # host (macOS/arm64) and this container (linux/amd64) both running
      # `pnpm install` against the same on-disk node_modules corrupts
      # whichever side installed second (wrong-platform native binaries —
      # e.g. lightningcss, esbuild, sharp — and, worse, a `pnpm install`
      # on either side while the frontend dev server is live crashes it
      # mid-flight). Named volumes below give each workspace package's
      # node_modules an isolated, container-only home so container and
      # host installs never touch the same files. `apps/on-chain-client/
      # src/generated` is intentionally still bind-mounted (via `.` above)
      # since Codama's codegen output must land on the host to be
      # committed to git.
      - node_modules:/workspace/node_modules
      - frontend_node_modules:/workspace/apps/frontend/node_modules
      - on_chain_program_e2e_node_modules:/workspace/apps/on-chain-program-e2e/node_modules
      - e2e_node_modules:/workspace/apps/e2e/node_modules
      - on_chain_client_node_modules:/workspace/apps/on-chain-client/node_modules
      # Anchor/Cargo build cache — see docs/technical-related/challenges/
      # 001-program-deployment-performance-issue/001-issue-analysis.md.
      # `anchor build` runs at container start (in Dockerfile.anchor's CMD)
      # on every `docker compose up`, not at image build time — baking it
      # into the image doesn't work because the `.:/workspace` bind mount
      # above would immediately shadow it (apps/on-chain-program/target is
      # gitignored, so the host side is empty). Instead these three named
      # volumes persist the *build cache* across container recreations, so
      # only the first run after `down --volumes` is a cold compile.
      # Mounted at a sub-path of the `.:/workspace` bind mount above —
      # Compose overlays the more specific (longer) mount path, so this
      # takes precedence over the host's (empty) target/ dir.
      - on_chain_program_target:/workspace/apps/on-chain-program/target
      # Downloaded crate sources (crates.io registry index + package
      # cache) — avoids re-fetching every dependency on every run.
      - cargo_registry:/root/.cargo/registry
      # `cargo build-sbf` (invoked internally by `anchor build`) downloads
      # the Solana BPF/SBF `platform-tools` toolchain here on first use if
      # not already present — persisting it avoids re-downloading it every
      # run.
      - solana_platform_tools_cache:/root/.cache/solana
```

- [ ] **Step 3: Declare the new volumes in the top-level `volumes:` block**

Current top-level block (end of file):

```yaml
volumes:
  node_modules:
  frontend_node_modules:
  on_chain_program_e2e_node_modules:
  e2e_node_modules:
  on_chain_client_node_modules:
```

Replace with:

```yaml
volumes:
  node_modules:
  frontend_node_modules:
  on_chain_program_e2e_node_modules:
  e2e_node_modules:
  on_chain_client_node_modules:
  on_chain_program_target:
  cargo_registry:
  solana_platform_tools_cache:
```

- [ ] **Step 4: Validate the compose file parses**

```bash
docker compose config --quiet
```
Expected: no output, exit code 0 (Compose YAML is syntactically valid and resolves).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "perf(docker): persist anchor build cache across container runs"
```

---

### Task 3: Verify the cache actually speeds up a second run

**Files:** none (verification only)

**Interfaces:**
- Consumes: the three volumes from Task 2.

- [ ] **Step 1: Cold run on the new volumes (first run always still pays the compile cost)**

```bash
just down-clean
docker compose up --build -d
docker compose ps program-deploy
```
Expected: `program-deploy` exits 0 — same as Task 1's baseline. Confirms the new volumes don't break anything on a cold start.

- [ ] **Step 2: Record this run's duration the same way as Task 1**

```bash
docker compose logs -t program-deploy | head -1
docker compose logs -t program-deploy | tail -1
```
Expected: duration comparable to Task 1's baseline (this run is still cold — volumes were just created).

- [ ] **Step 3: Stop the stack WITHOUT removing volumes, then bring it up again**

```bash
docker compose down
docker compose up --build -d
docker compose ps program-deploy
```
Expected: `program-deploy` exits 0 again.

- [ ] **Step 4: Record the second run's duration**

```bash
docker compose logs -t program-deploy | head -1
docker compose logs -t program-deploy | tail -1
```
Expected: markedly shorter duration than Step 2/Task 1 (incremental compile — only changed crates, if any, get rebuilt; no re-download of crates or platform-tools). This is the pass/fail signal for this task: if the second run is not meaningfully faster than the first, the cache isn't being hit and Task 2 needs debugging (e.g. confirm with `docker volume ls` that `on_chain_program_target`/`cargo_registry`/`solana_platform_tools_cache` exist and are non-empty via `docker run --rm -v <volume>:/v busybox du -sh /v`).

- [ ] **Step 5: Confirm functional correctness — codegen output still lands on host**

```bash
git status apps/on-chain-client/src/generated
```
Expected: no unexpected diff (or an expected diff only if the IDL actually changed) — proves `target/idl` living in a container-only volume didn't break the in-container codegen step that writes to the bind-mounted `src/generated`.

No commit for this task — it's verification only.

---

### Task 4: Regression check — cold start from a fresh volume still works

**Files:** none (verification only)

- [ ] **Step 1: Wipe everything, including the new cache volumes**

```bash
just down-clean
```
Expected: all volumes, including the three new ones, removed.

- [ ] **Step 2: Bring the stack up once more from nothing**

```bash
docker compose up --build -d
docker compose ps program-deploy
```
Expected: `program-deploy` exits 0 — proves the new volumes are a pure performance optimization, not a hidden functional dependency (the stack still works correctly when they don't exist yet).

- [ ] **Step 3: Leave the stack running or tear down per preference**

```bash
just down
```

No commit for this task — it's verification only.

---

### Task 5: Document the outcome

**Files:**
- Modify: `docs/technical-related/challenges/001-program-deployment-performance-issue/001-issue-analysis.md`

- [ ] **Step 1: Append an "Implementation Outcome" section**

Add to the end of the file:

```markdown
## Implementation Outcome

Implemented Option 2: added three named Docker volumes to `program-deploy` in `docker-compose.yml` — `on_chain_program_target` (`/workspace/apps/on-chain-program/target`), `cargo_registry` (`/root/.cargo/registry`), `solana_platform_tools_cache` (`/root/.cache/solana`). No Dockerfile or CMD changes.

Measured (`docker compose logs -t program-deploy`, first-to-last log line timestamp):
- Baseline (pre-change, cold): <fill in from Task 1, Step 4>
- Post-change, cold (first run on fresh volumes): <fill in from Task 3, Step 2>
- Post-change, warm (second run, same volumes): <fill in from Task 3, Step 4>

Regression check (Task 4): confirmed `docker compose up --build` from a fully wiped state (`just down-clean`) still succeeds — the cache volumes are purely additive.
```

- [ ] **Step 2: Commit**

```bash
git add docs/technical-related/challenges/001-program-deployment-performance-issue/001-issue-analysis.md
git commit -m "docs: record anchor build cache volume implementation outcome"
```

---

## Self-Review

- **Spec coverage:** Option 2 (persist Cargo/Anchor build cache via named volumes, keep bind-mount dev loop) — Task 2. Baseline/comparison timing so the fix is verified, not assumed — Tasks 1 and 3. Safety check that this doesn't silently become a hard dependency — Task 4. Decision recorded per the user's global CLAUDE.md "always document decisions" rule — Task 5.
- **Placeholder scan:** Task 5's outcome section intentionally has `<fill in from Task N>` placeholders — these are filled in *during* Task 5 execution using real numbers measured in Tasks 1 and 3, not left as TODOs in the final commit.
- **Type consistency:** Volume names (`on_chain_program_target`, `cargo_registry`, `solana_platform_tools_cache`) and their mount paths are identical everywhere they appear (Task 2 Steps 2 and 3, Task 3 Step 4's debugging note).
