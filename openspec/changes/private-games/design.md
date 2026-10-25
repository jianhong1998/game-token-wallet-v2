## Context

Ticket 007 (`docs/tickets/007-private-games.md`), blocked by 005 and 006 (both done). Ticket 021 (admin auto-join at creation) is also done and is part of this change's behavior. See proposal.md for why.

`Game` (`state/game.rs`) is 120 bytes of `INIT_SPACE` today: `bump`, `mint_bump`, `game_id`, `name`, `mode`, `admin`, `mint`, `player_count`. `create_game` allocates `8 + Game::INIT_SPACE`, sets `player_count` to 1, and creates the creator's ATA in the same instruction. `join_game` creates a further player's ATA, increments `player_count`, and rejects `GameFull` at 20 and `AlreadyJoinedGame` on a second join. It does not know about passwords. `close_game.rs` already has `ensure_caller_is_admin`, comparing the caller's `User` PDA to `Game.admin`. `close_game_player.rs` defines a second copy of that helper; both modules are glob-exported. This change does not add a third.

Ticket 003 stores a login password as a 16-byte salt and a 64-byte scrypt hash on `User`, computed in `apps/frontend/src/server/password.ts` and checked with `verifyPassword` (`timingSafeEqual`). The rules live in `validatePassword` (`apps/frontend/src/lib/password-rules.ts`): length 8–20, charset `/^[A-Za-z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/`. The chain never sees the plaintext. The product owner has decided game passwords reuse that stack.

The custodial model is unchanged. One system wallet signs and pays for every transaction. Which end user is acting is the session username, resolved to a `User` PDA with seeds `["user", username, system_admin]`.

## Goals / Non-Goals

**Goals:**

- A game is public or private from the moment `create_game` returns. Private games remain in the browse list and require the current password to join.
- The hash and salt on `Game` use the same widths and the same off-chain scrypt as `User`.
- Only the current `Game.admin` can replace a private game's password, enforced on-chain by the existing admin comparison, not only by hiding a button.
- A password change does not touch membership, balances, `player_count`, or the account size, and it does not ask existing players to do anything.
- The creator is a player immediately, including for a private game, without a `join_game` and without a second password entry.
- Tests a Quality Engineer can map onto cargo, on-chain e2e, Server Action unit tests, component tests, and one Playwright flow.

**Non-Goals:**

- Turning a public game private, or a private game public, after creation.
- Checking the password inside `join_game`, or putting the plaintext password in a transaction.
- Removing or re-prompting players who already joined when the password changes.
- A confirm-password field, a "type the old password" step, or a second confirmation modal.
- Ticket 010's `transfer_game_admin`. This change reads `Game.admin`. When that field is later overwritten, password control moves with it and this instruction does not change.
- Kicking a player, password reset by a non-admin, or a separate "I know this game's password" session that skips the check on a later join.
- CI config. CircleCI already runs `cargo test`, `on-chain-program-e2e`, frontend unit tests, and Playwright on every PR.
- A realloc/migration instruction for `Game` accounts created at the old size.

## Decisions

### D1: Reuse ticket 003's hash and rules

Settled by the product owner. The server calls the existing `hashPassword` and `verifyPassword`. It does not add a hasher, a charset, or a length bound.

`hashPassword` already draws a new 16-byte salt on every call. Create and change both use that. A change does not reuse the salt already stored on the game. `verifyPassword` is the only compare; the action does not use `===` on the hash.

`validatePassword` runs in the browser and again in the Server Action, same as registration. Empty, too short, too long, and a disallowed character (the space in `"Abcdef 12"` is the charset case already covered by `password-rules.test.ts`) all fail before `hashPassword` or `verifyPassword` and before any RPC. The message is that function's `reason` (`"Password must be between 8 and 20 characters"` or `"Password contains a disallowed character"`).

There is no confirm-password field. The design sample's create form and join prompt are a single password input. The admin can set a new password immediately if they mistype.

**Alternative considered:** a shorter or numeric table password, because a game password is shared at the table. Rejected — the product owner said to reuse 003's rules where they are sensible, and they fit an 8–20 shared secret without a second policy to test.

### D2: Password material lives on the `Game` account

The per-game salt and the per-game scrypt hash are fields of the `Game` account data (the PDA seeded `["game", game_id]`). That is the PRD's "stored into the game account data as hash", plus the salt ticket 003's scrypt needs in order to verify. They are not a second PDA, not a memo, and not a row in an off-chain store. The plaintext password is never written.

