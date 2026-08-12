## 1. On-chain instruction

- [ ] 1.1 Add `errors.rs` variants: `SelfTransfer`, `InvalidTransferAmount`
- [ ] 1.2 Create `instructions/general_mode/` module and `transfer_token.rs`: accounts struct (`admin`, `sender`, `recipient`, `game`, `mint`, `sender_ata`, `recipient_ata`, `token_program`), self-transfer guard, positive-amount guard, ATA derivation/membership checks, CPI `token::transfer` signed by the sender's `User` PDA
- [ ] 1.3 Wire `transfer_token` into `lib.rs`'s `#[program]` module
- [ ] 1.4 Inline `#[cfg(test)]` unit tests for the pure guard functions (mirrors `mint_to_player.rs`'s `ensure_positive_amount` test pattern)

## 2. On-chain integration tests

- [ ] 2.1 `apps/on-chain-program-e2e/tests/general_mode/`: happy path (two members, positive amount, balances update correctly)
- [ ] 2.2 Self-transfer rejected with `SelfTransfer`
- [ ] 2.3 Non-member recipient rejected with `PlayerNotInGame`
- [ ] 2.4 Non-positive amount rejected with `InvalidTransferAmount`
- [ ] 2.5 Insufficient sender balance rejected by the SPL CPI's native error

## 3. Server Action

- [ ] 3.1 `transferTokens` in `apps/frontend/src/server/actions/game.ts`: input validation (non-empty, no duplicates, no self-transfer, positive/overflow-guarded amounts per recipient — reuse `depositToPlayer`'s base-unit conversion guards)
- [ ] 3.2 Pre-flight balance check (sum of amounts vs. sender's current ATA balance)
- [ ] 3.3 Instruction composition + size-aware chunking (pack by actual serialized message size, not a hardcoded recipient count; safety margin below the 1232-byte ceiling)
- [ ] 3.4 Sequential chunk send with stop-on-first-failure; return `{ ok, error?, transfersApplied, transfersTotal }`
- [ ] 3.5 Map on-chain errors (`SelfTransfer`, `InvalidTransferAmount`, `PlayerNotInGame`, insufficient-funds) to friendly messages, same style as `depositToPlayer`'s catch block
- [ ] 3.6 Unit tests: validation rejections, chunk-boundary packing at the ~19-recipient/max-username worst case, stop-on-first-failure reporting

## 4. Frontend

- [ ] 4.1 Inline "Send tokens" section on the game detail page (General Mode only, visible to all members) — repeatable recipient rows (picker + amount + remove), "+ Add recipient", running-total submit button, matching `docs/technical-related/ui-design/004-ui-sample/Kitty - Glass Vault.dc.html`'s `isGame`/`gameIsGeneral` reference
- [ ] 4.2 Row picker excludes both the current user and usernames already chosen in other rows
- [ ] 4.3 Error slot: short validation messages pre-submit, count-naming partial-failure message post-submit; success path uses existing toast + `router.refresh()` convention
- [ ] 4.4 Component unit tests (row add/remove, duplicate-exclusion, submit wiring)

## 5. End-to-end

- [ ] 5.1 Playwright spec `apps/e2e/tests/general-mode/transfer.spec.ts`: two-browser-context multi-recipient transfer, balances confirmed on both sides
- [ ] 5.2 Manually verify against a freshly rebuilt local stack (`just down-clean && just up-build`) per CLAUDE.md's "Done Means" — exercise the worst-case ~19-recipient batch if feasible, or document why it wasn't

## 6. Housekeeping

- [ ] 6.1 Correct `docs/tickets/000-index.md`'s ticket 009 row back to "Pending" (mistakenly flipped to "Done" in commit `0e9f2ee`) until this change actually ships
- [ ] 6.2 On completion: check off `openspec/changes/general-mode-transfers/tasks.md`, run `openspec-sync-specs`/`openspec-archive-change`, update ticket 009's status and `000-index.md` to reflect real completion
