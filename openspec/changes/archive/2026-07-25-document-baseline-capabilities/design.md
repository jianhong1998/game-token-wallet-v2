## Context

OpenSpec has no existing baseline specs. `user` and `registry` are already implemented and shipped (tickets 002, 003); this change is documentation-only, reverse-derived from the actual source (see proposal's Impact section for exact files read).

## Goals / Non-Goals

**Goals:**
- Baseline specs match observed code behavior exactly, not the broader decided-but-unbuilt architecture.

**Non-Goals:**
- No code changes.
- No specs for game creation, general/poker/pool modes, deposit/mint, admin transfer, quit/close/delete (tickets 005-016) — those aren't built yet and get their own change when implemented.

## Decisions

- Wrote requirements/scenarios directly from the frontend server actions and Anchor instruction handlers rather than from the architecture-decisions docs, since the docs describe intent and the code is what's actually running.
- Registry's active-game population is called out explicitly as unimplemented rather than silently omitted, so a future reader doesn't assume it works.

## Risks / Trade-offs

- None — retroactive documentation of already-shipped, already-tested behavior.
