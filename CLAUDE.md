# Game Token Wallet V2

## Project

Game Token Wallet V2 is a mobile-first Solana wallet dApp that lets non-Web3-savvy users tokenize offline group games (poker, mahjong) as on-chain SPL tokens.

- Users register with just a username/password (no wallet/seed phrase); a Solana PDA acts as their wallet, derived from a fee-payer + username.
- A game creator becomes admin of a per-game SPL token; players join public or password-protected private games (max 20 players) and transfer tokens per one of three modes: general P2P transfer, Holdem-style pooled showdown, or general pool with admin-controlled payouts.
- Admins manually mint/airdrop tokens when players deposit cash offline; tokens burn on account deletion, game quit, or game close.
- Everything (users, games, balances) lives on-chain — no off-chain DB — via a custom Anchor program, with a self-hosted Next.js/TS client (server holds the single system admin signing wallet for that deployment). Multi-tenancy was dropped: anyone wanting their own instance self-hosts a separate client + admin wallet against their own program deployment, not a shared one (see architecture decision Q3).
- Deployed to devnet via CircleCI; program ID and RPC URL are env-configurable rather than hardcoded.

Note: [002-pending-discussion.md](docs/business-related/002-pending-discussion.md) flags several unresolved items (password hashing algorithm, session mechanics, deposit/mint conversion rate, numeric caps for account sizing) that haven't been finalized yet.

### Tech Stack

Refer to tech stack written in [003-TECH-STACK.md](./docs/technical-related/architecture/003-TECH-STACK.md)

## Structure

Refer to codebase structure written in [001-CODEBASE-STRUCTURE.md](./docs/technical-related/codebase-structure/001-CODEBASE-STRUCTURE.md)

## Build & Verify

To be filled up when available.

```sh

```

TDD is expected: new code ships with tests for the happy path and 2+ edge cases (see Done Means).

## Critical Rules

- Do NOT commit directly to `main`
- Branch names MUST follow the rules in [branch-name-rule.md](.claude/rules/branch-name-rule.md)
- Do NOT suppress errors with broad excepts - fix the root cause
- Do NOT install dependencies without flagging it first (use `pnpm add`, never edit lockfiles by hand)
- Commits MUST follow Conventional Commits (enforced by [commit-msg](.hooks/commit-msg))

## Done Means

ALWAYS verify before claiming a task done/fixed/verified - passing tests are necessary but NOT sufficient. A task is complete only when ALL hold:

1. Format code and lint pass with no changes.
2. All unit tests passes (TDD - write a failing test first; new code ships with tests for the happy path and 2+ edge cases).
3. Behavior is observed on the running system, not just inferred. For any change with runtime behavior (eg. frontend UI, on-chain program behaviour, etc): boot all services, exercise the actual path, and confirm the observed output (HTTP status, response body, log line, etc) matches the acceptance criteria.

Do NOT say "done", "fixed", "verified", or "works" without that evidence in hand. If runtime behavior can't be observed, say so and name the blocker - never assume.

## Compaction

When compacting, preserve: modified file list, failing test/lint output, the current plan, and any decisions made explicitly this session.
