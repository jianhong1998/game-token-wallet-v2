## Why

A logged-in user currently has no way to join a game someone else created — `Game` exists and can be created (005), but nothing lets a second user become a player in it. This unblocks every downstream ticket that assumes a game has players: 007 (private games), 008 (deposits), 009 (transfers), 010 (admin transfer), 011 (quit), 014/016 (poker/pool modes).

## What Changes

- New `join_game` on-chain instruction: creates the joining player's Associated Token Account (ATA) for the game's SPL mint (owned by the player's `User` PDA, per the custodial wallet model), rejects with a dedicated `AlreadyJoinedGame` error if the ATA already exists, rejects with a dedicated `GameFull` error at 20 players (PRD's fixed cap), and increments a new `Game.player_count: u8` field on success.
- `Game` gains `player_count: u8` (a scalar count, not a player pubkey list — membership itself stays tracked implicitly via ATA existence, per the existing architecture decision). `create_game` (005) is touched minimally to initialize it to 0; no other change to that instruction.
- New frontend: `/games/all` browse page listing every active game in the `Registry` with a per-row player count and a context-sensitive Join/Open button (batch-checked membership across all active games); `/games/[address]` game-detail page showing the game's name/mode, an admin badge when applicable, the viewer's own balance, and the full players roster (username + balance), derived off-chain via a mint-filtered `getProgramAccounts` query (bounded ≤20 results) plus batched `User` PDA lookups to resolve usernames.
- Existing `/games` ("My games", admin-only list, from 005) is untouched — the new browse/detail pages live at distinct routes to avoid regressing shipped behavior ahead of ticket 018's later consolidation.
- Explicitly out of scope: admin auto-join at game creation (filed separately as ticket 021), transfers/quit/admin-controls/activity-log on the detail page (owned by 008/009/010/011), private-game passwords (007).

## Capabilities

### New Capabilities
- `join-game`: joining an existing public game as a player, browsing active games, and viewing a game's player roster/balances.

### Modified Capabilities
- `game`: `Game` account gains a `player_count` field, initialized by `create_game` and incremented by `join_game`.

## Impact

- Affected on-chain: `apps/on-chain-program/programs/game_token_wallet/src/state/game.rs` (new field/constant), `src/errors.rs` (new errors), `src/instructions/game/join_game.rs` (new), `src/instructions/game/create_game.rs` (minimal touch — initialize `player_count`), `src/lib.rs`.
- Affected client generation: `apps/on-chain-client` (regenerated from the updated IDL).
- Affected frontend: `src/server/actions/game.ts` (new `joinGame`, `listBrowseGames`, `fetchGameDetail`), `src/app/(app)/games/all/page.tsx` (new), `src/app/(app)/games/[address]/page.tsx` (new).
- Affected tests: `apps/on-chain-program-e2e/tests/game/join_game.test.ts` (new), `apps/e2e/tests/*` (new join-flow spec).
- Likely new frontend dependency for deriving/creating Associated Token Accounts client-side (exact package confirmed and flagged for install-approval during implementation — see design.md).
