# Task 11 Log: CircleCI pipeline

## Task Context

### Plan Section
## Task 11: CircleCI pipeline

**Files:**
- Create: `.circleci/config.yml`

**Interfaces:**
- Consumes: `pnpm lint`/`pnpm typecheck` (Task 1), `cargo test` (Task 2), `pnpm --filter frontend run test` (Task 6), `anchor test` (Task 4), `docker-compose.e2e.yml` (Task 10).

- [ ] **Step 1: Write the CircleCI config**

`.circleci/config.yml`:
```yaml
version: 2.1

jobs:
  lint:
    docker:
      - image: cimg/node:24.18
    steps:
      - checkout
      - run: corepack enable && corepack prepare pnpm@11.15.1 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  typecheck:
    docker:
      - image: cimg/node:24.18
    steps:
      - checkout
      - run: corepack enable && corepack prepare pnpm@11.15.1 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  web-unit-tests:
    docker:
      - image: cimg/node:24.18
    steps:
      - checkout
      - run: corepack enable && corepack prepare pnpm@11.15.1 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter frontend run test

  cargo-test:
    docker:
      - image: cimg/base:current
    steps:
      - checkout
      - run: curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
      - run:
          command: |
            echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"' >> "$BASH_ENV"
      - run:
          working_directory: apps/on-chain-program
          command: cargo test

  on-chain-program-e2e:
    machine:
      image: ubuntu-2404:current
    steps:
      - checkout
      - run: curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
      - run:
          command: |
            echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"' >> "$BASH_ENV"
      - run: corepack enable && corepack prepare pnpm@11.15.1 --activate
      - run: pnpm install --frozen-lockfile
      - run: solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
      - run:
          working_directory: apps/on-chain-program
          command: anchor test

  e2e:
    machine:
      image: ubuntu-2404:current
    steps:
      - checkout
      - run: docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e

workflows:
  ci:
    jobs:
      - lint
      - typecheck
      - web-unit-tests
      - cargo-test
      - on-chain-program-e2e
      - e2e
```

- [ ] **Step 2: Validate the config syntax**

Run: `circleci config validate` (if the CircleCI CLI is installed locally) or paste into CircleCI's web config editor.
Expected: "Config is valid."
**Blocker to name explicitly if you don't have the CLI or a CircleCI project connected yet:** you cannot observe an actual green pipeline run without pushing to a branch CircleCI is watching — say so rather than claiming CI passes.

- [ ] **Step 3: Commit**

```bash
git add .circleci/config.yml
git commit -m "ci: add CircleCI pipeline (lint, typecheck, cargo test, e2e suites)"
```

### Acceptance Criteria
- AC-1: `.circleci/config.yml` created with six jobs (`lint`, `typecheck`, `web-unit-tests`, `cargo-test`, `on-chain-program-e2e`, `e2e`) wired into a `ci` workflow.
- AC-2: Config passes `circleci config validate` (or documented manual review if CLI unavailable).
- AC-3: Committed with message `ci: add CircleCI pipeline (lint, typecheck, cargo test, e2e suites)`.

### Orchestrator-mandated deviations from the plan's literal text
1. Anchor/Solana toolchain install for `cargo-test` and `on-chain-program-e2e` jobs must use the verified-working sequence from `docker/local/Dockerfile.anchor` (Task 9), NOT the plan's literal `curl ... solana-install.solana.workers.dev | bash` one-liner and NOT a bare `avm install latest`:
   ```
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
   export PATH="$HOME/.cargo/bin:$PATH"
   sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
   cargo install --git https://github.com/solana-foundation/anchor --tag v1.1.2 avm --locked
   export PATH="$HOME/.avm/bin:$PATH"
   avm install 1.1.2 && avm use 1.1.2
   ```
2. glibc: anchor-cli 1.1.2 prebuilt binary requires GLIBC_2.39+. Must verify `cimg/base:current` and `ubuntu-2404` machine image are Ubuntu 24.04-based (glibc 2.39) rather than assume it blindly.
3. `e2e` job command stays as literally written in the plan — the Task 10 fix for early teardown lives in `docker-compose.e2e.yml`, not the CI job.
4. No `PROGRAM_ID` needs hardcoding in the CI config; don't reintroduce a stale placeholder.
5. `pnpm`-via-corepack PATH-shadowing issue is a local-dev-machine-only problem (pre-existing Homebrew pnpm) — do not add CI-config workarounds for it.

---

## Attempt 1 — 2026-07-21T21:08:01+08:00

