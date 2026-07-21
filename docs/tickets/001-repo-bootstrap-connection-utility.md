# 001 — Repo bootstrap & connection utility

**What to build:** A new V2 repo with a working local dev loop and a system-admin-wallet connection utility that every later ticket builds on. This ticket is prefactoring/infra, not a user-facing slice — nothing here is demoable as a product feature, but it must land first.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] New repo initialized: Next.js (app router) + TypeScript + TanStack React Query + React Context scaffolding, plus an Anchor program skeleton building successfully via `anchor build`.
- [ ] A connection/signer utility reads the cluster type/provider and the system admin wallet keypair from environment variables, and exposes a lazy singleton Program/Connection accessor — all server-side code goes through it, nothing else constructs a `Connection`/`Program` directly.
- [ ] CI pipeline runs lint, typecheck, `anchor test`, and web unit tests on every PR.
- [ ] Local dev loop works end to end: a local validator + client can be brought up via docker compose, the program deploys locally, and the app boots against it.
- [ ] No functional Solana instructions exist yet beyond a trivial no-op used to prove the plumbing works.
