# 001 — Repo bootstrap & connection utility

**What to build:** A new V2 repo with a working local dev loop and a system-admin-wallet connection utility that every later ticket builds on. This ticket is prefactoring/infra, not a user-facing slice — nothing here is demoable as a product feature, but it must land first.

**Blocked by:** None — can start immediately

**Status:** done

- [x] New repo initialized: Next.js (app router) + TypeScript + TanStack React Query + React Context scaffolding, plus an Anchor program skeleton building successfully via `anchor build`. (Note: TanStack React Query and React Context are not yet wired as dependencies/providers — there's no server state to query nor cross-component state to share yet. Empty `apps/frontend/src/hooks/`, `apps/frontend/src/context/`, `apps/frontend/src/components/` placeholder directories were added to make the intended structure visible; installing an unused provider now would be speculative scaffolding. Wiring a real `QueryClientProvider`/Context provider is deferred to whichever ticket first needs one.)
- [x] A connection/signer utility reads the cluster type/provider and the system admin wallet keypair from environment variables, and exposes a lazy singleton Program/Connection accessor — all server-side code goes through it, nothing else constructs a `Connection`/`Program` directly.
- [x] CI pipeline runs lint, typecheck, `cargo test` (on-chain-program unit tests), and web unit tests on every PR. (Integration-level `on-chain-program-e2e` and browser `e2e` (Playwright) suites land once those apps exist — see [codebase-structure/002-decisions.md](../technical-related/codebase-structure/002-decisions.md) Q10–Q12 — but the CI job structure for them should be scaffolded here too.)
- [x] Local dev loop works end to end: a local validator + client can be brought up via docker compose, the program deploys locally, and the app boots against it.
- [x] No functional Solana instructions exist yet beyond a trivial no-op used to prove the plumbing works.
