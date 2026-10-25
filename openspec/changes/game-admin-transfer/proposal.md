## Why

A game's admin currently cannot hand the role to anyone else, and ticket 011 forbids that admin from quitting — the only exits are transferring admin (this ticket) or closing the game (ticket 013). The PRD requires the admin role to be transferable to another user already in the game, and architecture decision Q13 already settled the semantics: the new admin must already be a player, the outgoing admin stays a regular player, and there is exactly one admin.

## What Changes

- New on-chain `transfer_game_admin` instruction: only the current game admin can call it, the target must already be a player in that same game, and the only state change is overwriting `Game.admin` with the target's `User` PDA. No account resize, no token movement, no `player_count` change.
- Transferring to yourself is rejected with a new dedicated error (not a silent no-op). Transferring to a non-member, or as a non-admin, reuses the existing `PlayerNotInGame` / `InvalidPlayerAta` / `NotGameAdmin` errors. A closed or unknown game fails with a clear not-found error.
- After a successful transfer the new admin has the existing admin powers (mint/deposit and close game; private-game password management arrives with ticket 007 and is not built here) and the former admin loses them but remains a player with their token balance untouched — so they can then leave through the existing quit-game flow, which still rejects whoever is the current admin.
- New `transferGameAdmin` Server Action, following the same session-username authorization as `depositToPlayer`: the deployment's system wallet signs and pays, and "only the current admin" means the session username resolves to the `User` PDA stored in `Game.admin`.
- "Transfer admin role" form inside the existing Admin controls modal on the game detail page, listing the other current players. Non-admin players do not see this control. No second confirmation step and no acceptance by the new admin.

## Capabilities

### New Capabilities
- `game-admin-transfer`: handing a game's single admin role from the current admin to another current player — the on-chain overwrite of `Game.admin`, the session-authorized Server Action, and the admin-only transfer form — including the follow-on fact that the former admin can quit and the new admin cannot.

### Modified Capabilities
- `game`: the "Game admin identity" requirement currently says the admin is the creator's `User` PDA. That stays true at creation, and is no longer the whole story once the role can move: `Game.admin` remains a `User` PDA (never a wallet keypair) and can be overwritten in place.

## Impact

- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/transfer_game_admin.rs` (new), registered in `instructions/game/mod.rs` and `lib.rs`. `errors.rs` gains one variant, `CannotTransferAdminToSelf`, appended at the end so existing error codes do not renumber. `Game`'s account layout does not change.
- `apps/on-chain-program-e2e/tests/game/`: happy path (admin pubkey moves, balances and `player_count` unchanged), non-admin rejection, non-member rejection, self-transfer rejection, closed/missing game rejection, and the post-transfer quit split (former admin can `quit_game`, new admin cannot) plus the flipped mint/close authorization.
- `apps/on-chain-client`: regenerated IDL/Codama client picks up the new instruction and error. Account field names match `MintToPlayer` (`admin`, `user`, `player_user`, `game`, `player_ata`) so Codama keeps one PDA finder per account.
- `apps/frontend/src/server/actions/game.ts`: new `transferGameAdmin` action. `apps/frontend/src/app/(app)/games/[address]/AdminControlsModal.tsx`: transfer form. No new route.
- `apps/e2e/tests/general-mode/`: Playwright flow for the transfer and the subsequent quit by the former admin.
- No CI config changes — CircleCI already runs `cargo test`, `on-chain-program-e2e`, frontend unit tests, and Playwright on every PR.
- Out of scope: admin-initiated kick (deferred in `docs/business-related/003-roadmap.md`) and private-game passwords (ticket 007).