### Implementation Plan
- Read `docker/local/Dockerfile.anchor` and `docker-compose.e2e.yml` on disk to confirm the exact Task 9/10 install sequence and `e2e` teardown fix location.
- Read root `package.json` to confirm `packageManager: "pnpm@11.15.1"` is already set (plan's corepack assumption holds).
- Research glibc coverage for `cimg/base:current` and `ubuntu-2404` machine images (web search) rather than assume it silently.
- Write `.circleci/config.yml` with six jobs, factoring the shared Anchor/Solana install sequence into a reusable `commands.install_anchor_toolchain` block (CircleCI 2.1 native construct) used by `cargo-test` and `on-chain-program-e2e`.
- Validate with `circleci config validate` (CLI was present locally) and a Python/PyYAML structural sanity check.
- Commit.

### Files Changed
- created `.circleci/config.yml` — CircleCI 2.1 pipeline config: `lint`, `typecheck`, `web-unit-tests`, `cargo-test`, `on-chain-program-e2e`, `e2e` jobs in a single `ci` workflow.

### New Tests
(none — this task only writes CI config, no application code)

### Key Decisions
- Factored the 6-command Anchor/Solana toolchain install (Rust → Solana CLI → avm via `cargo install` → `avm install 1.1.2 && avm use 1.1.2`) into a reusable `commands.install_anchor_toolchain` block shared by `cargo-test` and `on-chain-program-e2e`, rather than duplicating it — avoids the two jobs drifting out of sync on a future toolchain bump.
- Applied the full verified install sequence to `cargo-test` as well as `on-chain-program-e2e`, even though `cargo test` on `apps/on-chain-program`'s Rust unit tests likely only strictly needs `rustc`/`cargo` (anchor-lang is a plain crates.io dependency, no anchor-cli binary required for pure unit tests). Did this per explicit orchestrator instruction to bake the confirmed-working sequence into both jobs, and because it costs only CI minutes, not correctness, to have it present.
- Left the `e2e` job's `run` command byte-for-byte identical to the plan (`docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e`) — confirmed by reading `docker-compose.e2e.yml` that the Task 10 fix (long-running `program-deploy` + healthcheck marker instead of `service_completed_successfully`) lives entirely at the compose-file level, so no CI-job-level change was needed.
- Used PATH-via-`$BASH_ENV` appends (not inline `export` in the same step) between install steps, matching CircleCI's documented model that each `run` step is a fresh shell — required for `cargo install avm` to see cargo on PATH, etc.
- Did not add any local-machine PATH-shadowing workaround for pnpm/corepack — confirmed via `package.json` that `packageManager: "pnpm@11.15.1"` is already set; the earlier local PATH-shadowing issue (pre-existing Homebrew pnpm) is specific to this dev machine and won't exist on a clean `cimg/node:24.18` CI image.
- No `PROGRAM_ID` hardcoded anywhere in this file — confirmed via a PyYAML structural dump that it's absent; it's only needed by `docker-compose.e2e.yml` (already baked in from Task 10) and `Anchor.toml`/`declare_id!` (Task 4 territory), not by any CircleCI job in this file.

### glibc verification (Point 2)
- `ubuntu-2404` machine image: name itself pins Ubuntu 24.04 (ships glibc 2.39) — high confidence, no doubt flagged.
- `cimg/base:current`: web research (discuss.circleci.com thread "Convenience image cimg/node uses 2 year old Ubuntu 22 base", CircleCI-Public/cimg-base repo) shows CircleCI migrated `cimg/base`/`cimg/node` base images from Ubuntu 22.04 to Ubuntu 24.04.2 LTS as of ~June 2025. Given the current date in this session is 2026-07-21 (>1 year after that migration), `cimg/base:current` is very likely Ubuntu 24.04-based (glibc 2.39+) by now. Residual risk: `:current` is a moving tag with no hard version pin, so this is reasoned confidence, not a verified fact at the exact moment any given CI run executes — flagged as a minor risk in the report, not silently assumed.

### Lint Output
n/a — no linter applies to `.circleci/config.yml`; used `circleci config validate` (schema/syntax validator) instead. PASS: "Config file at .circleci/config.yml is valid."

### Test Output
PASS — `circleci config validate .circleci/config.yml` → "Config file at .circleci/config.yml is valid." Additionally verified via PyYAML that all six jobs are present, correctly wired into the `ci` workflow's job list, and the `install_anchor_toolchain` reusable command resolves. No live CircleCI pipeline run was observed (no CircleCI project connected to this repo/branch) — this is a named blocker, not a passing/failing result.

### Commit
`023465f`

### Outcome: success
