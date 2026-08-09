# Auto-join admin as player at game creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ticket:** [docs/tickets/021-auto-join-admin-at-creation.md](../../tickets/021-auto-join-admin-at-creation.md)
**Spec:** [openspec/changes/auto-join-admin-at-creation/](../../../openspec/changes/auto-join-admin-at-creation/)

**Goal:** `create_game` creates the admin's own Associated Token Account (ATA) for the new game's mint in the same instruction, so the creator is immediately a player (`Game.player_count == 1`) with a zero balance — no separate `join_game` call.

**Architecture:** Add one declarative `associated_token::init`-constrained account (`player_ata`) plus the `associated_token_program` account to `CreateGame`'s Anchor accounts struct; set `game.player_count = 1` directly in the handler. No shared code with `join_game` (its manual-CPI approach exists only to produce a friendly error on cases — duplicate join, full game — that are structurally impossible in `create_game`, since its mint is always freshly created in the same instruction). Regenerate the Codama TS client from the updated IDL; because the new account is declaratively constrained, Codama auto-derives it, so no frontend code changes.

**Tech Stack:** Rust / Anchor 1.x (`apps/on-chain-program`), Codama-generated TS client (`apps/on-chain-client`), Vitest against a live Surfpool validator (`apps/on-chain-program-e2e`).

## Global Constraints

- No new `Game` field, no `Game::INIT_SPACE` change, no new error codes, no changes to `join_game.rs` or `errors.rs` (design.md Non-Goals).
- No defensive `require!` checks added to `create_game`'s handler — `GameFull`/`AlreadyJoinedGame`-style conditions are structurally unreachable here (design.md Decision 2).
- No new Rust `#[cfg(test)]` unit test in `create_game.rs` — no new branching logic to isolate, and `Game::INIT_SPACE`'s layout is already guarded in `state/game.rs`, unaffected by this change (design.md).
- `apps/frontend`'s `createGame()` Server Action and its test require zero changes — the new account is Codama-auto-resolved (design.md Decision 1).
- Conventional Commits for every commit message; branch name already `docs/021-plan-for-implementation` per this repo's branch-name rule — implementation work should land on a `feat/021-...` branch per [.claude/rules/branch-name-rule.md](../../../.claude/rules/branch-name-rule.md).

---

## Prerequisites (once, before Task 1)

The e2e test in Task 1 runs against a live local Surfpool validator with the program already deployed. Before starting:

```bash
just up-build   # first time only; use `just up` on subsequent runs
```

Leave this running in the background for the duration of Task 1 and Task 2 (both re-deploy/rebuild the program via `anchor test` / `anchor build`, which target the already-running validator — see `just deploy-program-local` and `test-e2e-program` in the repo's `justfile`).

---

### Task 1: `create_game` creates the admin's ATA and sets `player_count = 1`

**Files:**
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs`
- Test: `apps/on-chain-program-e2e/tests/game/create_game.test.ts`

**Interfaces:**
- Consumes: existing `CreateGame` accounts struct and `handler` in `create_game.rs` (unchanged accounts: `admin`, `user`, `registry`, `game`, `mint`, `token_program`, `system_program`; unchanged instruction args: `game_id: [u8; 16]`, `name: String`, `username: String`).
- Produces: `CreateGame` gains two new accounts (`player_ata: Account<'info, TokenAccount>`, `associated_token_program: Program<'info, AssociatedToken>`), appended after `mint` and after `token_program` respectively, matching `join_game.rs`'s existing account ordering convention. `Game.player_count` is `1` immediately after `create_game`, not `0`. No new instruction args, no new error codes, no accounts removed — later tasks (client regen) rely on this exact account list and order.

- [ ] **Step 1: Extend the e2e test's imports (failing test setup)**

In `apps/on-chain-program-e2e/tests/game/create_game.test.ts`, replace the two existing import statements for `@solana-program/token` and `on-chain-client` with:

```typescript
import { fetchMint, fetchToken, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  findGamePda,
  findUserPda,
  fetchGame,
  findRegistryPda,
  fetchRegistry,
  GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH,
  GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS,
  isGameTokenWalletError,
} from "on-chain-client";
```

(This adds `fetchToken`, `findAssociatedTokenPda`, `TOKEN_PROGRAM_ADDRESS` to the `@solana-program/token` import, and `findUserPda` to the `on-chain-client` import — both packages are already project dependencies used the same way in `join_game.test.ts`, so nothing new to install.)

- [ ] **Step 2: Extend the happy-path test with the new assertions (still a failing test)**

In the same file, inside `describe("create_game instruction", ...)`, extend the first `it(...)` block. Find this existing tail:

```typescript
    const mint = await fetchMint(rpc, game.data.mint);
    expect(mint.data.decimals).toBe(2);
    expect(mint.data.mintAuthority).toEqual({ __option: "Some", value: gameAddress });
  }, 30_000);
