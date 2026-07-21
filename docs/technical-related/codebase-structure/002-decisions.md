# Codebase Structure — Decisions

Decision record from the `/grill-me` session that produced
[001-CODEBASE-STRUCTURE.md](./001-CODEBASE-STRUCTURE.md), before any
scaffolding is written (ticket 001). Derived from
[003-TECH-STACK.md](../architecture/003-TECH-STACK.md) and
[002-architecture-decisions.md](../architecture/002-architecture-decisions.md).

---

## Q1: Are `apps/frontend` and `apps/on-chain-program` linked, or fully independent toolchains?

**Answer:** Linked via a pnpm workspace.

**Decision:** Root `package.json` + `pnpm-workspace.yaml` covering `apps/*`
and `packages/*`. A shared package (see Q2) carries the generated Anchor
IDL/client types so the frontend consumes them as a workspace dependency.

**Reason:** The frontend's server-side code needs the Anchor IDL/generated
client to talk to the program. A workspace link keeps that a type-checked
dependency instead of a manually-copied JSON file that silently drifts out
of sync after program changes.

---

## Q2: How is the shared package under `packages/` organized?

**Answer:** A single package, `packages/on-chain-client/`.

**Decision:** Holds the Anchor IDL JSON plus the Codama-generated TS client
(instructions, accounts, PDA helpers). `apps/on-chain-program` generates into
it (`anchor build` → Codama codegen); `apps/frontend` depends on it as a
workspace package. No separate `shared-types`/`idl`-only split.

**Reason:** The project's scope doesn't justify splitting shared code into
multiple packages yet — one package is simpler to depend on and evolve.
Split later only if a second genuinely independent consumer appears.

---

## Q3: How is `apps/on-chain-program`'s Rust source organized internally?

**Answer:** `state/` + `instructions/<mode>/` subfolders, single program crate.

**Decision:**
- `state/` — one file per account type: `registry.rs`, `user.rs`, `game.rs`
  (matches the three account types in
  [002-architecture-decisions.md](../architecture/002-architecture-decisions.md) Q17).
- `instructions/` — split into subfolders by concern: `user/`, `game/`,
  `general_mode/`, `poker_mode/`, `pool_mode/`.
- `errors.rs` — single shared error enum.
- One Anchor program crate (not a multi-program workspace) — matches "a
  custom Anchor program" (singular) in the project description.

**Reason:** Mode-based instruction grouping mirrors how the three game modes
are conceptually separate (different eligibility/payout rules per
architecture Q5/Q10) while sharing the same account types — grouping by mode
keeps each mode's instruction set easy to find and review in isolation.

---

## Q4: How is `apps/frontend` organized at the top level?

**Answer:** `src/` with `app/`, `server/`, `components/`, `hooks/`,
`context/`, `lib/`.

**Decision:** `server/` is a dedicated top-level concern — the lazy singleton
`Connection`/`Program` accessor, the signer, and Server Actions that touch
the chain — kept separate from generic `lib/` utilities. `app/` uses route
groups to separate `(auth)` from authenticated `(app)` sections.

**Reason:** The custodial wallet model
([003-TECH-STACK.md](../architecture/003-TECH-STACK.md) — Server section)
means *all* chain access is server-side and funnels through one utility
(ticket 001: "nothing else constructs a Connection/Program directly").
Giving that its own top-level folder makes the constraint visible in the
directory layout, not just enforced by convention.

---

## Q5: How does `docker/` split between `local/` and `deployment/`, and what does root `docker-compose.yml` cover?

**Answer:** `local/` = dev stack, `deployment/` = production Dockerfile only.

**Decision:**
- `docker/local/` — Dockerfiles/config for the local dev loop (frontend dev
  image, Surfpool container), consumed by the root `docker-compose.yml`.
- `docker/deployment/` — the production Dockerfile for the self-hosted
  client image (built/pushed by CircleCI, reusable by third-party
  self-hosters), plus its own `.env.template`. No compose file here.
- Root `docker-compose.yml` orchestrates only the local dev stack
  (frontend + Surfpool).

**Reason:** Local dev is a multi-service orchestration problem (compose fits
naturally); production deployment is "build and run one image" per
[003-TECH-STACK.md](../architecture/003-TECH-STACK.md) — adding a compose
file there would imply orchestration that doesn't exist.

---

## Q6: Is root-level TS/lint config shared across the workspace, and where does CI config live?

**Answer:** Shared root config; CI at repo root.

