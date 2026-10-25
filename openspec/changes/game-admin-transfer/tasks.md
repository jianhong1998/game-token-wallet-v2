# Tasks

## 1. On-chain instruction

- [ ] 1.1 Append `CannotTransferAdminToSelf` ("Cannot transfer the admin role to yourself") to the end of `ErrorCode` in `apps/on-chain-program/programs/game_token_wallet/src/errors.rs` and verify `cargo test --manifest-path apps/on-chain-program/Cargo.toml` still compiles the error enum (code `6015` / `0x177F`, existing codes unchanged)
- [ ] 1.2 Add `instructions/game/transfer_game_admin.rs` with `ensure_caller_is_admin` and `ensure_not_self_admin`, write their failing `#[cfg(test)]` tests first (admin allowed, non-admin rejected, distinct keys allowed, equal keys rejected), then implement the helpers and verify `cargo test --manifest-path apps/on-chain-program/Cargo.toml transfer_game_admin` passes
- [ ] 1.3 Implement `TransferGameAdmin` (`admin`, `user`, `player_user`, `game` mut, `player_ata` unchecked and not mut) and the handler in the order design.md D3 specifies, register it in `instructions/game/mod.rs` and `lib.rs`, and verify `cargo test --manifest-path apps/on-chain-program/Cargo.toml` passes with no `Game` layout change

## 2. On-chain integration tests

- [ ] 2.1 Add `apps/on-chain-program-e2e/tests/game/transfer_game_admin.test.ts` using one shared system signer per test (the `mint_to_player.test.ts` rule) and verify the happy path: `Game.admin` becomes the target `User` PDA, both balances and `player_count` stay put, and a zero-balance target is accepted
- [ ] 2.2 In that file, verify rejection cases: non-admin caller → `NotGameAdmin` (target is the other player), non-member → `PlayerNotInGame`, wrong ATA address → `InvalidPlayerAta`, current admin naming themselves → `CannotTransferAdminToSelf` with no state change, missing game account writes nothing
- [ ] 2.3 In that file, verify the post-transfer split: the former admin's `quit_game` succeeds and the new admin's `quit_game` returns `AdminCannotQuitGame`; the former admin's `mint_to_player` returns `NotGameAdmin` and the new admin's succeeds; the former admin's `close_game` returns `NotGameAdmin`

## 3. On-chain client

- [ ] 3.1 Rebuild the program IDL and run `pnpm --filter on-chain-client run codegen`, then extend `apps/on-chain-client/src/index.test.ts` to assert `getTransferGameAdminInstructionAsync` and `GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF` and verify `pnpm --filter on-chain-client run test` and `pnpm --filter on-chain-client run typecheck` pass without unrelated export changes

## 4. Server Action

- [ ] 4.1 Add `transferGameAdmin` to `apps/frontend/src/server/actions/game.ts` per design.md D4, including the session-username caller, the self-transfer and empty-target pre-checks, the game-not-found pre-check, and the error mapping
- [ ] 4.2 Extend `game.test.ts`'s `on-chain-client` mock with the new builder and `0x177f`, and verify tests for: success, not signed in, empty target, self-target, game not found, `NotGameAdmin`, `PlayerNotInGame`, and `CannotTransferAdminToSelf` mapping. Run `pnpm --filter frontend exec vitest run src/server/actions/game.test.ts`

## 5. Frontend UI

- [ ] 5.1 Add the "Transfer admin role" form to `AdminControlsModal.tsx`: choices are `players` where `isAdmin` is false, empty submit shows "Select a player" in `data-testid="transfer-admin-error"` and does not call the action, success closes the modal and calls `router.refresh()`, failure keeps the modal open. No second confirmation dialog
- [ ] 5.2 Extend `AdminControlsModal.test.tsx` for the picker exclusion, the only-player empty list, the empty submit, success refresh, and the rejected-transfer error, and verify `pnpm --filter frontend exec vitest run src/app/\(app\)/games/\[address\]/AdminControlsModal.test.tsx` passes

## 6. End-to-end

- [ ] 6.1 Add `apps/e2e/tests/general-mode/transfer-admin.spec.ts` (two contexts, unique usernames) and verify against the running stack: transfer leaves both balances unchanged, the admin label and admin-only controls move to the new admin, the former admin sees Quit game and the new admin does not, the new admin can deposit, and the former admin can quit

## 7. Integration gate

- [ ] 7.1 Run `just lint` and `just test` and confirm the full suite passes, including the cargo, on-chain e2e, frontend, and Playwright cases from the groups above. No CircleCI config change

## Workflow follow-up

- After implementation lands and review is satisfied, check off this file, run `openspec-archive-change` for `game-admin-transfer`, and set ticket 010 to Done in `docs/tickets/010-game-admin-transfer.md` and `docs/tickets/000-index.md`.
