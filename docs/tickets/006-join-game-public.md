# 006 — Join game (public)

**What to build:** Any logged-in user can browse active public games and join one as a player.

**Blocked by:** 005

**Status:** ready-for-agent

- [ ] `join_game` instruction creates the joining player's ATA for the game's SPL mint and adds them to the game's player list, capped at 20 players per game (per PRD).
- [ ] Rejects joining if the game is already at the player cap, or if the user is already a player in that game.
- [ ] Registry-backed "browse games" page lists active public games, each showing current player count.
- [ ] Joining updates the player list visible to all current players (React Query refetch/invalidation is sufficient — no websocket requirement).
