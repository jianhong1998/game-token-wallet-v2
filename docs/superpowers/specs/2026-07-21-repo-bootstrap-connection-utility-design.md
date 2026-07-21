# Design — 001: Repo Bootstrap & Connection Utility

**Ticket:** [001-repo-bootstrap-connection-utility.md](../../tickets/001-repo-bootstrap-connection-utility.md)
**Status:** Approved, ready for planning
**Date:** 2026-07-21

## Context

This ticket is prefactoring/infra: a working local dev loop plus the
system-admin-wallet connection utility every later ticket builds on. Most of
the *structural* decisions (repo tree, tech stack, account model) were
already made in prior `/grill-me` sessions and are recorded in
[001-CODEBASE-STRUCTURE.md](../../technical-related/codebase-structure/001-CODEBASE-STRUCTURE.md),
[002-decisions.md](../../technical-related/codebase-structure/002-decisions.md),
and [003-TECH-STACK.md](../../technical-related/architecture/003-TECH-STACK.md).
This session resolved the remaining implementation-level decisions those
docs left open (env var shapes, exact versions, verification approach,
scaffolding depth) needed to actually build ticket 001.

## Questions, Answers, Decisions, Reasons

### Q1: How should the system admin wallet keypair be supplied via env var?

**Answer:** Base58-encoded secret key string, single env var
`SYSTEM_ADMIN_SECRET_KEY`.

**Reason:** Simplest to inject as a CI/docker secret — no file mounting, no
JSON array parsing, works identically across CircleCI env vars, `.env`
files, and container runtime env.

### Q2: What should the cluster/RPC env var shape be?

**Answer:** Two vars — `SOLANA_CLUSTER` (informational enum:
`localnet | devnet | mainnet-beta`) and `SOLANA_RPC_URL` (always required,
explicit).

**Reason:** Matches the ticket's literal wording ("reads the cluster
type/provider"). An explicit, always-required RPC URL avoids silently
falling back to public default endpoints per cluster name, which are
heavily rate-limited and unsuitable even for local/dev use.

### Q3: How should the `noop` instruction "prove the plumbing works"?

**Answer:** A Server Action, invoked from a simple page, that calls `noop`
through the connection/signer utility and displays the resulting tx
signature.

**Reason:** This is literally what the ticket is about — the connection
utility is server-side infrastructure; the only way to prove it actually
works end-to-end (not just that the Rust compiles) is to exercise the full
client → Server Action → connection utility → program → chain path.

### Q4: How far should ticket 001 scaffold `apps/on-chain-program-e2e` and `apps/e2e`?

**Answer:** Create minimal *real* skeleton apps now — not placeholder CI
stanzas — each with one trivially-passing test, wired into CI for real.

**Reason:** `001-CODEBASE-STRUCTURE.md` already lists these as existing
top-level apps; a placeholder-only CI stanza would leave the tree
inconsistent with the documented structure. A real (if trivial) green CI
job is also a stronger signal than a TODO comment that could silently rot.

### Q5: Anchor version line?

**Answer:** Anchor 1.x (latest stable via AVM), not 0.30.x.

**Reason:** Anchor 1.0 (released 2026) made Surfpool/LiteSVM the default
test backend and dropped Anchor's own dependency on the external Solana
CLI for its built-in commands — this lines up natively with
`003-TECH-STACK.md`'s already-chosen Surfpool-first local dev loop. Since
this is a brand-new repo with no legacy Anchor 0.3x code to preserve,
there's no reason to start on the older line.

### Q6: Other version pins?

**Answer:** Node 24.18.0, latest pnpm, Next.js 16.x, current Agave/Solana
CLI stable line where still needed directly.

**Reason:** User-specified Node version; latest-stable everything else
since there's no legacy constraint.

### Q7: Program crate / instruction naming?

**Answer:** Crate `game_token_wallet`, instruction `noop` (no accounts, no
args).

**Reason:** Crate name matches the project; `noop` is the simplest possible
round-trip with zero product logic, matching the ticket's explicit "no
functional Solana instructions exist yet" constraint.

### Q8: Styling for the Next.js app?

**Answer:** Tailwind CSS, enabled at `create-next-app` scaffold time.

**Reason:** User-specified. Not previously recorded in `003-TECH-STACK.md`
(styling was unspecified there) — this ticket also updates that doc's
Client table to add Tailwind as the styling choice.

## Design

### 1. Repo scaffold

pnpm workspace (`pnpm-workspace.yaml`: `apps/*`, `packages/*`) per
`001-CODEBASE-STRUCTURE.md`:

