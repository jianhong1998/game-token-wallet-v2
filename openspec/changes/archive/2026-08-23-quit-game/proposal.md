## Why

A player who joins a General Mode game currently has no way to leave it. Ticket 011 requires a self-service "quit game" path — irreversible (the departing player's balance is burned, per architecture decision Q11), since real-life game groups need players to be able to leave a table without needing the admin to intervene.

## What Changes

- New `quit_game` on-chain instruction: burns the caller's remaining game-token balance, closes their Associated Token Account (rent reclaimed to the admin/system signer), and decrements `Game.player_count`.
- The game's admin is blocked from quitting their own game (new `AdminCannotQuitGame` error) — they must transfer admin (ticket 010) or close the game (ticket 013) first.
- A quit player can rejoin the same game later, same as any other join.
- Frontend: a "Quit game" button on the game detail page, visible only to non-admin players, opening a styled confirmation modal (never a native `confirm()`/`alert()`) before submitting. On success, redirects to the home dashboard.
- No admin-initiated "kick player" capability in this change — deferred, tracked in `docs/business-related/003-roadmap.md`.

## Capabilities

### New Capabilities
- `quit-game`: a player leaving a General Mode game — the on-chain burn-and-close instruction, its admin/self-service authorization rules, and the frontend confirm-and-quit flow.

### Modified Capabilities
- `game`: the "Game player count" requirement gains a decrement scenario (currently only documents increment-on-join).

## Impact

- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/quit_game.rs` (new), registered in `instructions/game/mod.rs` and `lib.rs`.
- `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`: new `AdminCannotQuitGame` variant.
- `apps/on-chain-client`: regenerated IDL/Codama client picks up the new instruction and error.
- `apps/frontend/src/server/actions/game.ts`: new `quitGame` Server Action.
- `apps/frontend/src/app/(app)/games/[address]/`: new quit-confirmation UI, wired into `page.tsx`.
- No changes needed to existing player-list/recipient-picker code (`fetchGameDetail`, `AdminControlsModal`, `SendTokensForm`) — they already derive membership from live token accounts, so a closed ATA disappears automatically.
