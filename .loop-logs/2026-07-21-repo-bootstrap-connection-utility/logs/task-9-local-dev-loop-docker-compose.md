# Task 9 Log: Local dev loop — `docker-compose.yml`

## Task Context

### Plan Section

## Task 9: Local dev loop — `docker-compose.yml`

**Files:**
- Create: `docker/local/Dockerfile.anchor`
- Create: `docker/local/Dockerfile.frontend`
- Create: `docker-compose.yml`
- Modify: `Justfile`

**Interfaces:**
- Produces: `docker compose up` — brings up `surfpool`, `program-deploy` (one-shot), `frontend`. Task 10's `docker-compose.e2e.yml` reuses `docker/local/Dockerfile.anchor` verbatim.

- [ ] **Step 1: Create the Anchor build+deploy+codegen image**

`docker/local/Dockerfile.anchor`:
```dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates build-essential pkg-config libssl-dev git \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
ENV PATH="/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:/root/.avm/bin:${PATH}"

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

RUN solana-keygen new --no-bip39-passphrase --silent --outfile /root/.config/solana/id.json

WORKDIR /workspace

ENTRYPOINT ["sh", "-c"]
CMD ["solana airdrop 10 --url \"$ANCHOR_PROVIDER_URL\" && cd apps/on-chain-program && anchor build && anchor deploy --provider.cluster \"$ANCHOR_PROVIDER_URL\" && cd ../.. && pnpm install --frozen-lockfile && pnpm --filter on-chain-client run codegen"]
```

- [ ] **Step 2: Create the frontend dev image**

`docker/local/Dockerfile.frontend`:
```dockerfile
FROM node:24.18.0-bookworm

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

WORKDIR /workspace

CMD ["sh", "-c", "pnpm install --frozen-lockfile && pnpm --filter frontend run dev"]
```

- [ ] **Step 3: Create docker-compose.yml**

