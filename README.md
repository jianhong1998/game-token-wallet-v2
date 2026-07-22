# Game Token Wallet V2

Mobile-first Solana wallet dApp for tokenizing offline group games (poker, mahjong) as on-chain SPL tokens. See [`CLAUDE.md`](./CLAUDE.md) and [`docs/`](./docs/) for project context, architecture, and tech stack.

This doc covers running the full stack locally and deploying the on-chain program to localnet.

## Prerequisites

- **Docker Desktop** (with Apple Silicon / Docker Desktop's amd64 emulation enabled — this is the default) — the whole local loop runs in containers, no local Solana/Anchor toolchain install required.
- **Node** `24.18.0` and **pnpm** `11.15.1` (via [corepack](https://nodejs.org/api/corepack.html): `corepack enable && corepack prepare pnpm@11.15.1 --activate`) — only needed on the host if you want to run individual package scripts (tests, lint) outside Docker.
- **[`just`](https://github.com/casey/just)** (optional but recommended) — thin wrapper around the commands below.

## Quick start — run the full stack locally

```sh
just up-build
# or, without just:
docker compose up --build
```

This brings up three services, in order:

1. **`surfpool`** — a local Solana validator, waits until healthy.
2. **`program-deploy`** — one-shot: builds the Anchor program, deploys it to `surfpool`, then regenerates the TypeScript client (`packages/on-chain-client`) from the freshly-built IDL. Exits once done.
3. **`frontend`** — boots the Next.js app on **http://localhost:3000** once `program-deploy` finishes.

First run downloads/builds Docker images and can take several minutes; subsequent runs are much faster (Docker layer caching + named volumes for `node_modules`).

**Verify it worked:** open http://localhost:3000, click **"Send noop transaction"**, and confirm a real base58 transaction signature renders on the page. That signature is a genuine, finalized on-chain transaction against the program `program-deploy` just deployed — this is the whole point of the ticket-001 scaffold (proving the env → connection utility → signer → on-chain-client → program → chain path works end-to-end, not just that things compile).

Tear down when done:

```sh
just down
# or:
docker compose down --volumes
```

## Deploying the program to localnet

`program-deploy` already does this automatically on every `just up-build` — you don't need to do anything extra for a normal dev loop. The program always deploys to the same fixed address, **`FHRNx4KK4WzMxXx7X6sK84RvKTKuDVtTGduW3eH9QN9t`**, because `docker/local/Dockerfile.anchor` seeds a committed, throwaway dev keypair (`docker/local/fixtures/game_token_wallet-keypair.dev.json`) into `apps/on-chain-program/target/deploy/` before every build — see [`docker/local/fixtures/README.md`](./docker/local/fixtures/README.md) for why this matters and what to do if that keypair ever needs to change.

**If you're iterating on the Anchor program itself** and want a tighter loop than a full `docker compose up --build`:

```sh
cd apps/on-chain-program
anchor build
anchor test              # spins up its own ephemeral validator, deploys, runs apps/on-chain-program-e2e
```

**If you need to redeploy manually** against the already-running `surfpool` from `just up-build` (e.g. after an incremental `anchor build` on the host):

```sh
just deploy-program-local
```

This seeds the same fixture keypair before building, so it deploys to the same fixed address rather than drifting.

⚠️ Only do this if the program's `declare_id!`/`Anchor.toml` still matches the keypair at `apps/on-chain-program/target/deploy/game_token_wallet-keypair.json` (i.e. you haven't deleted/regenerated it). If they've drifted, `anchor build && anchor keys sync && anchor build` first, then update every place listed in `docker/local/fixtures/README.md` to match, then `pnpm --filter on-chain-client run codegen`.

## Environment variables

The frontend reads four required, explicit env vars at request time (no silent fallback — missing or malformed values throw) — see `apps/frontend/.env.template`:

| Var | Shape |
| --- | --- |
| `SOLANA_CLUSTER` | `localnet \| devnet \| mainnet-beta` |
| `SOLANA_RPC_URL` | explicit RPC endpoint URL |
| `PROGRAM_ID` | base58 pubkey of the deployed program |
| `SYSTEM_ADMIN_SECRET_KEY` | base58-encoded 64-byte secret key |

For local Docker dev these are already baked into `docker-compose.yml` (including a throwaway, non-secret `SYSTEM_ADMIN_SECRET_KEY` dev fixture — never reuse it anywhere real). You only need to set these yourself if running `apps/frontend` outside Docker.

## Running tests

```sh
just test
```

Fans out: `cargo test` (Anchor program), `pnpm --filter frontend run test` and `pnpm --filter on-chain-client run test` (vitest), `anchor test` (real on-chain round trip against an ephemeral validator), and the full CI-parity e2e stack (`docker-compose.e2e.yml` — prod-built frontend image + Playwright, mirrors what CircleCI runs).

Other useful commands: `just lint`, `just typecheck`, or `pnpm lint`/`pnpm typecheck`/`pnpm test` from the repo root (fans out to every workspace package that defines the corresponding script).

## Troubleshooting

- **Apple Silicon / arm64 hosts:** `program-deploy` and `frontend` are forced to `platform: linux/amd64` in `docker-compose.yml` because Solana CLI and Anchor CLI publish no linux/arm64 binaries. Docker Desktop emulates this transparently — no action needed, just expect it (and don't "fix" the platform pin).
- **Don't `pnpm install` on the host inside this repo while the stack is running.** `node_modules` is isolated per-service via named Docker volumes specifically because a host (macOS/arm64) `pnpm install` and a container (linux/amd64) `pnpm install` sharing the same directory corrupt each other's native binaries (observed: crashed the live Next.js dev server). Run `pnpm install` on the host only when you're not also running the Docker stack against the same checkout, or accept that Docker will reinstall its own copy into its own volumes regardless.
- **Program address changed unexpectedly / `DeclaredProgramIdMismatch` on deploy:** see `docker/local/fixtures/README.md` — the deploy identity comes from a committed fixture keypair specifically to avoid this class of drift; if you've deleted or regenerated `apps/on-chain-program/target/deploy/game_token_wallet-keypair.json` yourself, that's expected to break until you follow the resync steps there.
