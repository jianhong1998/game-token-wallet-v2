# Tech Stack

Source of truth for what V2 is built with. Derived from
[001-PRD.md](../../business-related/001-PRD.md) and
[002-architecture-decisions.md](./002-architecture-decisions.md). This is a
new repo (not a migration) — nothing here inherits V1 code, only some of its
on-chain patterns (PDA seed conventions, `close_*` rent-reclaim style).

---

## Client — Next.js App

| Concern             | Choice                                                         |
| ------------------- | -------------------------------------------------------------- |
| Framework           | Next.js, **App Router**                                        |
| Language            | TypeScript                                                     |
| Server state        | TanStack React Query                                           |
| Client/shared state | React Context                                                  |
| Design              | Mobile-first; desktop capped to mobile width with side margins |

- The client has **no wallet-connect flow and no client-side signing key**.
  Users authenticate with username/password only; every on-chain transaction
  is signed server-side by the system admin wallet (see below). This is a
  deliberate custodial model (architecture Q1) — the audience isn't Web3-native
  and a password-derived signing key would mean unrecoverable fund loss on a
  forgotten password.
- Practical consequence: since nothing Solana-related runs client-side, the
  app likely needs **no `NEXT_PUBLIC_*` env vars at all**, which trivially
  satisfies the PRD's "no env baked at build time" constraint (still to be
  confirmed per [002-pending-discussion.md](../../business-related/002-pending-discussion.md)).

## Server — Connection & Signing

- All Solana reads/writes go through a single server-side connection/signer
  utility: a lazy singleton `Program`/`Connection` accessor. Nothing else in
  the codebase constructs a `Connection` or `Program` directly (ticket 001).
- The server holds the **system admin wallet** keypair (renamed conceptually
  from V1's `FEE_PAYER`) and signs every transaction. It has authority over
  all on-chain accounts and pays all transaction fees.
- Multi-tenancy was **dropped** (architecture Q3): one deployment = one system
  admin wallet, one global namespace of users/games. A tenant that wants
  isolation runs its own full deployment rather than sharing a program.
- Config read from environment variables at runtime (not build time):
  - Solana cluster/validator RPC URL
  - System admin wallet keypair
  - Deployed program ID (read from env, **not** the hardcoded address in the
    Anchor IDL — ticket 004)

## On-Chain Program

| Concern          | Choice                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| Language         | Rust                                                                     |
| Framework        | Anchor                                                                   |
| Tooling          | Solana CLI, `anchor build` / `anchor test`                               |
| Local network    | Surfpool, run via docker compose (`solana-test-validator` is deprecated) |
| Deployed network | Devnet                                                                   |

- **No off-chain database.** All persistent state — users, games, balances —
  lives in on-chain accounts. The Next.js server is stateless aside from the
  admin signing key.
- **Account model** (architecture Q17, replacing V1's single `Pool` account):
  - `Registry` — singleton PDA (`["registry"]`), bounded list of open game
    IDs for O(1) "browse games" without `getProgramAccounts` scans
    (architecture Q4).
  - `User` — one per username, PDA seeded `["user", username,
system_admin_pubkey]`, stores the hashed login password.
  - `Game` — owns its own SPL mint plus an embedded, ephemeral
    current-round/pot state that resets in place each hand rather than
    persisting per-round history (architecture Q8).
- **Token model:** one SPL (fungible) token minted per game, **2 decimals**
  (architecture Q9 — not Solana's default 6/9). Game membership is tracked
  implicitly via the existence/balance of a player's per-game ATA, not a
  separate on-chain list (architecture Q15–17).
- **Game modes**, same program, different instruction sets:
  - General Mode — direct player-to-player transfers.
  - Poker (Holdem) Mode — pot/showhand token accounting only; no on-chain
    betting engine (architecture Q5); side pots derived mechanically from
    transfer/showhand event order (architecture Q6/Q7).
  - General Pool Mode — single continuous pool, admin-discretionary payouts,
    no rounds (architecture Q10).
- Multi-recipient transfers are **client-composed**, not a batched on-chain
  instruction: the client issues N single-recipient instructions (chunked
  across transactions to fit Solana's tx size limit) rather than the program
  accepting a `Vec<Pubkey>` (architecture Q14).

## CI/CD & Deployment

- **CircleCI** pipeline: lint, typecheck, `cargo test` (on-chain-program
  unit tests), `on-chain-program-e2e` (Anchor integration tests), `e2e`
  (Playwright), and frontend unit tests all run on every PR — one CI bar, no
  fast-PR/slow-main split (see
  [codebase-structure/002-decisions.md](../codebase-structure/002-decisions.md)
  Q10–Q12). Devnet-deploy job exists (ticket 004); whether it's automatic on
  merge or manually gated is still undecided (see
  [002-pending-discussion.md](../../business-related/002-pending-discussion.md)).
- **Client app**: Docker image, self-hosted, all config read at container
  runtime — nothing environment-specific baked in at build time.
- **Program**: deployed to devnet; program ID is env-controlled so the app
  never depends on the address hardcoded in the Anchor IDL.
- **Local dev loop**: Surfpool + client brought up via docker compose; the
  program deploys locally against it, giving a full loop (client → server →
  program → local chain) with no dependency on devnet for day-to-day
  development (ticket 001).

## Testing

- On-chain program unit tests: inline `#[cfg(test)] mod tests` per file, run
  via plain `cargo test` — no validator or Surfpool needed (pure logic like
  side-pot math, odd-chip remainder calculation).
- On-chain program integration tests: `apps/on-chain-program-e2e`, run via
  `anchor test`, consuming the generated `packages/on-chain-client` (same
  client the frontend uses).
- Web app: unit tests (vitest, per PRD/ticket references — exact runner to
  confirm when ticket 001 lands), colocated with source files.
- Browser end-to-end: `apps/e2e` (Playwright), driving the frontend against
  the prod-built Docker stack (`docker-compose.e2e.yml`), plus the devnet
  smoke test in ticket 004 (register + login against the live deployment
  through the Dockerized app).

## Open / Unconfirmed

Tracked in [002-pending-discussion.md](../../business-related/002-pending-discussion.md) — don't treat these as decided:

- Password/game-password hashing algorithm (bcrypt / argon2 / sha256+salt — undecided).
- Session mechanics after login (cookie/JWT vs. re-verify per action).
- Deposit → mint conversion rate (currently assumed: admin-discretionary amount, no on-chain FX rate).
- Exact values for bounded caps (`MAX_ACTIVE_GAMES`, `MAX_POTS_PER_ROUND`, per-tx multi-recipient chunk size). `MAX_PLAYER_PER_GAME` is fixed at 20 by the PRD.
- CI stage gating detail (what runs on every PR vs. only on merge to main).
