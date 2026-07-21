# 007 — Private games (password-protected)

**What to build:** A game admin can make a game private, gating joining behind a password while keeping the game visible in the browse list.

**Blocked by:** 005, 006

**Status:** ready-for-agent

- [ ] `Game` account stores an optional password hash; public games have none.
- [ ] Only the game admin can set/change the game's password — enforced on-chain via signer check, not just hidden in the UI.
- [ ] Private games still appear in the "browse games" list (per PRD) but are visually marked as private.
- [ ] Joining a private game requires the correct password (verified off-chain against the stored hash, same pattern as user login) before the join instruction is submitted; a wrong password shows a clear error without revealing whether the game exists.
- [ ] Changing a private game's password does not remove or affect already-joined players.
