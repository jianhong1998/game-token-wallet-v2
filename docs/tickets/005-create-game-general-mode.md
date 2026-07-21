# 005 — Create game (General Mode, public)

**What to build:** A logged-in user can create a game (defaulting to General Mode, public visibility) and automatically becomes its admin.

**Blocked by:** 002, 003

**Status:** ready-for-agent

- [ ] `create_game` instruction: takes a client-generated UUID v7 game ID, creates the `Game` PDA and its own SPL mint (2 decimals, per [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q9), sets the creator as game admin, and adds the game to the `Registry`.
- [ ] Registry insertion fails with a clear error if `MAX_ACTIVE_GAMES` is reached — does not silently drop the game or corrupt registry state.
- [ ] Creation form: logged-in user enters a game name and mode (General Mode is the only functional option this ticket — Poker/Pool can be selectable-but-inert or hidden until 014/016 land).
- [ ] Creator sees themselves listed as game admin immediately after creation, and the game appears in their own game list.