`docker-compose.yml` (`PROGRAM_ID` below must match Task 2 Step 8's synced program address, and `SYSTEM_ADMIN_SECRET_KEY` is the throwaway dev key from Global Constraints):
```yaml
services:
  surfpool:
    image: surfpool/surfpool:latest
    command: ["start", "--no-tui"]
    ports:
      - "8899:8899"
      - "8900:8900"
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "curl -sf -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getHealth\"}' http://localhost:8899 || exit 1",
        ]
      interval: 2s
      timeout: 2s
      retries: 30

  program-deploy:
    build:
      context: .
      dockerfile: docker/local/Dockerfile.anchor
    depends_on:
      surfpool:
        condition: service_healthy
    environment:
      ANCHOR_PROVIDER_URL: http://surfpool:8899
    volumes:
      - .:/workspace

  frontend:
    build:
      context: .
      dockerfile: docker/local/Dockerfile.frontend
    depends_on:
      program-deploy:
        condition: service_completed_successfully
    ports:
      - "3000:3000"
    environment:
      SOLANA_CLUSTER: localnet
      SOLANA_RPC_URL: http://surfpool:8899
      PROGRAM_ID: "<paste the address from Task 2 Step 8's `anchor keys list`>"
      SYSTEM_ADMIN_SECRET_KEY: "PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis"
    volumes:
      - .:/workspace
```

- [ ] **Step 4: Add Justfile dev-up/dev-down targets**

Modify `Justfile` — add:
```
[group: 'Dev']
dev-up:
  @docker compose up --build

[group: 'Dev']
dev-down:
  @docker compose down --volumes
```

- [ ] **Step 5: Bring up the full stack**

Run: `just dev-up`
Expected: `surfpool` becomes healthy, `program-deploy` runs to completion (builds, deploys, codegens, exits 0), `frontend` starts and logs "Ready" on port 3000.

- [ ] **Step 6: Verify the real end-to-end path manually**

With the stack still running, in a second terminal:
```bash
E2E_BASE_URL=http://localhost:3000 pnpm --filter e2e run test
```
Expected: PASS — the Playwright test from Task 8 now has something real to hit.

- [ ] **Step 7: Tear down**

Run: `just dev-down`

- [ ] **Step 8: Commit**

```bash
git add docker/local docker-compose.yml Justfile
git commit -m "feat: add docker-compose local dev loop (surfpool + program deploy + frontend)"
```

### Acceptance Criteria
- AC-1: `docker compose up` brings up `surfpool`, deploys the program, boots the frontend.
- AC-2: Visiting `/` (manually or via the Playwright test) triggers the `noop` Server Action and displays a real transaction signature returned by the locally-deployed program — not just an inferred success.
- AC-3: `PROGRAM_ID` in `docker-compose.yml`'s `frontend` service uses the real synced program address `BWS4UCkFps4XUs7bqqzgNxFZ3keLUMVbb9CJUpyefNob` (Task 2 Step 8), not the plan's placeholder.
- AC-4: `docker/local/Dockerfile.anchor` is reusable verbatim by Task 10's `docker-compose.e2e.yml`.

## Attempt 1 — 2026-07-21T00:00:00Z

### Implementation Plan
- Create `docker/local/Dockerfile.anchor` and `docker/local/Dockerfile.frontend` verbatim per plan.
- Create `docker-compose.yml` verbatim per plan, substituting the real synced `PROGRAM_ID` (`BWS4UCkFps4XUs7bqqzgNxFZ3keLUMVbb9CJUpyefNob`) for the plan's placeholder.
- Append `dev-up`/`dev-down` Justfile targets.
- Pre-verified `anchor deploy --provider.cluster "$ANCHOR_PROVIDER_URL"` accepts a raw URL directly on the locally installed Anchor CLI 1.1.2 (confirmed via a throwaway local run against an unreachable port — it printed "Deploying cluster: http://127.0.0.1:19999" and attempted real RPC calls, i.e. URL parsing succeeded) — no deviation needed for that specific line, contrary to the pre-flagged risk.
- Run `just dev-up` and observe.

### Files Changed
- created `docker/local/Dockerfile.anchor` — Anchor build+deploy+codegen image (verbatim from plan)
- created `docker/local/Dockerfile.frontend` — frontend dev image (verbatim from plan)
- created `docker-compose.yml` — 3-service local dev stack, `PROGRAM_ID` set to the real synced address
- modified `Justfile` — added `dev-up`/`dev-down` recipes

### New Tests
(none — this task's verification is the live e2e Playwright run, not new unit tests)

### Key Decisions
(none yet — plan followed verbatim for this attempt)

### Lint Output
n/a — no lint-relevant files changed

### Test Output
n/a — stopped at `just dev-up` (Docker build failure), never reached the Playwright run

### Commit
n/a — retrying

### Outcome: failed — `program-deploy`'s Docker image build failed. Root cause: `docker:local/Dockerfile.anchor`'s `debian:bookworm-slim` base builds natively for `linux/arm64` on this Apple Silicon host, and neither the Solana CLI nor Anchor CLI 1.1.2 publish `linux/arm64` (aarch64) prebuilt binaries (confirmed via GitHub Releases API for both `anza-xyz/agave` and `solana-foundation/anchor` v1.1.2 — only `x86_64-unknown-linux-gnu` and macOS assets exist for Linux). The plan's `curl ... solana-install.solana.workers.dev | bash` mega-installer script tries `avm install 1.1.2` (no `--from-source`), gets an HTTP 404 for the prebuilt binary, and falls back to an interactive `[y/n]` prompt that panics (`Expected input`) since Docker `RUN` has no stdin. Even setting that aside, the same script also installs Node via NVM but never sources `~/.nvm/nvm.sh` into the Docker `RUN` shell's PATH, so the plan's later `corepack enable` step fails with exit 127 (command not found) regardless.


## Attempt 2 — 2026-07-21T00:00:00Z

### Implementation Plan
- Rework `docker/local/Dockerfile.anchor` to avoid the network mega-installer entirely: base on `node:24.18.0-trixie`, install Rust/Solana CLI/Anchor CLI explicitly, and force the `program-deploy` and `frontend` services to `platform: linux/amd64` (neither Solana CLI nor anchor-cli publish linux/arm64 prebuilt binaries).
- Iteratively resolve each failure surfaced by actually bringing the stack up (glibc mismatch, bind-mounted `node_modules` cross-platform/cross-host corruption, stale deployed-program address, unfunded admin wallet, wrong WS port) — each fix verified by re-running `just dev-up` and/or the Playwright suite, not assumed.
- Isolate `node_modules` into named Docker volumes so host (macOS/arm64) and containers (linux/amd64) never share those directories, since any concurrent `pnpm install` on either side was corrupting the other (including crashing the live Next.js dev server mid-request).
- Re-run `anchor keys sync` + rebuild once the deployed program's real address was found to have drifted from the git-committed `declare_id!`/`Anchor.toml` value (the corresponding keypair, correctly gitignored, isn't recoverable in this session), then propagate the corrected address to `docker-compose.yml`'s `PROGRAM_ID` and regenerate `on-chain-client`.
- Fund the frontend's `SYSTEM_ADMIN_SECRET_KEY` wallet (derived address `8BLQ33YJwJriwmS5RYYzkUfQp6ZwViXodKf1LcEZSsVV`) in `program-deploy`'s CMD — the plan only airdropped to the container's own throwaway Anchor CLI keypair, leaving the actual fee-payer for `noop` transactions unfunded.
- Fix a pre-existing bug in Task 7's `apps/frontend/src/server/actions/noop.ts`: the WS subscriptions URL was derived via `env.rpcUrl.replace(/^http/, "ws")`, keeping the RPC port (8899) instead of the real pub-sub port (8900) that Solana validators (surfpool included) serve on by default (rpc_port + 1). This is the first time this Server Action ever ran against a live validator, so the bug was previously latent.
- Bring the full stack up, run the real Playwright suite from Task 8, tear down, commit.

### Files Changed
- created `docker/local/Dockerfile.anchor` — Anchor build+deploy+codegen image; rewritten from the plan's verbatim mega-installer script to explicit, deterministic installs on `node:24.18.0-trixie`, plus a second airdrop to the frontend's admin wallet
- created `docker/local/Dockerfile.frontend` — frontend dev image (verbatim from plan)
- created `docker-compose.yml` — 3-service stack; `platform: linux/amd64` on `program-deploy` and `frontend`; named-volume isolation for every workspace package's `node_modules`; `PROGRAM_ID` set to the address actually deployed in this session after re-syncing (see Key Decisions)
- modified `Justfile` — added `dev-up`/`dev-down` recipes
- modified `apps/on-chain-program/Anchor.toml` — `anchor keys sync` updated `[programs.localnet]` to the currently-real keypair's address
- modified `apps/on-chain-program/programs/game_token_wallet/src/lib.rs` — `anchor keys sync` updated `declare_id!()` to match
- modified `packages/on-chain-client/src/generated/programs/gameTokenWallet.ts` — regenerated by `program-deploy`'s codegen step against the re-synced IDL
- modified `apps/frontend/src/server/actions/noop.ts` — fixed WS pub-sub URL derivation (port +1, not same-port protocol swap)

### New Tests
(none — this task's verification is the live Playwright e2e run, not new unit tests)

### Key Decisions
- **Forced `platform: linux/amd64`** on `program-deploy` and `frontend` rather than compiling the Solana/Anchor toolchain from source for linux/arm64: confirmed via GitHub Releases API that neither `anza-xyz/agave` nor `solana-foundation/anchor` (v1.1.2) publish linux/aarch64 binaries — only x86_64-linux and macOS. Both services must share the same platform since they share `node_modules` (platform-specific optional native deps like `lightningcss`).
- **Switched base image to `node:24.18.0-trixie`** (not `-bookworm` as an initial fix attempt used): the prebuilt anchor-cli 1.1.2 x86_64-linux binary requires `GLIBC_2.39+`; bookworm (Debian 12) ships 2.36, trixie (Debian 13) ships 2.41.
- **Dropped the plan's `solana-install.solana.workers.dev` mega-installer** entirely in favor of explicit `rustup`/official Solana installer/`cargo install avm` steps: reproducibly confirmed the script's automatic `avm install 1.1.2` (no `--from-source`) 404s on any platform lacking a prebuilt binary, then falls back to an interactive `[y/n]` prompt that panics with no TTY in a Docker build; separately, it installs Node via NVM without ever sourcing it into subsequent `RUN` layers, breaking the plan's later `corepack enable` step regardless of the avm issue.
- **Named-volume isolation for `node_modules`** (5 volumes: root + each of the 4 workspace packages) rather than a bare `.:/workspace` bind mount: reproducibly observed that any `pnpm install` — container-side (linux/amd64) or host-side (macOS/arm64) — sharing the same on-disk `node_modules` corrupts it for whichever side runs second, up to and including crashing a *live* Next.js dev server mid-request when a host-side `pnpm install` ran concurrently ("Next.js package not found" / Turbopack workspace-root resolution failure). `packages/on-chain-client/src/generated` deliberately stays bind-mounted (git-tracked codegen output must land on the host).
- **Set `CI=true`** in `program-deploy`'s (and any host command touching the shared repo's) environment: pnpm refuses to non-interactively wipe/reinstall a stale `node_modules` without a TTY (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) unless `CI=true` is set, which Docker `RUN`/`CMD` and this harness's Bash tool both lack.
- **Re-ran `anchor keys sync`** rather than forcing `docker-compose.yml`'s `PROGRAM_ID` to the git-committed `BWS4UCkFps4XUs7bqqzgNxFZ3keLUMVbb9CJUpyefNob`: that address's keypair (`target/deploy/*-keypair.json`) is intentionally gitignored (private key material) and isn't recoverable in this session — the locally-buildable program can only ever deploy to the address matching whatever keypair is actually present on disk. Treated this as the intended use of `anchor keys sync` (reconciling `declare_id!`/`Anchor.toml` to the real keypair), consistent with how Task 2 Step 8 originally established the address, and propagated the corrected address everywhere it's referenced (`docker-compose.yml`, regenerated `on-chain-client`).
- **Added a second `solana airdrop`** to `program-deploy`'s CMD targeting the frontend's `SYSTEM_ADMIN_SECRET_KEY` wallet address (`8BLQ33YJwJriwmS5RYYzkUfQp6ZwViXodKf1LcEZSsVV`, derived from the throwaway dev secret key): the plan only funded the container's own ephemeral Anchor CLI keypair (used for `anchor build`/`deploy`), leaving the actual fee-payer for every frontend-initiated `noop` transaction unfunded (observed: `SolanaError: Attempt to debit an account but found no record of a prior credit`).
- **Fixed the WS pub-sub URL bug in `noop.ts`** using the `URL` API to explicitly set `port = rpcPort + 1` rather than reusing the RPC port: this is Solana's standard default (`rpc_port` / `rpc_port + 1` for pub-sub) that solana-test-validator, agave-validator, and surfpool all follow. Scoped the fix to just the port-increment heuristic (documented as such) rather than adding a new required env var, since Global Constraints define exactly one RPC URL var and this ticket is local-dev-only in scope (devnet/mainnet WS handling is out of scope per the design doc).

### Lint Output
PASS (`pnpm --filter frontend run lint` — clean, no output)

### Test Output
PASS — `E2E_BASE_URL=http://localhost:3000 pnpm --filter e2e run test`: 1 passed (1.7s). Real transaction confirmed on-chain: `surfpool` logs show `Program 4qetKWMztCYZLp9zqLZiNjmnSfy13JM5VAjkKmU8g42X invoke [1]` → `Program log: Instruction: Noop` → `success`, signature `3CQmdwcjbZRgzgDobUnuBDRYcJk4UEXR1cbsjPNMHfiRCCkPYqY3o9Cpp5ZkExzY3rdwLgxhyA3Lxv5fie5W9VbG` (matches `noop-signature`'s base58 assertion).
`pnpm --filter frontend run typecheck`: PASS.
`just dev-down` (`docker compose down --volumes`): all 3 containers + 5 named volumes removed cleanly; `docker ps -a --filter name=game-token-wallet-v2` empty afterward.

### Commit
`9a64d3a`

### Outcome: success
