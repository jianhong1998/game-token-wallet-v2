## Why

Every game is public today. The PRD requires a game to be either public or private: private games stay in the browse list, and joining one requires a password that is stored on the `Game` account as a hash. Only the current game admin may set or change that password. Ticket 003 already settled how this deployment hashes passwords; ticket 007 reuses that, rather than inventing a second scheme.

## What Changes

- `Game` gains three fields, appended after `player_count`: `is_private: bool`, `password_salt: [u8; 16]`, `password_hash: [u8; 64]`. `Game::INIT_SPACE` grows from 120 to 201. Public games store `is_private = false` and both arrays zero. Private games store a non-zero salt and hash. The plaintext password is never an instruction argument.
- `create_game` takes `is_private`, `password_salt`, and `password_hash`. Visibility is chosen at creation and defaults to public. The creator is still auto-joined in that same instruction (ticket 021) and does not pass the password through `join_game`.
- New `set_game_password` instruction. The caller must be the `User` PDA currently stored in `Game.admin`. It replaces the salt and hash and changes nothing else: not `is_private`, not `player_count`, not membership, not balances, not the account size. A public game rejects it. There is no instruction that flips visibility after creation.
- Joining a private game is checked on the server with ticket 003's `verifyPassword` before the server signs the existing `join_game` instruction. `join_game` itself is unchanged and does not read the password fields. A wrong, empty, or illegal password never becomes a transaction, and the game is left as it was. The 20-player cap and the duplicate-join rejection stay in force.
- Create-game form gains a Public/Private choice (default Public) and a password field when Private is selected. Browse and home lists show a Private or Public label. Joining a private game opens a password prompt; a public game still joins in one click. The current admin of a private game gets a "Change password" form inside the existing Admin controls modal. No second confirmation, and existing members are not prompted.

## Capabilities

### New Capabilities

- `private-game`: creating a password-protected game, joining it only with the current password, changing that password as the current admin, and the list/prompt UI. Includes the rule that a password change does not remove players already in the game.

### Modified Capabilities

- `game`: creation no longer always means public. The creator still chooses General Mode, still becomes admin, and is still auto-joined, including when the game is private. The account stores the privacy fields described above.
- `join-game`: joining a public game stays password-free. Joining a private game is the `private-game` capability, not this one.

## Impact

- `apps/on-chain-program/programs/game_token_wallet/src/state/game.rs` — three fields and the `INIT_SPACE` guard. `errors.rs` gains `InvalidGamePassword` and `GameIsNotPrivate`, appended after `GameNotInRegistry`. New `instructions/game/game_password.rs` (pure checks) and `instructions/game/set_game_password.rs`. `create_game` and `lib.rs` take the new arguments. `join_game` is not modified.
- Account size: a new `Game` is `8 + 201 = 209` bytes (was `8 + 120 = 128`). Existing games are not realloc'd. Local and devnet games created before this layout must be reset (`just down-clean`, recreate on devnet), the same call ticket 006 made when `player_count` grew `Game`. Ticket 005's note that 007 would `realloc` is superseded by that precedent.
- `apps/on-chain-client`: regenerated Codama client. Every existing `getCreateGameInstructionAsync` call site must pass `isPrivate`, `passwordSalt`, and `passwordHash`.
- `apps/frontend`: `createGame`, `joinGame`, and a new `changeGamePassword` Server Action; `listBrowseGames`, `listMyMemberGames`, and `fetchGameDetail` expose `isPrivate` and do not send the salt or hash to the client. Create page, browse row, home list, game detail header, and `AdminControlsModal`.
- Tests: cargo unit tests for the pure checks, `apps/on-chain-program-e2e/tests/game/private_game.test.ts`, Server Action and component tests, Playwright `apps/e2e/tests/private-game.spec.ts`. No CircleCI change.
- Out of scope: flipping a live game between public and private, an on-chain scrypt check, kicking players when the password changes, and ticket 010's admin-transfer instruction. Authorization reads `Game.admin`, so a later transfer moves password control with the role without a change here.
