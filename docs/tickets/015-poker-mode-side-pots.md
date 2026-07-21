# 015 — Poker Mode: side pots

**What to build:** Full Holdem side-pot support, extending 014's single-pot flow to correctly handle players going all-in for different amounts. The exact mechanical rule is specified in [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q6/Q7 — implement it as written there.

**Blocked by:** 014, 013

**Status:** ready-for-agent

- [ ] `showhand` additionally: after capping the player, counts remaining non-capped players in the round; if ≥2 remain, freezes the currently active pot (no further contributions ever accepted into it) and opens a new pot as the active one. If ≤1 remain, no new pot opens.
- [ ] Pots are stored as an ordered, bounded list on the game's round state, capped at an explicit `MAX_POTS_PER_ROUND` constant (documented, upper-bounded by 19 for a 20-player game).
- [ ] `end_round` accepts winners **per pot**, validates each named winner is a contributor of that specific pot, and splits each pot independently (remainder to that pot's first-listed winner).
- [ ] A round with three players going all-in for three different amounts produces the correct main pot plus two side pots, each paid to the correct eligible winners — covered by a test.
- [ ] `close_game` (013) is extended to also burn/close any outstanding pot balances when a game is closed mid-round, so no value is left orphaned.
- [ ] Frontend: players can see multiple concurrent pots and which one(s) they're eligible for; admin declares winners pot by pot.
