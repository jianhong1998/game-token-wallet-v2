# 014 — Poker Mode: single pot

**What to build:** The core loop of a poker hand with a single pot (no side pots yet) — players contribute or go all-in, admin declares winner(s) at showdown. Betting rounds, turn order, and fold are explicitly out of scope (per [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q5) — cards and betting decisions happen at the physical table.

**Blocked by:** 006, 008

**Status:** ready-for-agent

- [ ] Game creation supports selecting Poker Mode; `Game` account gains embedded round/pot state (contributor list + total for the active pot).
- [ ] A contribute instruction lets a player voluntarily move an amount from their balance into the game's currently active pot, recording them as a contributor.
- [ ] `showhand` sweeps a player's entire remaining balance into the active pot and marks them capped for the round.
- [ ] `end_round`, admin-only: accepts a winner list drawn only from the pot's recorded contributors (program-enforced membership check — rejects a non-contributor), splits the pot evenly among the named winners with any remainder going to the first-listed winner, then resets the round's embedded state in place (no new account) for the next hand.
- [ ] Frontend: players see the live pot total and their own contribution/capped status; admin has a "declare winners" action restricted to that pot's contributors.
- [ ] Out of scope for this ticket: a hand where two or more players go all-in for different amounts and require separate side pots (covered by 015).
