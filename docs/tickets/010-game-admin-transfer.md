# 010 — Game admin transfer

**What to build:** The current game admin can hand off the admin role to another player already in the game.

**Blocked by:** 006

**Status:** ready-for-agent

- [ ] `transfer_game_admin` instruction: only callable by the current admin, target must already be a player in the game, updates the game's stored admin pubkey.
- [ ] Outgoing admin remains a regular player afterward — not removed from the game.
- [ ] Admin sees a "transfer admin" action listing current players to choose from; non-admin players don't see this control.
- [ ] After transfer, admin-only actions (deposit, close game, etc.) are only available to the new admin — verified on-chain, not only hidden in the UI.
