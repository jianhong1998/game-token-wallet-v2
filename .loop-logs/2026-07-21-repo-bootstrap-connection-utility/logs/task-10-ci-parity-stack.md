# Task 10 Log: CI-parity stack — `docker-compose.e2e.yml`

## Task Context

### Plan Section

## Task 10: CI-parity stack — `docker-compose.e2e.yml`

**Files:**
- Create: `docker/deployment/Dockerfile`
- Create: `docker/deployment/.env.template`
- Create: `docker/local/Dockerfile.e2e`
- Create: `docker-compose.e2e.yml`
- Modify: `Justfile`

**Interfaces:**
- Produces: `docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e` — Task 11's CircleCI `e2e` job runs exactly this.

- [ ] **Step 1: Create the production frontend Dockerfile**

`docker/deployment/Dockerfile`:
```dockerfile
FROM node:24.18.0-bookworm AS builder
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY packages/on-chain-client ./packages/on-chain-client
RUN pnpm install --frozen-lockfile
COPY apps/frontend ./apps/frontend
RUN pnpm --filter frontend run build

FROM node:24.18.0-bookworm-slim AS runner
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
WORKDIR /workspace
COPY --from=builder /workspace ./
WORKDIR /workspace/apps/frontend
EXPOSE 3000
CMD ["pnpm", "start"]
```

- [ ] **Step 2: Create the deployment env template**

`docker/deployment/.env.template`:
```
# Runtime config for a self-hosted deployment — read at container start,
# never baked into the image at build time.
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=
PROGRAM_ID=
SYSTEM_ADMIN_SECRET_KEY=
```

- [ ] **Step 3: Create the Playwright runner image**

`docker/local/Dockerfile.e2e`:
```dockerfile
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/e2e/package.json ./apps/e2e/package.json
RUN pnpm install --frozen-lockfile --filter e2e...
COPY apps/e2e ./apps/e2e

WORKDIR /workspace/apps/e2e
CMD ["pnpm", "test"]
```

- [ ] **Step 4: Create docker-compose.e2e.yml**

`docker-compose.e2e.yml` (reuses `docker/local/Dockerfile.anchor` from Task 9 as-is):
```yaml
services:
  surfpool:
    image: surfpool/surfpool:latest
    command: ["start", "--no-tui"]
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
      dockerfile: docker/deployment/Dockerfile
    depends_on:
      program-deploy:
        condition: service_completed_successfully
    environment:
      SOLANA_CLUSTER: localnet
      SOLANA_RPC_URL: http://surfpool:8899
      PROGRAM_ID: "<same value as docker-compose.yml>"
      SYSTEM_ADMIN_SECRET_KEY: "PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis"

  e2e:
    build:
      context: .
      dockerfile: docker/local/Dockerfile.e2e
    depends_on:
      - frontend
    environment:
      E2E_BASE_URL: http://frontend:3000
```

- [ ] **Step 5: Add the Justfile test fan-out target**

Modify `Justfile` — add:
```
[group: 'CI']
test:
  @cargo test --manifest-path apps/on-chain-program/Cargo.toml
  @pnpm --filter frontend run test
  @cd apps/on-chain-program && anchor test
  @docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e
```

- [ ] **Step 6: Run the e2e stack**

Run: `docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e`
Expected: `e2e` service exits 0 with the Playwright test passing against the prod-built frontend image.

- [ ] **Step 7: Tear down**

Run: `docker compose -f docker-compose.e2e.yml down --volumes`

- [ ] **Step 8: Commit**

```bash
git add docker/deployment docker/local/Dockerfile.e2e docker-compose.e2e.yml Justfile
git commit -m "feat: add prod-parity docker-compose.e2e.yml stack for CI"
```

