# 016 — General Pool Mode

**What to build:** The third game mode — a single continuous pool with fully admin-discretionary payouts and no contributor-eligibility restriction (per [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q10, deliberately simpler than Poker Mode).

**Blocked by:** 008, 013

**Status:** ready-for-agent

- [ ] Game creation supports selecting Pool Mode.
- [ ] Players can contribute to the game's pool at any time, no round/hand boundary.
- [ ] `pool_payout` instruction, admin-only: pays an admin-specified amount to any player currently in the game, up to the pool's balance, with no eligibility check — callable repeatedly at any time.
- [ ] Admin-facing view shows the live pool balance (per PRD's "realtime check" requirement) and a payout form (select player, enter amount).
- [ ] `close_game` (013) is extended to also burn/close the pool's outstanding balance when the game is closed.
