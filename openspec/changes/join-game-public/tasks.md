## 1. On-chain: `Game` account changes

- [x] 1.1 Add `MAX_PLAYERS_PER_GAME: usize = 20` constant and `player_count: u8` field to `state/game.rs`
- [x] 1.2 Update the `Game::INIT_SPACE` sizing unit test for the new field
- [x] 1.3 `create_game.rs` handler: set `game.player_count = 0` (only change to this file)

## 2. On-chain: `join_game` instruction

- [x] 2.1 Add `GameFull` and `AlreadyJoinedGame` to `errors.rs`
- [x] 2.2 Write `ensure_game_has_capacity(player_count: u8) -> Result<()>` as a standalone, unit-testable function; cover both sides of the `MAX_PLAYERS_PER_GAME` boundary with `cargo test`
- [x] 2.3 Write the `JoinGame` accounts struct: `admin` (signer/payer), `user` (read-only `Account<User>`, seeds derive from `username` + `admin` — named `user` not `player_user`, matching 005's Codama-canonicalization precedent), `game` (mut, seeds `[b"game", game_id]`, bump = `game.bump`), `mint` (seeds `[b"mint", game.key()]`, bump = `game.mint_bump`), `player_ata` (unchecked, mut — no declarative `init`), `token_program`, `associated_token_program`, `system_program`
- [x] 2.4 Write the handler: validate `player_ata`'s address against the deterministic ATA derivation for `(user, mint)`, call `ensure_game_has_capacity`, `require!` `player_ata.data_is_empty()` else `AlreadyJoinedGame`, manually CPI the Associated Token Program's `create` instruction, increment `game.player_count`
- [x] 2.5 Wire `join_game` into `lib.rs` and `instructions/game/mod.rs`
- [x] 2.6 `anchor build` succeeds and regenerates the IDL; `cargo test` (full suite) passes

## 3. Client generation

- [x] 3.1 Confirm/add whatever ATA-address-derivation and create-instruction helper package is needed client-side (likely `@solana-program/token` or equivalent) — flag before installing per repo policy
- [x] 3.2 Run `pnpm codegen` to regenerate `on-chain-client` from the updated IDL
- [x] 3.3 Extend `on-chain-client`'s own regression test with the new `join_game`-related exports; `on-chain-client` tests pass

## 4. On-chain e2e tests

- [x] 4.1 Write `tests/game/join_game.test.ts`: happy path (ATA created, zero balance, `player_count` incremented); duplicate join rejected with `AlreadyJoinedGame`, state unchanged; cap-reached case (fill a game to 20 players via 20 `create_user` + `join_game` pairs, assert the 21st fails with `GameFull` and `player_count` stays at 20)
- [x] 4.2 `anchor test` passes (new and existing tests)

## 5. Frontend: server actions

- [x] 5.1 `server/actions/game.ts`: `joinGame(gameAddress)` — session check, derive accounts, build/send `join_game`, map on-chain errors (`AlreadyJoinedGame`/`GameFull`) to friendly messages — with unit tests mocking `on-chain-client`/`@solana/kit`/`../connection`/`./auth`
- [x] 5.2 `server/actions/game.ts`: `listBrowseGames()` — fetch registry, fetch every active game, batch-check the viewer's membership per game via one `getMultipleAccounts` call across derived ATA addresses — with unit tests covering membership flags and an empty registry
- [x] 5.3 `server/actions/game.ts`: `fetchGameDetail(gameAddress)` — fetch the game, run the mint-filtered `getProgramAccounts` roster query, batch-resolve owners to usernames via `User` PDA fetches, derive the viewer's own balance from the same roster fetch — with unit tests covering roster/balance shape, a non-existent game, and a non-member viewer

## 6. Frontend: pages

- [x] 6.1 `app/(app)/games/all/page.tsx`: browse list via `listBrowseGames()`, each row showing name/mode/`{playerCount}/20` and a context-sensitive Join/Open button — with page tests
- [x] 6.2 `app/(app)/games/[address]/page.tsx`: detail page via `fetchGameDetail()` — header (name/mode, admin badge), your-balance card, players list — with page tests; not-found/redirect handling for a bad address or logged-out viewer

## 7. End-to-end and manual verification

- [x] 7.1 `apps/e2e` Playwright spec: register/login as a second user → Browse → see the first user's public game with a "Join" button and correct player count → Join → redirected to the game detail page → sees self in the roster with a zero balance → Browse again now shows "Open" for that game
- [x] 7.2 `just lint && just typecheck` pass with no changes needed
- [x] 7.3 `just test` passes in full (cargo test, frontend vitest, on-chain-client vitest, on-chain-program-e2e, e2e Playwright)
- [x] 7.4 Manual verification against a freshly reset local docker-compose/Surfpool stack (per the `Game` layout change) before marking done, per this repo's Done-Means rule
