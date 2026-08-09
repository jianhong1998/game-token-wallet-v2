## Why

Today a game's creator is only its admin — they must separately call `join_game` to appear in their own player list or hold a balance. This is a needless extra step for every game, deferred out of 006's scope (see [2026-08-06-join-game-public-design.md](../../../docs/superpowers/specs/2026-08-06-join-game-public-design.md) Q4) specifically to avoid churning 005's already-shipped tests. Ticket 021 now owns closing that gap: `create_game` should create the admin's own player ATA in the same instruction, so the creator is immediately a player with no separate `join_game` call.

## What Changes

- `create_game`'s on-chain accounts struct gains a `player_ata` account, created via Anchor's declarative `associated_token::init` constraint (`associated_token::mint = mint, associated_token::authority = user`), plus the `associated_token_program` account the constraint requires.
- The handler sets `game.player_count = 1` (was `0`) alongside its existing field writes — no defensive capacity/duplicate checks are added, since both are structurally unreachable in this instruction (the mint is always freshly created in the same transaction, and `player_count` always starts at 0 < `MAX_PLAYERS_PER_GAME`).
- Because the new account is declared with Anchor's `associated_token::` constraint (not a bare `UncheckedAccount`, unlike `join_game`'s `player_ata`), Codama's generated async instruction builder auto-derives it — no frontend code changes to `createGame()`.
- `apps/on-chain-client`'s generated client is regenerated from the updated IDL (mechanical step, not itself a spec change).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `game`: the "Game creation" requirement's "Creator is admin, not automatically a player" scenario is replaced — the creator is now also a player (their own ATA exists, balance zero) immediately after creation, no separate `join_game` call needed.

## Impact

- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs` — accounts struct + handler.
- `apps/on-chain-program-e2e/tests/game/create_game.test.ts` — extend existing happy-path test with new assertions.
- `apps/on-chain-client` — regenerated IDL-derived TS client (no hand-written source changes).
- No changes to `apps/frontend` application code (only the regenerated client dependency), no changes to `state/game.rs` (no new `Game` field), no changes to `errors.rs` (no new error codes).
