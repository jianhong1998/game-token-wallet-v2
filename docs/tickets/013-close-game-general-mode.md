# 013 — Close game (General Mode)

**What to build:** A game admin can end a game entirely, burning all outstanding player balances and reclaiming rent.

**Blocked by:** 002, 009

**Status:** ready-for-agent

- [ ] `close_game` instruction, admin-only: burns every remaining player's token balance, closes all player ATAs, closes the game's mint and any game-owned token accounts, reclaiming rent to the system admin wallet.
- [ ] Removes the game's entry from the `Registry`.
- [ ] Succeeds regardless of in-progress activity — no blocking state check. (This ticket only needs General Mode's player-wallet burning to be correct; Poker/Pool pot-burning is added in 015/016, which extend this instruction.)
- [ ] After closing, the game no longer appears in the browse-games list, and any lingering client references (e.g. a player's own game list) reflect the closure.