```

Replace it with:

```typescript
    const mint = await fetchMint(rpc, game.data.mint);
    expect(mint.data.decimals).toBe(2);
    expect(mint.data.mintAuthority).toEqual({ __option: "Some", value: gameAddress });

    expect(game.data.playerCount).toBe(1);

    const [userAddress] = await findUserPda({ username: "gamehost1", admin: admin.address });
    const [playerAta] = await findAssociatedTokenPda({
      owner: userAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const token = await fetchToken(rpc, playerAta);
    expect(token.data.owner).toBe(userAddress);
    expect(token.data.amount).toBe(0n);
  }, 30_000);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `just test-e2e-program`
Expected: FAIL — either `game.data.playerCount` is `0` (not `1`), or `fetchToken(rpc, playerAta)` throws because no account exists at that address yet (the current `create_game` doesn't create it).

- [ ] **Step 4: Implement the Rust change**

In `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs`, replace the top imports:

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
```

with:

```rust
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
```

Then, in the `CreateGame` accounts struct, insert a new `player_ata` field right after the existing `mint` field:

```rust
    #[account(
        init,
        payer = admin,
        mint::decimals = 2,
        mint::authority = game,
        seeds = [b"mint", game.key().as_ref()],
        bump,
    )]
    pub mint: Account<'info, Mint>,

    // The creator's own player Associated Token Account for `mint`, created
    // in this same instruction so the creator is a player (not just admin)
    // immediately — no separate join_game call needed. Unlike join_game's
    // player_ata (a manually-CPI'd UncheckedAccount, so a duplicate join
    // can return the friendly AlreadyJoinedGame error instead of a raw CPI
    // failure), `mint` above is always freshly created earlier in this same
    // instruction, so this ATA can never already exist — Anchor's
    // declarative `init` constraint gives the identical guarantee with no
    // manual CPI or require! checks needed.
    #[account(
        init,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub player_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
```

(This replaces the struct's existing tail — the old `pub token_program: Program<'info, Token>,` / `pub system_program: Program<'info, System>,` two lines become the three lines shown above, with `associated_token_program` inserted between them.)

Then, in the `handler` function, replace:

```rust
    game.mint = ctx.accounts.mint.key();
    // Plan snippet referenced `ctx.accounts.creator_user`, but this file's
    // account field is named `user` (see the struct's Codama-canonicalization
    // comment above) — using the actual existing field, not the stale name.
    game.player_count = 0;
```

with:

```rust
    game.mint = ctx.accounts.mint.key();
    // The creator's player_ata (above) is created in this same instruction,
    // so player_count starts at 1, not 0 — no separate join_game call
    // needed for the creator to count as a player.
    game.player_count = 1;
```

- [ ] **Step 5: Run the Rust unit tests (fast compile/regression check)**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: PASS — no unit tests changed or added (per Global Constraints), this just confirms the crate still compiles and existing tests (e.g. `state/game.rs`'s `Game::INIT_SPACE` guard, `create_game.rs`'s `ensure_registry_has_capacity` tests) are unaffected.

- [ ] **Step 6: Run the e2e test to verify it passes**

Run: `just test-e2e-program`
Expected: PASS — this rebuilds and redeploys the program (via `anchor test --skip-local-validator`) against the running local validator from Prerequisites, then runs all `apps/on-chain-program-e2e` tests including the extended `create_game.test.ts` and the untouched `join_game.test.ts` (confirms no regression to `join_game`'s own ATA-creation/duplicate-join/capacity behavior).

- [ ] **Step 7: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs apps/on-chain-program-e2e/tests/game/create_game.test.ts
git commit -m "feat(021): create_game auto-joins admin as a player"
```

