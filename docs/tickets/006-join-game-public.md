# 006 — Join game (public)

**What to build:** Any logged-in user can browse active public games and join one as a player.

**Blocked by:** 005

**Status:** Done

- [x] `join_game` instruction creates the joining player's ATA for the game's SPL mint and adds them to the game's player list, capped at 20 players per game (per PRD).
- [x] Rejects joining if the game is already at the player cap, or if the user is already a player in that game.
- [x] Registry-backed "browse games" page lists active public games, each showing current player count.
- [x] Joining updates the player list visible to all current players (React Query refetch/invalidation is sufficient — no websocket requirement).

**Verification note:** All 4 ACs confirmed via code review (zero actionable issues) + on-chain + frontend automation + manual runtime checks. On-chain: new `join_game` instruction (manual ATA creation via CPI, `player_count` capped at 20 via `ensure_game_has_capacity`, `AlreadyJoinedGame`/`GameFull`/`InvalidPlayerAta` rejections) — covered by Rust unit tests (`state/game.rs` INIT_SPACE, `join_game.rs` capacity boundary) and 3 `on-chain-program-e2e` tests (happy path, duplicate-join rejection, 21st-join cap rejection). Frontend: `/games/all` browse page (context-sensitive Join/Open buttons, live `{playerCount}/20`) and `/games/[address]` detail page (roster + balances + admin badge) via new `listBrowseGames`/`fetchGameDetail`/`joinGame` server actions — covered by unit tests (mocking `on-chain-client`/`@solana/kit`/connection/auth) and a 2-browser-context Playwright e2e spec (`apps/e2e/tests/game-joining.spec.ts`) exercising register→create→browse→join→roster→re-browse-shows-Open. Full `just lint`/`just typecheck`/`just test` all green across multiple verification rounds, including a fix for a pre-existing registry-init race between sibling `on-chain-program-e2e` test files (made global-setup registry init idempotent). Manually verified against a freshly reset local stack (`just down-clean && just up-build`): register/create/join/roster/balance/re-browse-shows-Open/host-also-joins-own-game/duplicate-join-rejected, all confirmed against real on-chain state alongside UI text.