- `apps/frontend` — `create-next-app` (App Router, TypeScript, Tailwind
  CSS, ESLint). No CSS-in-JS or component library layered on top.
  Tailwind config carries mobile-first breakpoints and a max-width
  container utility (for the "desktop capped to mobile width with side
  margins" NFR), set up now so later UI tickets don't retrofit it.
- `apps/on-chain-program` — Anchor 1.x program skeleton, crate
  `game_token_wallet`, `state/` and `instructions/` folders present but
  empty except for `noop`.
- `apps/on-chain-program-e2e` — minimal skeleton: package.json, Anchor
  test config, one trivially-passing test (Anchor test harness sanity
  check — not the `noop` proof, see Q3/§5).
- `apps/e2e` — minimal skeleton: Playwright config, one real test that
  visits `/`, triggers the `noop` Server Action, and asserts a tx
  signature renders (see §5 — this is the one non-vacuous assertion in
  ticket 001's e2e coverage).
- `packages/on-chain-client` — empty scaffold now; populated by Codama
  codegen once `on-chain-program` has more than `noop` (ticket 002+).
- Root `tsconfig.base.json`, shared ESLint/Prettier config.

### 2. Connection/signer utility

Location: `apps/frontend/src/server/`.

Reads at runtime (not build time), fails fast with a clear error if any
var is missing or malformed — no silent fallback:

| Var                     | Shape                                          |
| ------------------------ | ----------------------------------------------- |
| `SYSTEM_ADMIN_SECRET_KEY` | base58 secret key string                        |
| `SOLANA_CLUSTER`          | `localnet \| devnet \| mainnet-beta`            |
| `SOLANA_RPC_URL`          | explicit RPC endpoint URL, always required      |
| `PROGRAM_ID`              | base58 pubkey                                   |

Exposes `getConnection()` / `getProgram()` — lazy singleton, constructed
once on first call and memoized for the process lifetime. This is the
**only** place in the codebase allowed to construct a `Connection` or
`Program`; every other server-side module (Server Actions, future
instruction wrappers) imports from here.

### 3. Anchor program skeleton

Single instruction `noop` — no accounts, no arguments, no state
mutation. Proves `anchor build` produces a valid program and IDL, and
that a transaction can round-trip through Surfpool. `state/` and
`instructions/` directories scaffolded per
[002-decisions.md](../../technical-related/codebase-structure/002-decisions.md)
Q3, empty aside from `noop`, ready for ticket 002's `Registry` account.

### 4. Proof-of-plumbing page

`apps/frontend/src/app/page.tsx` (outside any route group — the
`(auth)`/`(app)` route groups don't exist until ticket 003 adds auth).
Renders a button/action that invokes a Server Action calling
`getProgram()` and sending the `noop` instruction, then displays the
returned transaction signature (or the error, if the utility isn't
configured correctly). This is both the ticket's manual verification
surface and the one real assertion in the `apps/e2e` skeleton test.

### 5. Local dev loop

Root `docker-compose.yml`, three services:

- `surfpool` — official `surfpool/surfpool` image, RPC on `:8899`.
- `program-deploy` — one-shot: waits for `surfpool` healthy, runs
  `anchor build && anchor deploy`, exits.
- `frontend` — dev image from `docker/local/`, `depends_on:
  program-deploy` (`service_completed_successfully`).

`docker compose up` is the single entry point for the full local loop:
validator up → program deployed → app boots against it.

### 6. CI

`.circleci/config.yml`, every PR, one bar (per
[002-decisions.md](../../technical-related/codebase-structure/002-decisions.md)
Q12 — no fast-PR/slow-main split):

- `lint`, `typecheck` — real.
- `cargo test` — real (currently vacuous — no logic to test yet beyond
  `noop`, but the job exists and passes).
- Web unit tests (vitest) — real: connection utility tests (see §7).
- `on-chain-program-e2e` — real: skeleton's one trivial test.
- `e2e` (Playwright) — real: boots `docker-compose.e2e.yml`
  (prod-built frontend image, per
  [002-decisions.md](../../technical-related/codebase-structure/002-decisions.md)
  Q13), runs the `noop` round-trip test from §4/§5.

### 7. Justfile

Extends the existing `init` target:

- `dev-up` / `dev-down` — `docker compose up|down` wrappers.
- `test` — fans out to `cargo test`, `vitest run`, `anchor test`,
  `playwright test`.
- `lint`, `typecheck`.

### 8. Tests shipped with this ticket (TDD)

- Connection utility: happy path (all env vars valid → repeated calls
  return the same singleton instance) + 2 edge cases (a required var
  missing → throws with a clear message; a malformed
  `SYSTEM_ADMIN_SECRET_KEY` → throws rather than silently producing a
  garbage keypair).
- `noop` instruction: trivial Anchor/Rust unit test.
- `on-chain-program-e2e` skeleton: one trivially-passing sanity test.
- `e2e` skeleton: the `noop` round-trip test (§4).

### 9. Done means (observable, per root `CLAUDE.md`)

- `pnpm install` succeeds.
- `pnpm lint` / `pnpm typecheck` pass with no changes.
- `anchor build` succeeds.
- `cargo test` and `vitest run` pass, including the new edge-case tests.
- `docker compose up` brings up `surfpool`, deploys the program, boots
  the frontend.
- Visiting `/` (manually or via the Playwright test) triggers the
  `noop` Server Action and displays a real transaction signature
  returned by the locally-deployed program — not just an inferred
  success.
- CircleCI green on all six jobs listed in §6.

## Out of scope for this ticket

- Any functional game/user/registry instruction (tickets 002+).
- Devnet deploy, CircleCI devnet-deploy job, production Docker image
  content beyond what §5/§6 need (ticket 004).
- Auth route groups, session mechanics (ticket 003 — still pending
  discussion per
  [002-pending-discussion.md](../../business-related/002-pending-discussion.md)).
