## 1. On-chain program: errors and state

- [ ] 1.1 Add `GameNotEmpty` and `GameNotInRegistry` error variants to `errors.rs`
- [ ] 1.2 Confirm no `Game`/`Registry`/`Mint` account layout changes are needed (both are read/mutated with existing shapes)

## 2. On-chain program: `close_game_player` instruction

- [ ] 2.1 Implement `CloseGamePlayer` accounts struct (`admin`, `user`, `player_user`, `game`, `mint`, `player_ata`, `token_program`) per design.md D2
- [ ] 2.2 Implement handler: verify caller is game admin (`NotGameAdmin`), validate `player_ata` derivation (`InvalidPlayerAta`/`PlayerNotInGame`), burn actual balance, close ATA (rent to admin), decrement `player_count`
- [ ] 2.3 Register `close_game_player` in `lib.rs`
- [ ] 2.4 Unit tests (inline `#[cfg(test)] mod tests`): admin-only check, targeting own vs. other player's ATA, non-member rejection

## 3. On-chain program: `close_game` instruction

- [ ] 3.1 Implement `CloseGame` accounts struct (`admin`, `user`, `game` with `close = admin`, `registry`) per design.md D3 — no `mint`/`token_program` needed; the mint is not touched (legacy SPL Token program can't close a `Mint` account)
- [ ] 3.2 Implement handler: verify caller is game admin, require `player_count == 0` (`GameNotEmpty`) before any mutation, swap-remove registry entry (`GameNotInRegistry` defensive error), rely on Anchor's `close` constraint for the `Game` account
- [ ] 3.3 Register `close_game` in `lib.rs`
- [ ] 3.4 Unit tests: empty-game success path (pure swap-remove index-finding logic), non-empty rejection, non-admin rejection

## 4. On-chain integration tests

- [ ] 4.1 Add `apps/on-chain-program-e2e/tests/game/close-game.ts` (or equivalent) covering: full close of a multi-player game, closing admin's own slot via `close_game_player`, `close_game` rejecting a non-empty game, registry no longer listing the game after close, `Game` account no longer existing after close, mint account still existing (unclosed) after close

## 5. Frontend: Server Action

- [ ] 5.1 Regenerate the on-chain client (Codama) to pick up the two new instructions and error variants; verify no unrelated bindings break (typecheck + existing test suite)
- [ ] 5.2 Add a shared player-discovery helper (extract from or reuse `fetchGameDetail`'s `getProgramAccounts` scan) in `apps/frontend/src/server/actions/game.ts`
- [ ] 5.3 Implement `closeGame(gameAddress)`: discover players, build+chunk `close_game_player` instructions via `chunkInstructionsBySize`, send sequentially stop-on-first-failure, then send final `close_game`; return `CloseGameResult` (`{ ok: true } | { ok: false; error; playersClosed; playersTotal }`)
- [ ] 5.4 Handle "game not found" gracefully on retry-after-success (mirror `fetchMaybeGame` convention used elsewhere)
- [ ] 5.5 Unit tests: full success, partial failure reporting, idempotent retry after partial failure, retry-after-success handling, `GameNotEmpty`/admin-only error mapping to friendly messages

## 6. Frontend: UI

- [ ] 6.1 Add `CloseGameButton.tsx` (admin-only, styled confirmation modal mirroring `QuitGameButton.tsx`'s chrome) on the game detail page
- [ ] 6.2 Wire partial-failure progress display (`playersClosed`/`playersTotal`) and redirect-to-`/` on full success
- [ ] 6.3 Component tests for the confirmation modal (visible only to admin, cancel/confirm behavior, error/progress rendering)

## 7. Verification

- [ ] 7.1 Confirm `listBrowseGames`/`listMyMemberGames` no longer show a closed game (add/verify a test if not already covered by 4.1/5.5)
- [ ] 7.2 Run full `Done Means` gate: format/lint, `cargo test`, frontend unit tests, `on-chain-program-e2e`, manual/e2e verification of the close flow against a running local stack
- [ ] 7.3 Update ticket 013 and `docs/tickets/000-index.md` status once implementation lands
