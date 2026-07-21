# 012 — Delete user account

**What to build:** A user can permanently delete their account, but only once they're not an active player in any game.

**Blocked by:** 003, 011

**Status:** ready-for-agent

- [ ] `delete_user` instruction accepts a client-supplied list of the user's currently-open game ATAs (queried off-chain via `getTokenAccountsByOwner`, since a program cannot enumerate this itself — per [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q15–17), verifies each has a zero balance, and rejects the deletion if the caller is still recorded as an active player in any game found.
- [ ] Client queries the user's token accounts before calling the instruction and surfaces a clear "quit these games first" message if any open game membership is found, rather than letting the on-chain call fail opaquely.
- [ ] On success, the `User` PDA and any remaining associated accounts are closed, rent reclaimed.
- [ ] A deleted username becomes available for re-registration.
