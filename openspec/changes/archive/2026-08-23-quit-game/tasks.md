## 1. On-chain program

- [ ] 1.1 Add `AdminCannotQuitGame` error variant to `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`
- [ ] 1.2 Implement `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/quit_game.rs`: `QuitGame` accounts struct (admin signer, player's `user` PDA, `game` mut, `mint`, `player_ata` mut, token program), handler validating the ATA address, rejecting if caller is `game.admin`, burning the ATA's full current balance, closing the ATA with rent to `admin`, and decrementing `game.player_count`
- [ ] 1.3 Register `quit_game` in `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs` and `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`
- [ ] 1.4 Add inline unit tests in `quit_game.rs` covering: admin-equality rejection helper, and any other pure-logic helper extracted from the handler (mirroring `ensure_game_has_capacity`/`ensure_positive_amount` style in sibling files)
- [ ] 1.5 Run `cargo test --manifest-path apps/on-chain-program/Cargo.toml` and confirm all tests pass

## 2. On-chain client regeneration

- [ ] 2.1 Rebuild the Anchor IDL and regenerate the Codama TypeScript client in `apps/on-chain-client` so `getQuitGameInstructionAsync` and `GAME_TOKEN_WALLET_ERROR__ADMIN_CANNOT_QUIT_GAME` are exported
- [ ] 2.2 Confirm the regenerated client typechecks and doesn't alter unrelated existing exports

## 3. Frontend Server Action

- [ ] 3.1 Add `quitGame(gameAddress: string)` to `apps/frontend/src/server/actions/game.ts`: resolve current username, `fetchMaybeGame` pre-check, derive player `User` PDA + ATA, build and send the `quit_game` instruction, catch and map `GAME_TOKEN_WALLET_ERROR__ADMIN_CANNOT_QUIT_GAME` and `GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME` to friendly messages (same `isGameTokenWalletError` convention as `joinGame`), return `{ ok: true } | { ok: false; error: string }`
- [ ] 3.2 Write unit tests for `quitGame` covering: successful quit, not-signed-in, game-not-found, admin-rejection mapping, not-a-player mapping

## 4. Frontend UI

- [ ] 4.1 Build the quit-confirmation modal component (styled, matching `AdminControlsModal.tsx`'s chrome — no `window.confirm`/`alert`), with title "Quit this game?" and body "Your balance in this game will be burned immediately and can't be recovered.", Cancel/Quit buttons
- [ ] 4.2 Add the "Quit game" entry-point button to `apps/frontend/src/app/(app)/games/[address]/page.tsx`, rendered only when `!game.isAdmin`
- [ ] 4.3 Wire the modal's confirm action to call `quitGame` and redirect to `/` on success; surface `result.error` on failure without redirecting
- [ ] 4.4 Write component tests covering: button hidden for admin, button visible and opens modal for non-admin, cancel closes without submitting, confirm submits and redirects on success, confirm shows error and stays open on failure

## 5. Verification

- [ ] 5.1 Run `just lint` (and `rtk proxy pnpm lint` if the rtk rewrite misfires, per CLAUDE.local.md) with no changes needed
- [ ] 5.2 Run `just test` — full suite green
- [ ] 5.3 Boot the stack (`just up`) and manually exercise: a non-admin player quitting a game with a positive balance (balance burned, ATA gone, player vanishes from player list and admin pickers), quitting with a zero balance, an admin attempting to quit (button absent), a quit player rejoining the same game
