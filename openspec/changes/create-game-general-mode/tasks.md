## 1. On-chain: `Game` account

- [ ] 1.1 Add `state/game.rs`: `MIN_GAME_NAME_BYTES`, `MAX_GAME_NAME_BYTES`, `GAME_ID_BYTES` constants, `GameMode` enum (`General`/`Poker`/`Pool`), `Game` struct (`bump`, `mint_bump`, `game_id`, `name`, `mode`, `admin`, `mint`)
- [ ] 1.2 Wire `game` module into `state/mod.rs`
- [ ] 1.3 Add and pass the `Game::INIT_SPACE` sizing unit test (`cargo test`)

## 2. On-chain: `create_game` instruction

- [ ] 2.1 Add `anchor-spl = "1"` dependency to `Cargo.toml`
- [ ] 2.2 Add `InvalidGameNameLength`, `InvalidGameNameCharacters`, `RegistryFull` to `errors.rs`
- [ ] 2.3 Write `ensure_registry_has_capacity(active_games_len: usize) -> Result<()>` as a standalone, unit-testable function; cover both sides of the `MAX_ACTIVE_GAMES` boundary with `cargo test`
- [ ] 2.4 Write the `CreateGame` accounts struct: `admin` (signer/payer), `creator_user` (read-only `Account<User>`, seeds derive from `username` + `admin`), `registry` (mut, existing), `game` (init), `mint` (init, 2 decimals, `Game` PDA as authority, no freeze authority), `token_program`, `system_program`
- [ ] 2.5 Write the handler: validate name length, validate name charset (Unicode letter/number/space via Rust's built-in `char` methods), call `ensure_registry_has_capacity`, set all `Game` fields (`admin = creator_user.key()`, `mode = GameMode::General`), push the game's address into `registry.active_games`
- [ ] 2.6 Wire `create_game` into `lib.rs`
- [ ] 2.7 `anchor build` succeeds and regenerates the IDL; `cargo test` (full suite) passes

## 3. Client generation

- [ ] 3.1 Run `pnpm codegen` to regenerate `on-chain-client` from the updated IDL
- [ ] 3.2 Confirm the generated `GameMode` shape (scalar TS enum vs. discriminated union) — determines how tests assert on `game.data.mode`
- [ ] 3.3 Extend `on-chain-client`'s own regression test with the new `create_game`-related exports; `on-chain-client` tests pass

## 4. On-chain e2e tests

- [ ] 4.1 Add `@solana-program/token` devDependency to `on-chain-program-e2e` (test-only, for reading raw SPL `Mint` account data)
- [ ] 4.2 Write `tests/game/create_game.test.ts`: happy path (Game fields, mint decimals/authority, registry entry present); name below 3 bytes rejected (`InvalidGameNameLength`); name over 32 bytes rejected (`InvalidGameNameLength`); name with a disallowed character rejected (`InvalidGameNameCharacters`)
- [ ] 4.3 Do **not** add an e2e test that fills the registry to `MAX_ACTIVE_GAMES` — the boundary is already covered by the Task 2.3 unit test, and 128 real transactions against the shared e2e validator would poison state for every other test file in the same run
- [ ] 4.4 `anchor test` passes (new and existing tests)

## 5. Frontend: shared utilities

- [ ] 5.1 `lib/game-name.ts`: `normalizeGameName` (NFC only, no case-fold), `validateGameName` (3–32 bytes, Unicode letter/number/space) — with unit tests mirroring `lib/username.test.ts`'s cases
- [ ] 5.2 `server/game-id.ts`: hand-rolled `generateGameId(): Uint8Array` (RFC 9562 UUID v7 — 48-bit timestamp + random bits, via Web Crypto `getRandomValues`) — with unit tests for byte length, version/variant bits, timestamp accuracy, and uniqueness

## 6. Frontend: server actions

- [ ] 6.1 `server/actions/game.ts`: `createGame({ name })` (session check → validate → generate id → build/send `create_game` transaction) and `listMyGames()` (fetch registry → fetch each game → filter to the current session's `User` PDA) — with unit tests mocking `on-chain-client`/`@solana/kit`/`../connection`/`./auth`, matching the existing `actions/auth.test.ts`/`actions/registry.test.ts` mocking pattern

## 7. Frontend: pages

- [ ] 7.1 `app/(app)/games/new/page.tsx`: name-only creation form (no mode selector), live client-side validation hint, redirects to `/games` on success — with page tests mirroring `(auth)/register/page.test.tsx`
- [ ] 7.2 `app/(app)/games/page.tsx`: "My Games" list (empty state + list with an admin badge per game), links to `/games/new` — with page tests mirroring `(app)/home/page.test.tsx`

## 8. End-to-end and manual verification

- [ ] 8.1 `apps/e2e/tests/game-creation.spec.ts`: register → create a game → see it in `/games` with an admin badge; invalid name blocks submission with a live hint
- [ ] 8.2 `just lint && just typecheck` pass with no changes needed
- [ ] 8.3 `just test` passes in full (cargo test, frontend vitest, on-chain-client vitest, on-chain-program-e2e, e2e Playwright)
- [ ] 8.4 Manual verification against the local docker-compose/Surfpool stack: register/log in → `/games` empty state → create a valid game → redirected to `/games` with the new game listed → invalid name blocked on `/games/new` → refresh `/games` confirms the game persists (proves on-chain state, not local-only UI state)
