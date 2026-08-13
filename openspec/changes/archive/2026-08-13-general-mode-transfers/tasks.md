## 1. On-chain instruction

- [x] 1.1 Add `errors.rs` variants: `SelfTransfer`, `InvalidTransferAmount`
- [x] 1.2 Create `instructions/general_mode/` module and `transfer_token.rs`: accounts struct (`admin`, `sender`, `recipient`, `game`, `mint`, `sender_ata`, `recipient_ata`, `token_program`), self-transfer guard, positive-amount guard, ATA derivation/membership checks, CPI `token::transfer` signed by the sender's `User` PDA
- [x] 1.3 Wire `transfer_token` into `lib.rs`'s `#[program]` module
- [x] 1.4 Inline `#[cfg(test)]` unit tests for the pure guard functions (mirrors `mint_to_player.rs`'s `ensure_positive_amount` test pattern)

## 2. On-chain integration tests

- [x] 2.1 `apps/on-chain-program-e2e/tests/general_mode/`: happy path (two members, positive amount, balances update correctly)
- [x] 2.2 Self-transfer rejected with `SelfTransfer`
- [x] 2.3 Non-member recipient rejected with `PlayerNotInGame`
- [x] 2.4 Non-positive amount rejected with `InvalidTransferAmount`
- [x] 2.5 Insufficient sender balance rejected by the SPL CPI's native error

## 3. Server Action

- [x] 3.1 `transferTokens` in `apps/frontend/src/server/actions/game.ts`: input validation (non-empty, no duplicates, no self-transfer, positive/overflow-guarded amounts per recipient — reuse `depositToPlayer`'s base-unit conversion guards)
- [x] 3.2 Pre-flight balance check (sum of amounts vs. sender's current ATA balance)
- [x] 3.3 Instruction composition + size-aware chunking (pack by actual serialized message size, not a hardcoded recipient count; safety margin below the 1232-byte ceiling)
- [x] 3.4 Sequential chunk send with stop-on-first-failure; return `{ ok, error?, transfersApplied, transfersTotal }`
- [x] 3.5 Map on-chain errors (`SelfTransfer`, `InvalidTransferAmount`, `PlayerNotInGame`, insufficient-funds) to friendly messages, same style as `depositToPlayer`'s catch block
- [x] 3.6 Unit tests: validation rejections, chunk-boundary packing at the ~19-recipient/max-username worst case, stop-on-first-failure reporting

## 4. Frontend

- [x] 4.1 Inline "Send tokens" section on the game detail page (General Mode only, visible to all members) — repeatable recipient rows (picker + amount + remove), "+ Add recipient", running-total submit button, matching `docs/technical-related/ui-design/004-ui-sample/Kitty - Glass Vault.dc.html`'s `isGame`/`gameIsGeneral` reference
- [x] 4.2 Row picker excludes both the current user and usernames already chosen in other rows
- [x] 4.3 Error slot: short validation messages pre-submit, count-naming partial-failure message post-submit; success path uses existing toast + `router.refresh()` convention
- [x] 4.4 Component unit tests (row add/remove, duplicate-exclusion, submit wiring)

## 5. End-to-end

- [x] 5.1 Playwright spec `apps/e2e/tests/general-mode/transfer.spec.ts`: two-browser-context multi-recipient transfer, balances confirmed on both sides
- [x] 5.2 Manually verify against a freshly rebuilt local stack (`just down-clean && just up-build`) per CLAUDE.md's "Done Means" — exercise the worst-case ~19-recipient batch if feasible, or document why it wasn't

  Verified 2026-08-13 against a from-scratch `docker-compose.e2e.yml` stack (`down --volumes` then rebuilt `surfpool`/`program-deploy`/`frontend`/`e2e` images). Ran a one-off Playwright spec (not committed — the 19-recipient/20-account setup is too slow for permanent CI, already covered at the unit level by `transfer-chunking.test.ts`): 20 real registered accounts joined one max-size game, sender batch-transferred to the other 19 in a single submit, chunked into multiple on-chain transactions, all 19 balances (`0.01` each) and the sender's remainder (`4.81`) confirmed correct via UI assertions. Also surfaced and fixed a false start: a fully fresh stack needs the registry PDA bootstrapped via `/admin/registry` → "Initialize registry" before any game can be created — this is an existing one-time setup step (`admin-registry.spec.ts`), unrelated to this ticket, not a regression introduced here.

## 6. Housekeeping

- [x] 6.1 Correct `docs/tickets/000-index.md`'s ticket 009 row back to "Pending" (mistakenly flipped to "Done" in commit `0e9f2ee`) until this change actually ships
- [x] 6.2 On completion: check off `openspec/changes/general-mode-transfers/tasks.md`, run `openspec-sync-specs`/`openspec-archive-change`, update ticket 009's status and `000-index.md` to reflect real completion