```rust
pub is_private: bool,                          // 1 byte
pub password_salt: [u8; SALT_BYTES],           // 16, from state/user.rs
pub password_hash: [u8; PASSWORD_HASH_BYTES],  // 64, from state/user.rs
```

Appended after `player_count`, so the offsets of `bump` through `player_count` do not move. `Game::INIT_SPACE` becomes 201. The account is `8 + 201 = 209` bytes (was `8 + 120 = 128`). The sizing test in `state/game.rs` is the guard, using `SALT_BYTES` and `PASSWORD_HASH_BYTES` so the widths cannot drift from `User`.

`Game` account data is publicly readable on-chain. Anyone with RPC access can copy `password_salt` and `password_hash` and attempt an offline brute force. The mitigation is the slow, salted scrypt from ticket 003 (`crypto.scrypt`, N=16384, r=8, p=1, a fresh 16-byte salt per hash) plus the 8-character minimum from `validatePassword`. That is acceptable for casual games among people who already share a table password. It is not strong secrecy. UI copy and docs must not describe the game password, the salt, or the hash as hidden, private to the server, or safe against someone who can read the account. Not rendering the hash in the client is convenience, not a confidentiality boundary.

"No password" is `is_private == false` plus both arrays zero, not an `Option`. A bool is the flag. Inferring privacy from a non-zero hash would make a partial write ambiguous. `Option<[u8; 64]>` is what ticket 005's design sketch named, and it did not include a salt. A hash without the salt cannot be checked by ticket 003's scrypt, so the sketch is not the layout.

On-chain invariant, one helper `ensure_password_material(is_private, salt, hash)`:

- private: salt and hash are each not all zeros
- public: salt and hash are each all zeros
- otherwise `InvalidGamePassword`

A real scrypt output is not all zeros in any practical sense. The zero check is there so a public game cannot carry a leftover hash and a private game cannot be stored with an empty password. The server never sends those bytes; the helper is the bypass check.

**Alternative considered:** `password_hash: Option<[u8; 64]>` and a separate salt option, matching the ticket's word "optional" literally. Rejected — two option tags add two bytes and a `None` versus `Some(zeros)` state the bool already covers. `User` uses fixed arrays. Public games storing zeros is "no password" in the account data.

### D3: Visibility is chosen at creation and does not change later

`create_game(ctx, game_id, name, username, is_private: bool, password_salt: [u8; 16], password_hash: [u8; 64])`.

The handler calls `ensure_password_material` before it writes the game. `init` rolls the account back when the handler returns an error, so a rejected create leaves no `Game` PDA. Public creation passes `false` and two zero arrays and does not call `hashPassword`, even if the request also carried a password string. The create form's default is Public, so the existing create and join Playwright specs keep working without a new click.

There is no `set_game_visibility` instruction. `set_game_password` does not write `is_private`.

This is the simplest reading that still matches the PRD. "Create or modify the password" is create-time choice plus later replacement of a private game's password. The design sample puts the Public/Private control on the create form only. Making a live public game private would cut off people who can join it today; making a private game public would drop a password members joined under. Both want a confirmation this change is explicitly not adding.

**Alternative considered:** `set_game_password` on a public game flips `is_private` to true, and an empty password flips it back to false. Rejected as the visibility switch above. A reviewer who wants that switch should say so; it is a product change, not a bug in this layout (the fields are already on the account).

### D4: `set_game_password` writes the salt and the hash

`set_game_password(ctx, game_id, username, password_salt: [u8; 16], password_hash: [u8; 64])`.

| Account | Type | Notes |
|---|---|---|
| `admin` | `Signer`, `mut` | System wallet. Fee payer. Same name as every other instruction. |
| `user` | `Account<User>` | seeds `[b"user", username, admin.key()]`. The caller. Compared to `game.admin`. |
| `game` | `Account<Game>`, `mut` | seeds `[b"game", game_id]`, `bump = game.bump`. The only account this instruction writes. |

No `player_ata`, `mint`, or token program. Membership is not consulted: an admin who is somehow not a player can still change the password, because the PRD keys that power off admin identity, not off an ATA. No `system_program`: the account is not resized.

Handler order:

