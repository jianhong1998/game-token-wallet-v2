# 011 — Quit game

**What to build:** A player can leave a game, forfeiting their current in-game balance.

**Blocked by:** 009

**Status:** ready-for-agent

- [ ] `quit_game` instruction burns the player's remaining game-token balance, closes their ATA (rent reclaimed), and removes them from the game's player list.
- [ ] Allowed unconditionally — no blocking on round/pot state (per [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q11). This ticket only needs General Mode to exist, so there's no pot to reconcile yet.
- [ ] Frontend has a "quit game" action with a confirmation step, since the burn is irreversible.
- [ ] After quitting, the player no longer appears in the game's player list or in admin-facing recipient/payout pickers.
