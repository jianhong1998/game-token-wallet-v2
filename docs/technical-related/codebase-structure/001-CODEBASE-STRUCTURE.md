# Codebase Structure

Source of truth for *where things go* in the repo. Finalized in a
`/grill-me` session before any scaffolding is written (ticket 001); the
rationale behind each part of this tree is recorded in
[002-decisions.md](./002-decisions.md).

---

## Tree

```
game-token-wallet-v2/
├── apps/
│   ├── frontend/                      # Next.js (App Router) client
│   │   ├── src/
│   │   │   ├── app/                   # routes; route groups (auth) vs (app)
│   │   │   ├── server/                # Connection/Program singleton, signer, Server Actions — only place chain access happens
│   │   │   ├── components/            # UI (mobile-first); Component.tsx + Component.test.tsx colocated
│   │   │   ├── hooks/                 # TanStack Query hooks wrapping server actions
│   │   │   ├── context/               # React Context providers
│   │   │   └── lib/                   # generic non-Solana utilities
│   │   ├── .env.template
│   │   └── package.json
│   │
│   ├── on-chain-program/              # Anchor program
│   │   ├── programs/<crate-name>/src/
│   │   │   ├── lib.rs
│   │   │   ├── state/                 # registry.rs, user.rs, game.rs — inline #[cfg(test)] mod tests per file for pure logic
│   │   │   ├── instructions/
│   │   │   │   ├── user/
│   │   │   │   ├── game/
│   │   │   │   ├── general_mode/
│   │   │   │   ├── poker_mode/
│   │   │   │   └── pool_mode/         # each — inline #[cfg(test)] mod tests per file for pure logic
│   │   │   └── errors.rs
│   │   ├── Anchor.toml                # test script points at ../on-chain-program-e2e
│   │   ├── .env.template
│   │   └── package.json
│   │
│   ├── on-chain-program-e2e/          # Anchor integration tests (anchor test), consumes apps/on-chain-client
│   │   ├── tests/
│   │   │   ├── user/
│   │   │   ├── game/
│   │   │   ├── general_mode/
│   │   │   ├── poker_mode/
│   │   │   └── pool_mode/
│   │   └── package.json
│   │
│   ├── e2e/                           # Playwright browser tests, drives apps/frontend
│   │   ├── tests/
│   │   │   ├── auth/
│   │   │   ├── game-creation/
│   │   │   ├── general-mode/
│   │   │   ├── poker-mode/
│   │   │   └── pool-mode/
│   │   ├── playwright.config.ts
│   │   └── package.json
│   │
│   └── on-chain-client/               # Anchor IDL + Codama-generated TS client; produced by on-chain-program, consumed by frontend and on-chain-program-e2e
│
├── docker/
│   ├── local/                         # Dockerfile(s) for local dev loop (frontend dev image, Surfpool) — used by root docker-compose.yml
│   └── deployment/                    # Production Dockerfile for self-hosted client image + its own .env.template — also used by docker-compose.e2e.yml
│
├── docs/                              # business-related, technical-related, tickets (already structured; out of scope here)
├── .circleci/
│   └── config.yml                     # lint, typecheck, cargo test, on-chain-program-e2e, e2e, web unit tests — all on every PR
├── docker-compose.yml                 # local dev stack only (frontend dev image + Surfpool)
├── docker-compose.e2e.yml             # CI test stack — prod-built frontend image (via docker/deployment) + Surfpool + program deploy
├── pnpm-workspace.yaml                # apps/*
├── package.json                       # workspace root: lint/typecheck/test fan-out scripts
├── tsconfig.base.json                 # shared by apps/frontend + apps/on-chain-client
├── .eslintrc / prettier config        # shared
└── Justfile
```

See [002-decisions.md](./002-decisions.md) for the rationale behind each
choice above.