1. `ensure_caller_is_admin` from `super::close_game::ensure_caller_is_admin` → `NotGameAdmin`. Do not declare another `pub fn ensure_caller_is_admin`. `close_game.rs` and `close_game_player.rs` already each export one, and a third glob-export trips `ambiguous_glob_reexports` (the same note on ticket 010's review).
2. `ensure_game_is_private` → `GameIsNotPrivate` ("Only a private game has a password").
3. `ensure_password_material(true, salt, hash)` → `InvalidGamePassword` ("A private game's password salt and hash must each contain a non-zero byte, and a public game's must each be all zeros").
4. Write `password_salt` and `password_hash` only.

Admin is first so a non-admin acting on a public game gets `NotGameAdmin`, not `GameIsNotPrivate`. The current admin of a public game is who gets `GameIsNotPrivate`.

Ticket 010's spec is on `main` and appends `CannotTransferAdminToSelf` after `GameNotInRegistry` (index 14, `6014` / `0x177E`) as index 15, `6015` / `0x177F`. Its implementation (#40) is expected to merge first and is not in `errors.rs` yet. This change appends after that variant, never in the middle, so the final numbering is:

- `InvalidGamePassword` ("A private game's password salt and hash must each contain a non-zero byte, and a public game's must each be all zeros") — index 16, `6016` / `0x1780`
- `GameIsNotPrivate` ("Only a private game has a password") — index 17, `6017` / `0x1781`

Append only. Do not insert in the middle. Existing codes, including `6014` / `0x177E` and 010's `6015` / `0x177F`, stay put. If this change's program code is written while `errors.rs` still ends at `GameNotInRegistry`, do not leave the two variants at `6015` / `6016`. Put them after `CannotTransferAdminToSelf` before the client pin is written, so the pin matches `6016` and `6017`. Every other test matches these errors by name and does not mention a numeric code.

The admin does not submit the previous password. The session is the authorization. Settled product rule: players already in the game are not removed and are not asked to confirm. Not asking the admin for the old password is the matching choice — they may have forgotten the shared secret, and there is no recovery flow in the PRD.

`changeGamePassword({ gameAddress, password })` in `apps/frontend/src/server/actions/game.ts`:

1. `getCurrentUsername()`. Missing session → `"Not signed in"`, no RPC.
2. `validatePassword`. Failure → its `reason`, no `hashPassword`, no RPC.
3. `fetchMaybeGame`. `exists: false` (unknown address, or a game `close_game` already deleted) → `"Game not found"`.
4. Derive the session user's PDA. If it is not `game.data.admin` → `"Only the game's admin can change the password"`, no transaction.
5. If `!game.data.isPrivate` → `"Only a private game has a password"`, no transaction.
6. `hashPassword`, build `getSetGamePasswordInstructionAsync` with `username` from the session, sign with the system wallet, send.
7. Map `NotGameAdmin` to the same admin message, `GameIsNotPrivate` to the same public-game message, and `InvalidGamePassword` to `"That password could not be stored"`. Those mappings are defense in depth; the pre-checks cover the same cases the UI can produce.

### D5: The password gate is the server. `join_game` stays as it is

Scrypt does not run on-chain. The hash is sitting in a public account, so an instruction argument that repeats the hash would not prove the caller knows the password. Putting the plaintext in the transaction would publish it. The server is the only signer, which is the same reason login can be an off-chain `verifyPassword` before a session cookie is set.

`joinGame(gameAddress, password?)` keeps today's order, then adds the password step:

1. Not signed in → `"Not signed in"`.
2. `fetchMaybeGame` missing → `"Game not found"`. No dummy scrypt. The game list already publishes which games exist; ticket 003's dummy hash exists because a username is not listed. Do not copy it here.
3. ATA already exists → `"You are already a player in this game"`. Password not checked. This is also why a member is not stuck outside after a password change.
4. `playerCount >= 20` → the existing full-game message. Password not checked. The count is already on the row.
5. If `isPrivate`: missing, empty, or illegal password → `validatePassword`'s reason, no `verifyPassword`. Otherwise `verifyPassword` against `game.data.passwordSalt` and `game.data.passwordHash`. False → `"Incorrect password."`. No instruction, no send.
6. If public: ignore any password argument, do not call `verifyPassword`.
7. The existing `join_game` build, send, and `GameFull` / `AlreadyJoinedGame` catch.

A direct `join_game` against a private game succeeds. That is specified, not a hole to "fix" with an on-chain compare. Players cannot submit it; the e2e suite can, because the test holds the system signer. The on-chain test records that fact so a later change does not silently start rejecting it.

The creator's auto-join is `create_game` writing the ATA, not a join. Settled by the product owner: that path does not check the password. The password they typed is the game password. If `Game.admin` is ever not a member (only possible after a later quit, which today requires ticket 010 so the admin can leave), `join_game` does not special-case them. The Server Action test covers that with a mock: admin pubkey matches the session user, ATA is absent, game is private, password still required.

### D6: UI follows the design sample, minus the toast

Create page (`apps/frontend/src/app/(app)/games/new/page.tsx`): two controls, "Public" (default) and "Private". The password input is shown only while Private is selected, `data-testid="create-game-password"`, labeled so Playwright can use `getByLabel`. Selecting Public again hides it and the submit does not require it. Client-side `validatePassword` before calling `createGame({ name, isPrivate, password })`. Existing `createGame({ name })` stays valid: `isPrivate !== true` means public, so a caller that omits the flag cannot accidentally create a private game with no password.

Browse row: subtitle gains "Public" or "Private" (`data-testid="game-visibility"`). Public non-member: button "Join", calls `joinGame(address)` with no password, as today. Private non-member: button "Enter password"; click opens a prompt (`data-testid="join-password-form"`) and does not call the action. Submit calls `joinGame(address, password)`. Empty submit sets `data-testid="join-password-error"` and does not call. Wrong password uses the existing `data-testid="join-game-error"` alert and does not navigate. Cancel closes the prompt. Member: "Open", no prompt, including when `isPrivate` is true.

Home list (`app/(app)/page.tsx`): the same "Public" / "Private" word next to the mode. Detail header: the same word, `data-testid="game-visibility"`.

`BrowseGame`, `MemberGame`, and `GameDetail` gain `isPrivate: boolean` only. They do not gain salt or hash fields. The join and change actions re-fetch the account on the server.

`AdminControlsModal` gains `isPrivate`. When true, under the deposit form: a password input and a "Change password" button, `data-testid="change-password-error"` for failures. Client-side `validatePassword` first. Success closes the modal and calls `router.refresh()`, which is what deposit already does. No second dialog. The sample's toast does not exist in the app. When `isPrivate` is false the form is not rendered. The detail page already renders the modal only when `game.isAdmin`, so a non-admin never sees it.

### D7: Tests, and no CI change

Cargo, in `game_password.rs` only (the admin helper is already tested in `close_game.rs`):

- `ensure_password_material`: private with both non-zero ok; private with a zero salt, a zero hash, or both zero err; public with both zero ok; public with a non-zero salt or a non-zero hash err.
- `ensure_game_is_private`: true ok, false err.
- `Game::INIT_SPACE` formula includes the 81 new bytes.

`apps/on-chain-program-e2e/tests/game/private_game.test.ts`, one shared system signer per test (the `mint_to_player.test.ts` rule):

- private create stores the exact salt and hash, `is_private` true, `playerCount` 1, creator ATA exists, raw account length 209
- public create stores zeros and `is_private` false (also asserted on the existing `create_game.test.ts` happy path)
- private create with a zero hash, and public create with a non-zero hash, each return `InvalidGamePassword` and `fetchMaybeGame` is `exists: false`
- `set_game_password` by the admin replaces the bytes, length stays 209, `playerCount` and a second player's ATA amount stay put
- non-admin on a private game → `NotGameAdmin`, bytes unchanged
- admin on a public game → `GameIsNotPrivate`, zeros unchanged
- admin on a private game with a zero hash → `InvalidGamePassword`, previous bytes unchanged
- missing game writes nothing
- `join_game` on a private game with room succeeds without a password argument
- a private game at 20 players still returns `GameFull`

Server Action tests in `game.test.ts`, mocking `hashPassword` / `verifyPassword` and `on-chain-client` the way the file already mocks the chain. Add `GAME_TOKEN_WALLET_ERROR__INVALID_GAME_PASSWORD` and `GAME_TOKEN_WALLET_ERROR__GAME_IS_NOT_PRIVATE` to that mock. Component tests for the create form, the browse prompt, the home label, the detail label, and the modal matrix (private admin / public admin / the empty submit / success refresh / error stays open). Non-admin is the detail page test: the modal is not rendered.

Playwright `apps/e2e/tests/private-game.spec.ts`, three contexts, unique usernames, passwords that pass `validatePassword` (`Abcdef123!` is already the e2e login password; use a different game password so a login password is not silently the game password). Create private, home shows Private, joiner sees the row and the prompt, wrong password stays on browse and the count stays `1/20`, right password joins, admin changes the password, the first joiner still opens the game with no prompt and is still on the roster, a third user fails the old password and joins with the new one.

`apps/on-chain-client/src/index.test.ts` is the only numeric pin, the same kind of pin as ticket 010's `0x177f` check, and it is written at implementation time against the final numbering in D4. After codegen it asserts `GAME_TOKEN_WALLET_ERROR__INVALID_GAME_PASSWORD` is `0x1780`, `GAME_TOKEN_WALLET_ERROR__GAME_IS_NOT_PRIVATE` is `0x1781`, `GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF` is still `0x177f`, and `GAME_TOKEN_WALLET_ERROR__GAME_NOT_IN_REGISTRY` is still `0x177e`. It also asserts `getSetGamePasswordInstructionAsync` is a function. No second pin is written for an interim numbering.

Every other test matches a program error by name. On-chain e2e passes the generated constant to `isGameTokenWalletError` (`GAME_TOKEN_WALLET_ERROR__INVALID_GAME_PASSWORD`, `GAME_TOKEN_WALLET_ERROR__GAME_IS_NOT_PRIVATE`, and the existing `NOT_GAME_ADMIN` / `GAME_FULL` constants), the same shape as `create_game.test.ts`. It does not compare against `0x1780`, `6016`, or any other literal. Server Action tests mock those two constants by name and assert the mapped message. The mock numbers are not a pin.

The password rule is not an on-chain test. `join_game` does not see the password, so `private_game.test.ts` checks stored salt and hash bytes, account length, and program errors (`InvalidGamePassword`, `GameIsNotPrivate`, `NotGameAdmin`, `GameFull`). It does not call `validatePassword`, does not reject a wrong password string, and does not run scrypt. Those cases are Server Action unit tests and the Playwright flow.

Every existing `getCreateGameInstructionAsync` call passes `isPrivate: false` and two zero arrays. Public e2e (`game-creation.spec.ts`, `game-joining.spec.ts`) is unchanged because the create form defaults to Public.

Do not edit CircleCI config.

## Risks / Trade-offs

- **[Risk]** Ticket 010's `CannotTransferAdminToSelf` (`6015` / `0x177F`) is not in `errors.rs` yet. #40 is expected to merge first; if this change's variants land ahead of it they would take `6015` and `6016`. → **Mitigation:** D4. Append after `CannotTransferAdminToSelf`, and write the single client pin for `6016` / `0x1780` and `6017` / `0x1781` at implementation time. On-chain e2e and Server Action tests match the error by name, so they do not encode either numbering.
- **[Risk]** A `Game` created before this upgrade is 128 bytes and will not deserialize. A `Game` created after it is 209 bytes and will not deserialize on the previous program if borsh rejects trailing bytes. → **Mitigation:** D2 and the migration plan. No mixed-version rollback. Reset local and devnet state as part of deploy, same as ticket 006.
- **[Risk]** A later change "fixes" the direct-`join_game` success by comparing a caller-supplied hash to the account. That check does not prove knowledge of the password, and it breaks the specified trust boundary. → **Mitigation:** the requirement "Join instruction does not check the password" and the e2e that expects success.
- **[Risk]** Adding `pub fn ensure_caller_is_admin` in the new module makes the glob export ambiguous. → **Mitigation:** D4 calls the `close_game` helper.
- **[Risk]** `create_game`'s new required arguments break every Codama call site at once. → **Mitigation:** the plan lists them and treats "public args added, existing tests still pass" as its own step before the private-game tests.
- **[Risk]** The admin's browser shows the old password form until refresh. → **Mitigation:** success calls `router.refresh()`. A stale submit still writes a hash the admin just chose; it cannot admit a non-admin, because the program checks `Game.admin`.
- **[Risk]** Someone reads "password hash" and treats the game password as a secret the chain cannot see. → **Mitigation:** D2. The salt and hash are public account data. UI and docs must not claim otherwise. The mitigation is slow salted scrypt and an 8-character minimum, which is not strong secrecy.

## Migration Plan

No realloc instruction. `create_game`'s `init` space is `8 + Game::INIT_SPACE`, so every game created after the upgrade has the new layout. Games created before it cannot be loaded by `Account<Game>` or by the regenerated client decoder.

Operational step, same as ticket 006 when `player_count` was added: `just down-clean` for local, and recreate devnet games after the program deploy. There is no mainnet state. Ticket 005's design said ticket 007 would grow `Game` via `realloc`. Ticket 006 then grew `Game` by resetting state instead of shipping a migration, and this change follows 006.

Rollback of the program binary does not make old and new accounts readable by the other version. Do not deploy this layout onto a validator whose games must keep working without a reset.