### Acceptance Criteria
- AC-1: `docker/deployment/Dockerfile` builds a production Next.js frontend image via a multi-stage COPY-based build (no bind mount)
- AC-2: `docker/deployment/.env.template` created verbatim per plan
- AC-3: `docker/local/Dockerfile.e2e` builds a Playwright runner image whose base image version matches the actual `@playwright/test` version in `apps/e2e/package.json` (confirmed `^1.61.1`, not the plan's stale `^1.49.0`)
- AC-4: `docker-compose.e2e.yml` brings up `surfpool` → `program-deploy` (reusing the real `docker/local/Dockerfile.anchor` with `platform: linux/amd64` + named-volume node_modules isolation) → `frontend` (built from `docker/deployment/Dockerfile`, prod image) → `e2e` (Playwright container hitting the prod frontend over the compose network)
- AC-5: `docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e` exits 0, with the Playwright test genuinely passing against the prod-built frontend image
- AC-6: Justfile `test` target added, fanning out `cargo test`, `pnpm --filter frontend run test`, `anchor test`, and the e2e compose run
- AC-7: Teardown leaves no stray containers/volumes for this project
- AC-8: Changes committed with message `feat: add prod-parity docker-compose.e2e.yml stack for CI`

## Pre-flagged deviations to carry forward (from orchestrator, based on Task 9's real findings)
- Real deployed `PROGRAM_ID` at execution time: `4qetKWMztCYZLp9zqLZiNjmnSfy13JM5VAjkKmU8g42X` (confirmed fresh from `apps/on-chain-program/Anchor.toml` and `target/idl/game_token_wallet.json`).
- `docker/local/Dockerfile.anchor` (the real, working one) uses `node:24.18.0-trixie` base, `platform: linux/amd64`, AVM-pinned `v1.1.2` anchor-cli, dual-wallet airdrop (own CLI keypair + `SYSTEM_ADMIN_SECRET_KEY`'s derived address `8BLQ33YJwJriwmS5RYYzkUfQp6ZwViXodKf1LcEZSsVV`) — reused verbatim for `program-deploy` in the e2e compose, with the same `platform: linux/amd64` + named-volume node_modules isolation pattern as `docker-compose.yml`.
- `apps/e2e/package.json`'s actual `@playwright/test` version is `^1.61.1`, not the plan's `^1.49.0` — `docker/local/Dockerfile.e2e`'s base image tag must be updated to match (`mcr.microsoft.com/playwright:v1.61.1-noble` or closest compatible tag, confirmed at execution time).
- `docker/deployment/Dockerfile` and `docker/local/Dockerfile.e2e` are proper multi-stage/COPY-based builds (no bind mount), so they should NOT need the node_modules named-volume treatment — only `program-deploy` (which bind-mounts the whole repo) needs it.

---

## Attempt 1 — 2026-07-21T12:40:00Z

### Implementation Plan
- Create `docker/deployment/Dockerfile` (prod multi-stage frontend build), `docker/deployment/.env.template` verbatim
- Create `docker/local/Dockerfile.e2e`, bumping the Playwright base image tag from the plan's `v1.49.0-jammy` to `v1.61.1-noble` to match `apps/e2e/package.json`'s real `@playwright/test` version (`^1.61.1`, confirmed by reading the file directly)
- Create `docker-compose.e2e.yml` reusing the real `docker/local/Dockerfile.anchor` (trixie base, AVM v1.1.2, dual airdrop) for `program-deploy` with `platform: linux/amd64` + named-volume node_modules isolation, real `PROGRAM_ID` confirmed from `Anchor.toml`/`target/idl/game_token_wallet.json` (`4qetKWMztCYZLp9zqLZiNjmnSfy13JM5VAjkKmU8g42X`)
- Add a `frontend` healthcheck (Node TCP probe, no curl/wget in bookworm-slim) so `e2e` doesn't race `next start`'s boot
- Append Justfile `test` target per plan Step 5
- Run `docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e`

### Files Changed
- created `docker/deployment/Dockerfile` — prod multi-stage Next.js build
- created `docker/deployment/.env.template` — deployment runtime env template
- created `docker/local/Dockerfile.e2e` — Playwright runner image, base tag bumped to v1.61.1-noble
- created `docker-compose.e2e.yml` — CI-parity stack (surfpool, program-deploy, frontend, e2e)
- modified `Justfile` — added `test` fan-out target

### New Tests
(none — this task is infrastructure; verification is the e2e stack passing, not new unit tests)

### Key Decisions
- Bumped Playwright base image to `v1.61.1-noble` instead of the plan's stale `v1.49.0-jammy`, matching `apps/e2e/package.json`'s real installed `@playwright/test` version (confirmed image ships Node v24.17.0, close enough to the 24.18.0 pin)
- Added a healthcheck to `frontend` (not in the plan's original compose text) since `e2e` has no other readiness gate for `next start`

### Lint Output
n/a — infrastructure/YAML/Dockerfile changes, no lint target applies

### Test Output
FAIL — `docker/deployment/Dockerfile`'s builder stage never copies root `tsconfig.base.json`, which `apps/frontend/tsconfig.json` `extends`. Turbopack build failed: "./apps/frontend/tsconfig.json: extends: '../../tsconfig.base.json' doesn't resolve correctly". `[frontend builder 9/9] RUN pnpm --filter frontend run build` exited 1.

### Commit
n/a — retrying

### Outcome: failed — docker/deployment/Dockerfile omitted `COPY tsconfig.base.json`, breaking the frontend prod build (plan's file list didn't mention it; not one of the orchestrator's pre-flagged deviations)

---

## Attempt 2 — 2026-07-21T12:47:00Z

### Implementation Plan
- Fix `docker/deployment/Dockerfile`: add `tsconfig.base.json` to the `COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ...` line before `pnpm install`
- Re-run the full e2e stack

### Files Changed
- modified `docker/deployment/Dockerfile` — added `tsconfig.base.json` to the builder stage's early COPY step, with a comment explaining why

### New Tests
(none)

### Key Decisions
(none beyond the mechanical fix)

### Lint Output
n/a

### Test Output
FAIL — all four images built successfully (frontend build now succeeds; program-deploy layers reused Task 9's cache; e2e image built against v1.61.1-noble). Both airdrops succeeded, `anchor build`/`anchor deploy` succeeded (`Deployed program 4qetKWMztCYZLp9zqLZiNjmnSfy13JM5VAjkKmU8g42X`), codegen ran. But `program-deploy` (a one-shot service that exits 0 on completion per Dockerfile.anchor's default CMD) exiting triggered Docker Compose's `--abort-on-container-exit`/`--exit-code-from e2e` to abort the ENTIRE stack immediately ("Compose Stopping Aborting on container exit..."), tearing down `surfpool` while `frontend`/`e2e` were still racing to start via their `depends_on: condition: service_completed_successfully` / `service_healthy` chain. Result: `frontend` crashed with `TypeError: fetch failed ... getaddrinfo ENOTFOUND surfpool`, and the Playwright test failed on `noop-signature` never appearing. Root cause confirmed via web research as a documented, long-standing Docker Compose limitation (docker/compose#10233, #13223): `--abort-on-container-exit` (which `--exit-code-from` implies) treats ANY container's exit — even a benign one-shot dependency job's successful exit — as a trigger to abort the whole stack, when no positional service names are passed to `up` (our required command has none, matching Task 11's CircleCI job).
`e2e-1 exited with code 1` (never actually got to run against a working stack); overall `EXIT_CODE:1`.

### Commit
n/a — retrying

### Outcome: failed — `--abort-on-container-exit` aborted the whole stack on `program-deploy`'s normal successful exit, tearing down `surfpool` before `frontend`/`e2e` could run (documented Compose limitation, not an application bug)

---

## Attempt 3 — 2026-07-21T12:54:00Z

### Implementation Plan
- Redesign `program-deploy` in `docker-compose.e2e.yml` so it never exits during the run: override its `command:` (not the shared `docker/local/Dockerfile.anchor`, which stays untouched/verbatim for `docker-compose.yml`'s dev loop) to run the same airdrop/build/deploy/codegen steps, then `touch /tmp/deploy-complete && tail -f /dev/null`
- Gate it with a `healthcheck: test -f /tmp/deploy-complete` instead of relying on Compose's exit-based `service_completed_successfully`
- Change `frontend`'s `depends_on: program-deploy` condition from `service_completed_successfully` to `service_healthy`
- Escape `$` as `$$` in the compose-level `command:` override (verified empirically with an isolated busybox test that Compose's own variable interpolation would otherwise swallow single `$` before the shell inside the container ever sees it)
- Re-run the full e2e stack from a clean teardown

### Files Changed
- modified `docker-compose.e2e.yml` — `program-deploy` gets a `command:` override (loops forever after deploy+codegen, never exits) and a file-marker healthcheck; `frontend`'s `depends_on` condition changed to `service_healthy`

### New Tests
(none)

### Key Decisions
- Chose "never let program-deploy exit" over the alternative `profiles:`-based workaround (tried first, empirically failed: `docker compose config` rejected the file with "service frontend depends on undefined service program-deploy: invalid compose project" once program-deploy was moved to a non-default profile — profile-gated `depends_on` targets require the dependent to share the profile or use `required: false`, which would have broken the actual wait-for-completion guarantee). The healthcheck+marker-file approach keeps `docker/local/Dockerfile.anchor` completely untouched (verbatim reuse, as required) and preserves the functional "wait for program-deploy to finish before frontend starts" guarantee via `service_healthy` instead of `service_completed_successfully`.

### Lint Output
n/a

### Test Output
PASS. Full sequence observed:
- `surfpool` healthy, `program-deploy` airdropped both wallets (own CLI keypair + `8BLQ33YJwJriwmS5RYYzkUfQp6ZwViXodKf1LcEZSsVV`), ran `anchor build`/`anchor deploy` (`Deployed program 4qetKWMztCYZLp9zqLZiNjmnSfy13JM5VAjkKmU8g42X`), ran codegen, wrote the marker file, and stayed running (never exited) — its healthcheck went green without ever tearing down `surfpool`.
- `frontend` (built from `docker/deployment/Dockerfile`, the prod multi-stage image) started via `next start`, became healthy.
- `e2e` (Playwright, built from `docker/local/Dockerfile.e2e`) ran `tests/noop.spec.ts` against `http://frontend:3000`: clicked "Send noop transaction", the Server Action submitted a real transaction, surfpool logged `Program 4qetKWMztCYZLp9zqLZiNjmnSfy13JM5VAjkKmU8g42X ... Instruction: Noop ... success`, and the Playwright assertion on `noop-signature` passed — `1 passed (1.1s)`.
- `e2e-1 exited with code 0`; `--exit-code-from e2e` propagated that as the overall exit code. `frontend` (exit 1) and `program-deploy` (exit 137) both exited only as part of normal SIGTERM teardown *after* `e2e` had already exited 0 and triggered the (now-correct, single-trigger) abort — expected noise, not a failure signal.
- Overall `EXIT_CODE:0`.
- Teardown: `docker compose -f docker-compose.e2e.yml down --volumes` removed all 4 containers, 5 named volumes, and the network cleanly. Post-teardown check (`docker ps -a` / `docker volume ls` / `docker network ls`, all filtered on `game-token-wallet-v2`) confirmed empty output — fully clean.

### Commit
`f0f1db8`

### Outcome: success
