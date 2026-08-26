# 013 — Close game (General Mode)

**What to build:** A game admin can end a game entirely, burning all outstanding player balances and reclaiming rent.

**Blocked by:** 002, 009

**Status:** Done

**Spec:** [openspec/changes/close-game/](../../openspec/changes/close-game/)
**Plan:** [docs/superpowers/plans/2026-08-25-close-game.md](../superpowers/plans/2026-08-25-close-game.md)

- [x] `close_game` instruction, admin-only: burns every remaining player's token balance, closes all player ATAs, closes the `Game` account, reclaiming rent to the system admin wallet. **Constraint discovered during planning:** the game's SPL mint uses the legacy SPL Token program, which has no instruction capable of closing/reclaiming rent from a `Mint` account (only Token-2022's `MintCloseAuthority` extension supports that) — the mint itself is therefore left on-chain, unclosed, as a permanent per-game rent cost; see `openspec/changes/close-game/design.md` D3.
- [x] Removes the game's entry from the `Registry`.
- [x] Succeeds regardless of in-progress activity — no blocking state check. (This ticket only needs General Mode's player-wallet burning to be correct; Poker/Pool pot-burning is added in 015/016, which extend this instruction.)
- [x] After closing, the game no longer appears in the browse-games list, and any lingering client references (e.g. a player's own game list) reflect the closure.
