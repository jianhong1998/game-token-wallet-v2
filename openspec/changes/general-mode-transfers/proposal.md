## Why

General Mode games currently have no way for players to move tokens to each other — ticket 008 only let the admin mint deposits in. Ticket 009 is the next frontier item (blocked-by 008, now done): players need to send tokens directly to one or several other players in the same game, which is General Mode's whole reason for existing (per architecture decision Q10, "Players transfer tokens directly to each other").

## What Changes

- New on-chain `transfer_token` instruction: single-recipient, fixed-account (no `Vec`/`remaining_accounts`), moves tokens between two players' ATAs for the same game's mint. Rejects self-transfer, non-positive amounts, and a recipient who isn't already a member — all enforced on-chain, not just hidden in the UI. Insufficient sender balance is rejected by the underlying SPL CPI itself (no separate on-chain balance check).
- New `transferTokens` Server Action: accepts a list of `{recipient, amount}` pairs from the session's own user (sender is always the caller, never a parameter), validates the batch (no duplicates, no self-transfer, positive amounts, best-effort balance sum check), composes one `transfer_token` instruction per recipient, and chunks them across multiple transactions when a batch doesn't fit Solana's per-transaction limits. Stops on the first chunk failure and reports how many recipients were actually paid vs. requested, so a partial batch is never reported as a bare success or silently swallowed as a bare failure.
- New inline "Send tokens" section on the game detail page (General Mode games only, visible to all members): repeatable recipient rows (player picker + amount), submit sends the whole batch in one action. Each row's picker excludes both the current user and recipients already chosen in other rows.

## Capabilities

### New Capabilities
- `general-mode-transfers`: player-initiated, multi-recipient token transfers between members of the same General Mode game — the on-chain instruction, the batching/chunking Server Action, and the transfer form.

### Modified Capabilities
(none — this only adds new behavior; no existing spec's requirements change)

## Impact

- `apps/on-chain-program/programs/game_token_wallet/src/instructions/general_mode/` (new module) + `transfer_token.rs`; `lib.rs` gains the `transfer_token` program entrypoint; `errors.rs` gains `SelfTransfer` and `InvalidTransferAmount`.
- `apps/on-chain-program-e2e/tests/general_mode/` (new): happy path, self-transfer rejection, non-member rejection, non-positive-amount rejection, insufficient-balance rejection.
- `apps/frontend/src/server/actions/game.ts`: new `transferTokens` action alongside `depositToPlayer`.
- `apps/frontend/src/app/(app)/games/[address]/`: new inline transfer form component on the game detail page.
- `apps/e2e/tests/general-mode/`: new Playwright spec covering a multi-recipient transfer.
- `apps/on-chain-client`: regenerated IDL/Codama client picks up the new instruction automatically (existing codegen step, no manual work).
- Housekeeping: `docs/tickets/000-index.md` currently marks ticket 009 "Done" from a copy-paste slip in commit `0e9f2ee` (008's row correctly flipped, 009's appears to have been flipped too by mistake) despite being unstarted — correct it back to "Pending" until this change actually ships.
