## Context

`create_game` (ticket 005, shipped) creates a `Game` PDA and its SPL mint, recording the creator as `Game.admin`. `join_game` (ticket 006, shipped) separately creates a player's Associated Token Account (ATA) for that mint and increments `Game.player_count`, using a *manual* CPI to the Associated Token Program (not Anchor's declarative `associated_token::init` account constraint) — deliberately, per [2026-08-06-join-game-public-design.md](../../../docs/superpowers/specs/2026-08-06-join-game-public-design.md) Q6, so a second join by the same player returns the friendly custom error `AlreadyJoinedGame` instead of a raw "account already in use" CPI failure. 006 Q4 explicitly deferred auto-joining the admin to a follow-up ticket (021, this change) rather than touching 005's shipped code.

This change makes `create_game` also create the admin's ATA, in the same instruction, resolving that deferral.

## Goals / Non-Goals

**Goals:**
- The game creator holds a zero-balance ATA for the game's mint immediately after `create_game`, with `Game.player_count == 1`.
- No separate `join_game` call needed for the creator.
- No behavior change to `join_game` or to `create_game`'s existing validation (name length/characters, registry capacity).

**Non-Goals:**
- Does not touch `join_game.rs`, `errors.rs`, or `state/game.rs` (no new `Game` field, no new error codes).
- Does not introduce a helper function shared between `create_game` and `join_game`'s ATA-creation code — see Decision 1.
- Does not add defensive capacity/duplicate-ATA checks to `create_game` — see Decision 2.

## Decisions

### Decision 1: Declarative `associated_token::init`, not a shared manual-CPI helper

`create_game`'s new `player_ata` account uses Anchor's declarative constraint:
```rust
#[account(
    init,
    payer = admin,
    associated_token::mint = mint,
    associated_token::authority = user,
)]
pub player_ata: Account<'info, TokenAccount>,
```
plus a new `associated_token_program: Program<'info, AssociatedToken>` account.

**Alternative considered:** extract `join_game`'s manual CPI (`associated_token::create` via `CpiContext`, gated by explicit `require!` checks) into a helper both instructions call — the literal reading of the ticket's "reusing join_game's create-ATA logic."

**Why declarative instead:** `join_game`'s manual-CPI approach exists *only* to produce a friendly error on a case that can't occur here — a duplicate join, or a full game. In `create_game`, the mint is always freshly created in the same instruction, so the ATA it derives from can never already exist, and `player_count` always starts at 0 (< `MAX_PLAYERS_PER_GAME`). Anchor's `init` constraint gives the identical on-chain guarantee (fails the transaction if the account exists) with less code and no new shared module. It's also why the client-side story is simpler: Codama's async instruction builder auto-derives `associated_token::`-constrained accounts (as it already does for `mint`/`game`/`user`/`registry`), so `apps/frontend/src/server/actions/game.ts`'s `createGame()` needs no changes — unlike `joinGame()`, which must compute and pass `playerAta` explicitly because `join_game`'s account is a bare `UncheckedAccount` with no such constraint for Codama to resolve.

### Decision 2: No defensive `require!` checks in `create_game`

`join_game` guards two conditions before creating the ATA: `GameFull` (`player_count < MAX_PLAYERS_PER_GAME`) and `AlreadyJoinedGame` (ATA not yet initialized). Neither is added to `create_game`: `player_count` is always 0 at this point in the instruction (an compile-time-obvious invariant, not a runtime condition), and the mint being freshly created in the same instruction makes a pre-existing ATA impossible. Anchor's `init` constraint already fails the transaction outright if the account somehow existed. Adding checks for unreachable states is dead code, not defense.

### Decision 3: `game.player_count = 1` set directly

The handler sets `game.player_count = 1;` alongside its other field writes (`bump`, `mint_bump`, `game_id`, `name`, `mode`, `admin`, `mint`), rather than `= 0` then `+= 1`. There is no shared increment logic between the two instructions (Decision 1 ruled that out), so the direct assignment is the plain statement of the invariant this instruction establishes.

## Risks / Trade-offs

- **[Risk] `create_game` and `join_game` now use two different patterns (declarative init vs. manual CPI) for structurally similar ATA-creation work** → Mitigation: the divergence is justified per-instruction (Decision 1) — `join_game` needs the manual path for its friendly-error requirement; `create_game` doesn't. This is documented here and in code comments so a future reader doesn't assume it's inconsistency to fix.
- **[Risk] IDL/account-list shape change for `create_game`** → Mitigation: purely additive to the accounts struct (2 new accounts appended); existing accounts (`admin`, `user`, `registry`, `game`, `mint`, `token_program`, `system_program`) and instruction args (`game_id`, `name`, `username`) are unchanged, so no breaking change to already-shipped callers of `create_game` beyond needing the regenerated client (which auto-resolves the new accounts, requiring no caller code changes — see Decision 1).

## Migration Plan

Standard instruction-level change, no data migration: `Game::INIT_SPACE` and the `Game` account layout are unchanged (no new field), so previously-created `Game` accounts remain valid and readable. Deploy path: land the Anchor program change → `anchor build` → regenerate `apps/on-chain-client` (`pnpm --filter on-chain-client run codegen`) → e2e/program tests pass against the new IDL → deploy to devnet via the existing CircleCI pipeline (ticket 004), same as any other instruction change.

## Open Questions

None — all design decisions were resolved in this change's grill-me session before spec/design were written.