---

### Task 2: Regenerate the on-chain TS client

**Files:**
- Modify (regenerated, not hand-edited): `apps/on-chain-client/src/generated/instructions/createGame.ts` and any other files the codegen script touches.

**Interfaces:**
- Consumes: the updated on-chain program IDL produced by `anchor build` from Task 1's `CreateGame` accounts struct (7 accounts → 9 accounts: `admin`, `user`, `registry`, `game`, `mint`, `player_ata`, `token_program`, `associated_token_program`, `system_program`).
- Produces: a regenerated `getCreateGameInstructionAsync` whose `CreateGameAsyncInput` type does **not** require a `playerAta` argument (Codama auto-derives it from the `associated_token::` constraint, the same way it already auto-derives `mint`/`game`/`user`/`registry`) — this is what later verification confirms `apps/frontend`'s `createGame()` action needs no changes for.

- [ ] **Step 1: Rebuild the on-chain program to refresh its IDL**

Run:
```bash
cd apps/on-chain-program && anchor build
```
Expected: builds successfully (Task 1's e2e test run already exercised this build path, so this should be a no-op rebuild confirming the IDL is current).

- [ ] **Step 2: Regenerate the Codama client**

Run:
```bash
pnpm --filter on-chain-client run codegen
```
Expected: exits 0; `git status` shows changes under `apps/on-chain-client/src/generated/` (at minimum `instructions/createGame.ts` gaining `playerAta` and `associatedTokenProgram` account handling, mirroring `joinGame.ts`'s existing shape for `associatedTokenProgram`, but with `playerAta` auto-resolved rather than required — confirm by reading the regenerated `CreateGameAsyncInput` type and its "Resolve default values" block).

- [ ] **Step 3: Run the on-chain-client test suite**

Run: `pnpm --filter on-chain-client run test`
Expected: PASS.

- [ ] **Step 4: Confirm the frontend needs no changes**

Run:
```bash
pnpm --filter frontend run test -- game.test.ts
```
Expected: PASS with zero source changes to `apps/frontend/src/server/actions/game.ts` or `apps/frontend/src/server/actions/game.test.ts` — the existing `"creates the game and sends the transaction on success"` test's exact-args assertion on `getCreateGameInstructionAsync` (no `playerAta` in the expected call) continues to hold, confirming Codama auto-resolution as designed.

- [ ] **Step 5: Commit**

```bash
git add apps/on-chain-client
git commit -m "chore(021): regenerate on-chain client for create_game's new accounts"
```

---

### Task 3: Full verification and documentation updates

**Files:**
- Modify: `docs/tickets/021-auto-join-admin-at-creation.md` (check off ACs, add reciprocal `**Plan:**` link)
- Modify: `docs/tickets/000-index.md` (status → Done)
- Modify: `openspec/changes/auto-join-admin-at-creation/tasks.md` (check off completed tasks)

**Interfaces:**
- Consumes: the working `create_game` behavior from Task 1 and the regenerated client from Task 2 — this task only runs/observes, no further code changes to program or client.
- Produces: nothing new code-facing; this is the Done-Means verification gate plus doc/spec bookkeeping.

- [ ] **Step 1: Run the full lint/typecheck gate**

Run:
```bash
just lint
just typecheck
```
Expected: both clean (no changes needed). Note: this repo's `CLAUDE.local.md` flags that a local `rtk` hook may silently rewrite `pnpm lint` into a broader, unrelated command — if `just lint` fails unexpectedly, re-verify with `rtk proxy pnpm lint` before treating it as a real regression.

- [ ] **Step 2: Run the full test gate**

Run: `just test`
Expected: PASS — this runs `cargo test`, `test-ui`, `test-on-chain-client`, `test-e2e-program`, and both docker-compose e2e suites (`on-chain-program-e2e` and the Playwright `e2e` suite), covering everything Tasks 1–2 already ran individually plus the full frontend Playwright flow.

- [ ] **Step 3: Manually observe the runtime behavior**

With the stack running (`just up`, already up from Prerequisites) and using the browser:
1. Register/log in as a new user.
2. Create a game via the existing "New game" flow.
3. Navigate to that game's detail page (`/games/[address]`, from ticket 006).
4. Confirm the creator appears in the "Players" list with a balance of `0`, and that this required no separate "Join" action — the creator was never shown a Join affordance for their own game.

Record the observed result (e.g. a short note or screenshot) — per this repo's Done-Means rule, this manual observation is required evidence before the ticket can be marked done, since it's runtime behavior that automated tests alone don't fully substitute for from a user's perspective.

- [ ] **Step 4: Update ticket and index docs**

In `docs/tickets/021-auto-join-admin-at-creation.md`:
- Check off all 4 acceptance-criteria checkboxes.
- Add a `**Plan:**` line pointing to `docs/superpowers/plans/2026-08-09-auto-join-admin-at-creation.md`, alongside the ticket's existing content (per this repo's planning-workflow doc, plans link back to their ticket and the ticket links back to its plan).
- Update `**Status:**` from `ready-for-agent` to `Done`.

In `docs/tickets/000-index.md`, change ticket 021's status cell from `Pending` to `Done`, and update the Mermaid diagram's `classDef done` node list to include `021`.

- [ ] **Step 5: Sync the openspec change**

Run:
```bash
openspec validate --changes "auto-join-admin-at-creation"
```
Expected: still passes. Then check off all items in `openspec/changes/auto-join-admin-at-creation/tasks.md` to reflect completed work, and run the `openspec-sync-specs` skill (or `openspec-archive-change` if this is the final change for ticket 021, which it is) to fold `openspec/changes/auto-join-admin-at-creation/specs/game/spec.md`'s delta into `openspec/specs/game/spec.md`.

- [ ] **Step 6: Commit**

```bash
git add docs/tickets/021-auto-join-admin-at-creation.md docs/tickets/000-index.md openspec/changes/auto-join-admin-at-creation/tasks.md openspec/specs/game/spec.md openspec/changes/auto-join-admin-at-creation
git commit -m "docs(021): close out auto-join-admin-at-creation ticket and spec"
```

---

## Self-Review

**Spec coverage** (against `openspec/changes/auto-join-admin-at-creation/specs/game/spec.md`'s modified "Game creation" requirement and its two scenarios):
- "Successful creation" scenario (unchanged behavior: `Game` PDA + mint created, creator set as admin, registry updated) — already covered by the existing, untouched first part of Task 1's e2e test; not re-verified as a new task since it's pre-existing passing behavior.
- "Creator is admin and a player from creation" scenario (creator's ATA created with zero balance, `player_count` set to 1, no separate `join_game` call) — covered by Task 1 (program change + e2e assertions) and Task 3 Step 3 (manual runtime observation of the players list / no Join affordance).
- Ticket 021's 4 checkboxes: (1) ATA creation + `player_count` increment in the same instruction → Task 1. (2) Creator visible in players list with zero balance, no separate join → Task 1's e2e assertions + Task 3 Step 3. (3) Existing `create_game` behavior unchanged → Task 1's untouched assertions + Global Constraints (no accounts removed, no arg changes) + full `just test` gate in Task 3. (4) Filed as follow-up, not amending 005 → satisfied by construction (this plan only touches `create_game.rs`, never 005's other shipped files).

**Placeholder scan:** no TBD/TODO markers; every step has literal code or an exact runnable command.

**Type consistency:** `player_ata: Account<'info, TokenAccount>` (Task 1) matches `TokenAccount` imported from `anchor_spl::token` (Task 1's import change). `game.player_count = 1` (Task 1) matches the e2e assertion `expect(game.data.playerCount).toBe(1)` (Task 1, same task). `findUserPda`/`findAssociatedTokenPda`/`fetchToken`/`TOKEN_PROGRAM_ADDRESS` (Task 1's test) are the same names already used identically in the neighboring, unmodified `join_game.test.ts`, so no naming drift introduced.
