## Why

Players deposit cash offline (poker/mahjong night) and the admin needs a way to credit that as in-game tokens. Today there is no instruction that mints tokens into a player's balance after game creation/joining — `create_game` only mints the creator's own zero-balance ATA, and `join_game` creates a player's ATA but never funds it. Without this, a game has no way to get tokens into circulation at all.

## What Changes

- Add a new `mint_to_player` on-chain instruction: mints an admin-specified amount into a target player's existing ATA for the game's mint. Restricted to the game's admin via an on-chain identity check (`user.key() == game.admin`) — not a tx-signer check, since every transaction is signed by the single custodial system admin wallet regardless of which user is acting. Rejects with `NotGameAdmin` if the caller isn't the game's admin, and `PlayerNotInGame` if the target doesn't already have an ATA for that game (deposit never auto-joins).
- Add two new on-chain error codes: `NotGameAdmin`, `PlayerNotInGame`.
- Add a `depositToPlayer` Server Action (frontend) that validates amount > 0 client-side, converts whole-token input to the mint's 2-decimal base units, and submits the transaction.
- Add an admin-only "Admin controls" modal on the existing `/games/[address]` page (new UI surface, matching `docs/technical-related/ui-design/004-ui-sample/Kitty - Glass Vault.dc.html`), containing a "Deposit for offline cash-in" form: player picker (current roster) + amount input + submit. Only this deposit sub-form is wired up now; the modal's other sections (admin transfer, close game) are left for tickets 010/013.
- On successful deposit, the admin's own view refreshes immediately (`router.refresh()`); the affected player sees the updated balance on their next load/navigation of that page — no live/push update is introduced.

## Capabilities

### New Capabilities
- `player-deposit`: admin-only minting of tokens into an existing player's balance to represent an offline cash deposit, including the on-chain instruction, its access-control and validation rules, and the admin-facing deposit UI.

### Modified Capabilities
(none — `join-game`'s existing roster/balance display requirements are unchanged; this change only adds a new way for balances to increase, not new display requirements)

## Impact

- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mint_to_player.rs` (new instruction file + `mod.rs` export)
- `apps/on-chain-program/programs/game_token_wallet/src/errors.rs` (two new error variants)
- `apps/on-chain-client` (regenerated IDL/Codama client — new instruction, new errors)
- `apps/frontend/src/server/actions/game.ts` (new `depositToPlayer` Server Action)
- `apps/frontend/src/app/(app)/games/[address]/page.tsx` and a new client-component modal (admin controls + deposit form)
- New Rust unit tests (inline, mirroring `join_game.rs`'s pattern) and a new `on-chain-program-e2e` test file
- New frontend unit tests for the Server Action and modal, plus a Playwright e2e spec exercising admin deposit → player balance update