**Decision:** Root `tsconfig.base.json` and root ESLint/Prettier config are
shared by `apps/frontend` and `packages/on-chain-client` (both TS).
`apps/on-chain-program`'s Rust code is unaffected, but its `tests/` dir
(Anchor's TS tests) still extends the root TS config for consistency.
`.circleci/config.yml` lives at the repo root (standard convention), running
lint, typecheck, `anchor test`, and web unit tests per
[001-repo-bootstrap-connection-utility.md](../../tickets/001-repo-bootstrap-connection-utility.md).

**Reason:** Avoids duplicating lint/TS config across every TS package in the
workspace; a single source of truth for style rules is cheap to maintain at
this repo's size.

---

## Q7: Where do frontend unit tests live relative to source files?

**Answer:** Colocated.

**Decision:** `Component.test.tsx` sits next to `Component.tsx`, and the same
pattern applies in `hooks/` and `server/`. No mirrored top-level `tests/`
tree for the frontend. Anchor-side tests stay in
`apps/on-chain-program/tests/` — Anchor's own convention, non-negotiable
since that's where `anchor test` looks.

**Reason:** Colocation keeps a source file and its tests moving together
through refactors, matches Next.js/vitest convention, and directly supports
the TDD requirement in the root `CLAUDE.md` (new code ships with tests for
the happy path and 2+ edge cases).

---

## Q8: Where do `.env.template` file(s) live?

**Answer:** Per-app.

**Decision:** `apps/frontend/.env.template` and
`apps/on-chain-program/.env.template`, each app owns its own env surface.
`docker/deployment/` additionally carries its own `.env.template` documenting
the runtime vars a self-hoster must supply to the production image.

**Reason:** Env is owned by whichever app actually reads it at runtime
([003-TECH-STACK.md](../architecture/003-TECH-STACK.md): cluster/RPC URL,
system admin wallet keypair, program ID are all read at runtime, not build
time) — keeping the template beside the app that consumes it avoids a
root-level file that silently goes stale as each app's env needs evolve
independently.

---

## Q9: A stray `apps/api-test/` folder appeared — what is it, and should it stay?

**Answer:** Dropped entirely.

**Decision:** No `apps/api-test`. The frontend uses Server Actions
exclusively — there are no Next.js Route Handlers (`app/api/*`) — so there is
no separate HTTP-route surface for an "API test" tier to target. Server
Action logic is covered by colocated frontend unit tests (Q7) and by `e2e`
flows; no dedicated non-browser HTTP test app exists.

**Reason:** The folder was created by mistake before this was checked. Once
confirmed no API routes exist, keeping an empty/purposeless test tier would
just be structure without a job to do.

---

## Q10: `apps/on-chain-program/tests/` is being replaced by `apps/on-chain-program-e2e` — what changes, and what does it consume?

**Answer:** Anchor's integration tests move to a new top-level app; it
consumes `packages/on-chain-client`.

**Decision:**
- `apps/on-chain-program/tests/` is removed. Its contents move to
  `apps/on-chain-program-e2e/tests/`, grouped by mode to mirror
  `on-chain-program`'s own `instructions/<mode>/` split: `user/`, `game/`,
  `general_mode/`, `poker_mode/`, `pool_mode/`.
- `on-chain-program/Anchor.toml`'s `[scripts] test` command is updated to
  point at the new location instead of a nested `tests/` dir.
- `on-chain-program-e2e` depends on `packages/on-chain-client` (the same
  generated IDL/client the frontend uses) rather than constructing its own
  raw `@coral-xyz/anchor Program` from the IDL independently.

**Reason:** Consuming the shared generated client dogfoods the exact code
path the frontend depends on — a codegen bug gets caught here before it
reaches the frontend — and keeps one canonical way of talking to the program
in the repo instead of two. Mirroring the mode grouping keeps "which e2e
test covers this instruction" obvious as the test suite grows.

---

## Q11: Where do Rust unit tests for `on-chain-program`'s logic live?

**Answer:** Inline `#[cfg(test)] mod tests` per file.

**Decision:** Unit tests for non-trivial pure logic (side-pot math, odd-chip
remainder calculation, etc.) live in a `#[cfg(test)] mod tests { use
super::*; ... }` block at the bottom of the same file, in `state/*.rs` and
`instructions/**/*.rs`. Run via plain `cargo test` — no validator or
Surfpool needed. No separate mirrored test directory.

**Reason:** This is Rust's own convention (*The Rust Programming Language*,
ch. 11), not just a style choice — `cargo test`, rustfmt, and clippy are all
built around colocated unit tests, and integration-level testing already has
its home in `on-chain-program-e2e` (Q10). Also consistent with the
colocation choice already made for frontend tests (Q7).

---

## Q12: Do the new test suites (`cargo test`, `on-chain-program-e2e`, `e2e`) run on every PR, or are the slower ones gated to merge-to-main?

**Answer:** All run on every PR.

**Decision:** `.circleci/config.yml` runs lint, typecheck, `cargo test`,
`on-chain-program-e2e`, `e2e` (Playwright), and frontend unit tests on every
PR — one CI bar, no fast-PR/slow-main split.

**Reason:** At this project's current size, none of the new suites are slow
enough to justify a split. Revisit only if `e2e` (the most likely candidate)
grows slow enough that PR turnaround actually suffers.

---

## Q13: What stack do `e2e` and `on-chain-program-e2e` run against in CI, and how does that relate to `docker/local`?

**Answer:** A separate, prod-parity compose file — `docker-compose.e2e.yml`
— not the local dev stack.

**Decision:**
- Root `docker-compose.e2e.yml` (alongside `docker-compose.yml`) orchestrates
  the frontend image (built via `docker/deployment`'s production Dockerfile,
  not `docker/local`'s dev image) + Surfpool + a program-deploy step — the
  same shape of full loop as local dev, but production-built.
- CI boots this stack before running `e2e` and `on-chain-program-e2e`.
  `docker/local`'s stack remains dev-only, unused by CI.

**Reason:** Testing against a production-built image in CI catches
"works in dev, breaks in prod build" bugs that a dev-mode/hot-reload image
would mask — a meaningfully different guarantee than the local dev loop
(Q5) is meant to provide, so it gets its own compose file rather than
reusing `docker/local`'s.
