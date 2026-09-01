# 013 — Close game (General Mode)

**What to build:** A game admin can end a game entirely, burning all outstanding player balances and reclaiming rent.

**Blocked by:** 002, 009

**Status:** Done — verified 2026-08-30 (see Verification below); spec archived.

**Spec:** [openspec/changes/archive/2026-08-30-close-game/](../../openspec/changes/archive/2026-08-30-close-game/) (synced to `openspec/specs/{close-game,game,registry}/`)
**Plan:** [docs/superpowers/plans/2026-08-25-close-game.md](../superpowers/plans/2026-08-25-close-game.md)

- [x] `close_game` instruction, admin-only: burns every remaining player's token balance, closes all player ATAs, closes the `Game` account, reclaiming rent to the system admin wallet. **Constraint discovered during planning:** the game's SPL mint uses the legacy SPL Token program, which has no instruction capable of closing/reclaiming rent from a `Mint` account (only Token-2022's `MintCloseAuthority` extension supports that) — the mint itself is therefore left on-chain, unclosed, as a permanent per-game rent cost; see `openspec/changes/close-game/design.md` D3.
- [x] Removes the game's entry from the `Registry`.
- [x] Succeeds regardless of in-progress activity — no blocking state check. (This ticket only needs General Mode's player-wallet burning to be correct; Poker/Pool pot-burning is added in 015/016, which extend this instruction.)
- [x] After closing, the game no longer appears in the browse-games list, and any lingering client references (e.g. a player's own game list) reflect the closure.

## Verification (2026-08-30)

All 4 ACs met. Implementation in `feat(013)` (#36, merged).

- **AC1** — `close_game_player.rs` (admin check, burns actual ATA balance, closes ATA rent→admin, `player_count -= 1`) + `close_game.rs` (admin check, `GameNotEmpty` gate, `close = admin` on `Game`; mint deliberately untouched — see design D3). Client `closeGame` orchestrates discovery → chunked `close_game_player` → final `close_game`.
- **AC2** — `close_game.rs` handler: `find_registry_index` + `swap_remove` on `registry.active_games`.
- **AC3** — no round/pot/activity gate in either instruction; only precondition is `player_count == 0` (a data precondition the client resolves), matching spec "succeeds regardless of in-progress activity".
- **AC4** — listings derive from `registry.active_games`; `fetchGameDetail` returns null once `Game` closed. e2e `close-game.spec.ts` asserts removal from browse list, admin home, and ex-player dashboard.

Gates: `cargo test` 22✓, frontend unit 260✓ (incl. `CloseGameButton.test.tsx`, `game.test.ts`), `on-chain-client` 8✓, lint✓, typecheck✓. CI on #36 green (cargo-test, e2e, on-chain-program-e2e, lint, typecheck, web-unit-tests).
