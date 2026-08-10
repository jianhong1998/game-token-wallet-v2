## 1. On-chain program

- [x] 1.1 Add `NotGameAdmin` and `PlayerNotInGame` to `errors.rs`
- [x] 1.2 Implement `mint_to_player` instruction (`instructions/game/mint_to_player.rs`): `Accounts` struct (`admin`, `user`, `player_user`, `game`, `mint`, `player_ata`, `token_program`), handler asserting `user.key() == game.admin` (else `NotGameAdmin`), validating `player_ata` is the deterministic ATA for `(player_user, mint)` and already initialized (else `PlayerNotInGame`), rejecting `amount == 0`, then CPI `mint_to`
- [x] 1.3 Inline unit tests for the pure/handler-adjacent logic (mirroring `join_game.rs`'s pattern)
- [x] 1.4 Wire up instruction export in `instructions/game/mod.rs` and `lib.rs`
- [x] 1.5 Regenerate `apps/on-chain-client` (IDL + Codama client)
- [x] 1.6 `on-chain-program-e2e` tests: successful deposit, non-admin caller rejected, deposit to non-member rejected, zero-amount rejected

## 2. Frontend Server Action

- [x] 2.1 Add `depositToPlayer` action in `apps/frontend/src/server/actions/game.ts`: resolve admin's/target's `User` PDAs and ATA, client-side amount > 0 check, build/sign/send transaction, map `NotGameAdmin`/`PlayerNotInGame` to friendly errors (mirroring `joinGame`'s error-mapping pattern)
- [x] 2.2 Unit tests for `depositToPlayer` (happy path, non-admin rejection surfaced, non-member rejection surfaced, invalid amount short-circuits before any tx)

## 3. Frontend UI

- [x] 3.1 Add "Admin controls" button (admin-only) to `/games/[address]/page.tsx`
- [x] 3.2 Build the admin-controls modal client component with the "Deposit for offline cash-in" sub-form (player select from current roster, amount input, submit), per `docs/technical-related/ui-design/004-ui-sample/Kitty - Glass Vault.dc.html`
- [x] 3.3 On successful deposit: close/reset the form and call `router.refresh()`
- [x] 3.4 Component unit tests (modal open/close, form validation, submit calls the action, refresh triggered on success)

## 4. End-to-end verification

- [x] 4.1 Playwright spec: admin deposits to a player, player's balance reflects it on next view; non-admin has no access to the deposit form
- [x] 4.2 Manual verification against a freshly reset local stack (`just down-clean && just up-build`): register two users, create game, join as second user, admin deposits, confirm balance on both admin and player views
