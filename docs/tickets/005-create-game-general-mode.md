# 005 — Create game (General Mode, public)

**What to build:** A logged-in user can create a game (defaulting to General Mode, public visibility) and automatically becomes its admin.

**Blocked by:** 002, 003

**Status:** Done

- [x] `create_game` instruction: takes a client-generated UUID v7 game ID, creates the `Game` PDA and its own SPL mint (2 decimals, per [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q9), sets the creator as game admin, and adds the game to the `Registry`.
- [x] Registry insertion fails with a clear error if `MAX_ACTIVE_GAMES` is reached — does not silently drop the game or corrupt registry state.
- [x] Creation form: logged-in user enters a game name and mode (General Mode is the only functional option this ticket — Poker/Pool can be selectable-but-inert or hidden until 014/016 land).
- [x] Creator sees themselves listed as game admin immediately after creation, and the game appears in their own game list.

**Verification note:** All 4 ACs confirmed via code review + cargo unit tests (6/6) + frontend/on-chain-client vitest (134/134, 4/4) + on-chain e2e against a real local validator. First on-chain e2e run showed `tests/registry/initialize.test.ts` failing (registry had 1 game instead of 0 right after init); rerun passed clean (9/9, incl. that file). Root cause: `create_game.test.ts` and `registry/initialize.test.ts` both mutate the shared singleton Registry PDA and vitest runs test files in parallel — a timing race, not a `create_game` correctness bug. `create_game.test.ts`'s own 4 tests passed deterministically on both runs. CI was green on all 6 checks at merge time. Pre-existing test-isolation gap in `on-chain-program-e2e`, not scoped to this ticket — worth a follow-up (serialize registry-touching test files, or give each file its own Registry PDA fixture) but not a blocker for closing 005.
