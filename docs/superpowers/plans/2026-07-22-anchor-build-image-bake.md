# Anchor Build Image Bake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop paying a fully-cold `anchor build` every time `just down-clean` wipes the local-dev cache volumes, by baking the compiled program into the `program-deploy` image at `docker build` time — without breaking the live bind-mount dev loop or the `anchor deploy`/codegen steps that must stay runtime-only.

**Architecture:** Bake `anchor build`'s output into `docker/local/Dockerfile.anchor`'s image (COPY `apps/on-chain-program`'s source + the fixed deploy-keypair fixture, `RUN anchor build` during image build, after the toolchain install steps so those layers stay cached). No `docker-compose.yml` changes are needed: the three named volumes already declared there (`on_chain_program_target`, `cargo_registry`, `solana_platform_tools_cache`) sit at the exact paths the image now has content at, and Docker's documented behavior — an empty named volume mounted over a path that has content in the image gets seeded from that image content on first use — means a fresh volume (e.g. right after `just down-clean`) is no longer starting from zero. `CMD` keeps running `anchor build`/`anchor deploy`/airdrop/codegen exactly as today (those need the live `surfpool` validator and must write codegen output back to the host), just against a warm seed instead of a cold one. Add a new `clean-docker` recipe for the rare "wipe genuinely everything, including the image" case, leaving the frequently-run `down-clean` as a cheap, volume-only reset.

**Tech Stack:** Docker Compose v2, Docker BuildKit, Anchor CLI 1.1.2, Cargo (rustup-installed toolchain), `just` task runner.

## Global Constraints

- Do NOT commit directly to `main` (`.claude/rules/branch-name-rule.md`). Stay on the current branch, `perf/000-anchor-build-cache-volumes` — this pivot is a continuation of the same performance work already on that branch, not a new feature; do not create a new branch.
- Commits MUST follow Conventional Commits (enforced by `.hooks/commit-msg`).
- `docker-compose.yml` currently has an unrelated, pre-existing uncommitted edit (`attach: false` on the `surfpool` service). Do not touch it and do not sweep it into this plan's commits — stage files by exact path (`git add <exact-file>`), never `git add -A`/`git add .`.
- Scope is `docker/local/Dockerfile.anchor`, `Justfile`, and the issue-analysis doc only. **No `docker-compose.yml` changes are needed** — the named volumes are already declared at the right paths; Docker's native volume-seed-from-image behavior does the rest.
- `docker-compose.e2e.yml` (CircleCI) reuses the same `Dockerfile.anchor` but fully overrides `command:` with its own inline script — verified this change is additive there (the image just arrives pre-built), no changes needed to that file or `.circleci/config.yml`.
- No unit-test framework applies — this is Docker/infra config. Verification is done by observing actual `docker compose` build/run behavior and timing on the running system, per the project's "Done Means" rule (behavior observed, not inferred).

---

## File Structure

- **Modify: `docker/local/Dockerfile.anchor`** — after the existing `WORKDIR /workspace` line and before `ENTRYPOINT`, add a `COPY` of `apps/on-chain-program`'s buildable files (`Cargo.toml`, `Cargo.lock`, `Anchor.toml`, `package.json`, `programs/`) plus the fixed deploy-keypair fixture, then a `RUN` step that seeds the keypair and runs `anchor build`. `CMD` is unchanged.
- **Modify: `Justfile`** — add a `clean-docker` recipe (`docker compose down --volumes --rmi local`) in the `Dev` group, near `down-clean`/`down`.
- **Modify: `docs/technical-related/challenges/001-program-deployment-performance-issue/001-issue-analysis.md`** — append a "Pivot: Bake `anchor build` Into the Image" section recording the discussion (why Option 2 alone wasn't enough, the design that emerged, the teardown-command split) and updated measured timings.

---

### Task 1: Bake `anchor build` into the image

**Files:**
- Modify: `docker/local/Dockerfile.anchor`

**Interfaces:**
- Produces: an image where `/workspace/apps/on-chain-program/target/deploy/game_token_wallet.so`, `/workspace/apps/on-chain-program/target/idl/game_token_wallet.json`, and `/workspace/apps/on-chain-program/target/deploy/game_token_wallet-keypair.json` (matching `docker/local/fixtures/game_token_wallet-keypair.dev.json`) already exist at image-build time.

- [ ] **Step 1: Edit the Dockerfile**

Current (lines 42-46):

```dockerfile
COPY docker/local/fixtures/deployer-keypair.dev.json /root/.config/solana/id.json

WORKDIR /workspace

ENTRYPOINT ["sh", "-c"]
```

Replace with:

```dockerfile
COPY docker/local/fixtures/deployer-keypair.dev.json /root/.config/solana/id.json

WORKDIR /workspace

# Bake `anchor build`'s compiled output into the image so a fresh
# on_chain_program_target/cargo_registry/solana_platform_tools_cache
# volume (e.g. right after `just down-clean`) gets seeded from here
# instead of starting from zero — Docker auto-copies a named volume's
# mount path from the image the first time that volume is empty. See
# docs/technical-related/challenges/001-program-deployment-performance-issue/
# 001-issue-analysis.md ("Pivot" section) for why this replaces relying on
# the cache volumes alone.
COPY apps/on-chain-program/Cargo.toml apps/on-chain-program/Cargo.lock apps/on-chain-program/Anchor.toml apps/on-chain-program/package.json apps/on-chain-program/
COPY apps/on-chain-program/programs apps/on-chain-program/programs
COPY docker/local/fixtures/game_token_wallet-keypair.dev.json docker/local/fixtures/game_token_wallet-keypair.dev.json

# Seed the fixed deploy-identity keypair before building — same reasoning
# as CMD's own seeding step below (docker/local/fixtures/README.md):
# `anchor build` mints a random keypair if
# target/deploy/<program>-keypair.json is missing, which would drift this
# image's baked program address away from
# `declare_id!`/`Anchor.toml`/`PROGRAM_ID`.
RUN mkdir -p apps/on-chain-program/target/deploy && \
    cp docker/local/fixtures/game_token_wallet-keypair.dev.json apps/on-chain-program/target/deploy/game_token_wallet-keypair.json && \
    cd apps/on-chain-program && anchor build

ENTRYPOINT ["sh", "-c"]
```

- [ ] **Step 2: Build the image and confirm `anchor build` succeeds during `docker build`**

```bash
docker compose build program-deploy
```
Expected: build completes (exit 0), and the build log shows the new `RUN mkdir -p ... && anchor build` step executing and printing Anchor's normal build output (e.g. `Compiling game_token_wallet ...`, `Finished ...`), not an error.

- [ ] **Step 3: Confirm the baked keypair matches the fixture (proves the image bakes the *correct*, reproducible program address, not a randomly-minted one)**

```bash
just down-clean
docker compose run --rm --no-deps program-deploy \
  "cat apps/on-chain-program/target/deploy/game_token_wallet-keypair.json" \
  | diff - docker/local/fixtures/game_token_wallet-keypair.dev.json
```
Expected: no diff output, exit code 0. (`just down-clean` first so the named volume at that path is empty and this run exercises Docker's seed-from-image behavior rather than reading a previous run's data.)

- [ ] **Step 4: Commit**

```bash
git add docker/local/Dockerfile.anchor
git commit -m "perf(docker): bake anchor build into program-deploy image"
```

---

### Task 2: Verify the down-clean cold-start is actually fixed

**Files:** none (verification only)

**Interfaces:**
- Consumes: the image built in Task 1; the existing named volumes in `docker-compose.yml` (unchanged).

- [ ] **Step 1: Wipe only the volumes (image from Task 1 stays cached), then bring the stack up without rebuilding**

```bash
just down-clean
docker compose up -d
docker compose ps program-deploy
```
Expected: `State` column shows `exited (0)`.

- [ ] **Step 2: Read first/last log timestamps to compute wall-clock duration**

```bash
docker compose logs -t program-deploy | head -1
docker compose logs -t program-deploy | tail -1
```
Expected: subtract first from last. Compare against the numbers already recorded in `docs/technical-related/challenges/001-program-deployment-performance-issue/001-issue-analysis.md`'s "Implementation Outcome" section (baseline cold 145s, Option-2 cold-after-fresh-volume 201s, Option-2 warm 53s). This run — fresh volumes, but a pre-baked image — should land close to the 53s warm number, not the 201s cold number. If it's not markedly faster than 201s, the seeding isn't taking effect (check `docker compose logs program-deploy` for the runtime `anchor build` step doing a full recompile instead of an incremental one).

- [ ] **Step 3: Confirm the deployed program address is still the reproducible one**

```bash
docker compose logs program-deploy | grep -i "Program Id"
```
Expected: shows `FHRNx4KK4WzMxXx7X6sK84RvKTKuDVtTGduW3eH9QN9t` (per `docker/local/fixtures/README.md` and `Anchor.toml`'s `[programs.localnet]`).

- [ ] **Step 4: Confirm codegen output correctness (unaffected by where the build cache came from)**

```bash
git status apps/on-chain-client/src/generated
```
Expected: no unexpected diff (or only an expected diff if the IDL genuinely changed).

- [ ] **Step 5: Tear down**

```bash
just down
```

No commit for this task — it's verification only.

---

### Task 3: Add `clean-docker` for a genuine full-artifact wipe

**Files:**
- Modify: `Justfile`

**Interfaces:**
- Produces: a `just clean-docker` recipe.

- [ ] **Step 1: Add the recipe**

In `Justfile`, after the existing `down:` recipe block:

```
# Stop all services in docker
[group: 'Dev']
down:
  @docker compose down
```

Add:

```

# Fully wipe local Docker artifacts for this repo: named volumes AND
# locally-built images. Use this instead of `down-clean` when you need a
# genuine from-scratch rebuild — since `anchor build` now runs at image
# build time (see docs/technical-related/challenges/
# 001-program-deployment-performance-issue/001-issue-analysis.md), a fresh
# volume alone reseeds from the still-cached image and is no longer a true
# cold build.
[group: 'Dev']
clean-docker:
  @docker compose down --volumes --rmi local
```

- [ ] **Step 2: Confirm it removes both volumes and images**

```bash
just up-build
just clean-docker
docker compose config --images | while read -r img; do
  docker image inspect "$img" >/dev/null 2>&1 && echo "STILL PRESENT: $img" || echo "removed: $img"
done
docker volume ls --filter name=game-token-wallet-v2 --format '{{.Name}}'
```
Expected: every image line prints `removed: ...`, and the volume list command prints nothing.

- [ ] **Step 3: Regression check — a fully wiped state still rebuilds and runs correctly**

```bash
just up-build
docker compose ps program-deploy
```
Expected: `State` shows `exited (0)` — proves `clean-docker`'s deeper wipe doesn't leave the stack unable to rebuild from nothing.

```bash
just down
```

- [ ] **Step 4: Commit**

```bash
git add Justfile
git commit -m "chore(justfile): add clean-docker recipe for full artifact teardown"
```

---

### Task 4: Document the pivot decision and outcome

**Files:**
- Modify: `docs/technical-related/challenges/001-program-deployment-performance-issue/001-issue-analysis.md`

- [ ] **Step 1: Append a "Pivot" section**

Add to the end of the file:

```markdown
## Pivot: Bake `anchor build` Into the Image

After shipping Option 2, observed that `just down-clean` (`docker compose down --volumes`) — which wipes the three cache volumes — is triggered more often in practice than `apps/on-chain-program` source actually changes. That flips the trade-off Option 1 was rejected on: paying a rebuild on every source edit (rare here) is cheaper than paying a cold compile on every `down-clean` (frequent here).

Plain Option 1 (bake `anchor build` into the image, stop) still doesn't work as stated: `anchor deploy`, the airdrop steps, `pnpm install`, and codegen (`pnpm --filter on-chain-client run codegen`, whose output must land on the host) all require the live `surfpool` validator and must stay in `CMD` — they can't move to `docker build` time. And the `.:/workspace` bind mount is still required for those, not just for editing program source live.

The design that resolves both: bake only the `anchor build` *compile* step into the image (`COPY` the on-chain-program source + fixed deploy keypair fixture, `RUN anchor build` in `Dockerfile.anchor`). Leave `docker-compose.yml` untouched — `on_chain_program_target`, `cargo_registry`, and `solana_platform_tools_cache` are already named volumes mounted at the exact paths the image now has content at, and Docker's documented behavior (an empty named volume mounted over a path that has content in the image gets seeded from that image content on first use) means a fresh volume after `down-clean` is no longer cold. `CMD` still runs `anchor build` before `anchor deploy` exactly as before — required anyway since deploy must run at runtime — so it's now a fast incremental compile off a warm seed, and the live bind-mount dev loop is preserved as a side effect rather than the goal.

Teardown was split in two, since making `down-clean` also blow away the image would just relocate the "frequent cold build" problem it wiped out: `down-clean` stays a cheap, volume-only reset (`docker compose down --volumes`); a new `clean-docker` recipe (`docker compose down --volumes --rmi local`) covers the rare "wipe genuinely everything, including the image" case. `docker builder prune` (BuildKit's layer cache) was deliberately left out of `clean-docker` — it's host-wide, not scoped to this repo, and would clear build cache for unrelated projects on the same machine.

Verified compatible with CI's `docker-compose.e2e.yml`: it reuses the same `Dockerfile.anchor` but fully overrides `command:`, so the image simply arrives with `anchor build` already done — no CI changes needed.

Measured (`docker compose logs -t program-deploy`, first-to-last log line timestamp):
- Baseline (pre-Option-2, cold): 145s
- Option 2, cold (fresh volumes, pre-image-bake): 201s
- Option 2, warm (same volumes): 53s
- Post-pivot, fresh volumes + pre-baked image (the `down-clean` case this pivot targets): <fill in from Task 2, Step 2>
```

- [ ] **Step 2: Fill in the measured number from Task 2**

Replace `<fill in from Task 2, Step 2>` with the actual duration recorded in Task 2, Step 2.

- [ ] **Step 3: Commit**

```bash
git add docs/technical-related/challenges/001-program-deployment-performance-issue/001-issue-analysis.md
git commit -m "docs: record anchor-build-image-bake pivot decision and outcome"
```

---

## Self-Review

- **Spec coverage:** Bake `anchor build` into the image while keeping `anchor deploy`/codegen/airdrop runtime-only — Task 1. Prove the actual pain point (cold build after `down-clean`) is fixed, plus correctness (program address, codegen) — Task 2. New `clean-docker` teardown command, scoped without `docker builder prune` — Task 3. Decision record per the user's global CLAUDE.md "always document decisions" rule — Task 4.
- **Placeholder scan:** Task 4's outcome section intentionally has one `<fill in from Task 2, Step 2>` placeholder, filled in during Task 4 execution using the real number measured in Task 2 — not left as a TODO in the final commit.
- **Type consistency:** Volume names (`on_chain_program_target`, `cargo_registry`, `solana_platform_tools_cache`), the program address (`FHRNx4KK4WzMxXx7X6sK84RvKTKuDVtTGduW3eH9QN9t`), and file paths (`docker/local/fixtures/game_token_wallet-keypair.dev.json`, `apps/on-chain-program/target/deploy/game_token_wallet-keypair.json`) match across Task 1 and Task 2 exactly as they appear in the existing `Dockerfile.anchor`/`Justfile`/`docker-compose.yml`.
