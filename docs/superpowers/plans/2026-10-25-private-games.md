# Private Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ticket:** [007 — Private games (password-protected)](../../tickets/007-private-games.md)
**Spec:** [openspec/changes/private-games/](../../../openspec/changes/private-games/)

**Goal:** Let a game admin create a password-protected game that stays visible in the browse list, require that password for every new join, and let the current admin replace the password without removing anyone already in the game.

**Architecture:** `Game` grows by three fields appended after `player_count` (`is_private`, `password_salt`, `password_hash`). The Next.js server hashes with the existing ticket 003 scrypt helper and sends only the salt and hash. `create_game` records them and still auto-joins the creator. A new `set_game_password` instruction replaces them when the caller is `Game.admin`. `join_game` is unchanged; the server calls `verifyPassword` before it will sign that instruction. Lists show Private or Public. A private row asks for the password; a public row still joins in one click.

**Tech Stack:** Rust/Anchor 1.x (on-chain program), TypeScript/Next.js App Router (Server Actions + existing pages), Codama-generated `on-chain-client`, Vitest, `anchor test` via Surfpool (on-chain-program-e2e), Playwright (e2e). Node `crypto.scrypt` via the existing `apps/frontend/src/server/password.ts` — no new dependency.

**Spec:** `openspec/changes/private-games/` (`proposal.md`, `design.md`, `specs/private-game/spec.md`, `specs/game/spec.md`, `specs/join-game/spec.md`) — read `design.md` in full before starting. It is the source for the account layout, the check order, the server order, and the UI.

## Global Constraints

- Implementation branch is `feat/007-private-games` per `.claude/rules/branch-name-rule.md`. Do not implement on the docs branch that added this plan.
- Password hashing is ticket 003's. Call `hashPassword` / `verifyPassword` / `validatePassword`. Do not add a crate, an npm package, or a second charset. Length 8–20. Charset `/^[A-Za-z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/`. A new salt on every hash. Compare only through `verifyPassword`.
- Append fields. Do not reorder `Game`. `INIT_SPACE` goes from 120 to 201. Account data length is 209 (`8 + 201`). Public means `is_private = false` and both arrays zero. Do not use `Option`.
- Do not realloc existing games and do not add a migration instruction. Reset local state with `just down-clean` before expecting old games to load. Same for devnet games created at 128 bytes.
- Visibility is fixed at creation. `set_game_password` does not write `is_private`. No "make public" / "make private" control after create.
- `join_game`'s signature and handler do not change. Do not pass the plaintext password into any instruction.
- Check order for `set_game_password`: `NotGameAdmin`, then `GameIsNotPrivate`, then `InvalidGamePassword`, then the write. Call `super::close_game::ensure_caller_is_admin`. Do not define another `pub fn ensure_caller_is_admin`.
- Append the two new errors at the end of `ErrorCode`. On `main` today the next codes are `6015` / `0x177F` and `6016` / `0x1780`. If ticket 010 has already appended `CannotTransferAdminToSelf`, append after that instead. Never insert in the middle.
- Trust model: the system wallet signs every transaction. "Only the current admin" means `getCurrentUsername()` resolves to the `User` PDA equal to `game.admin`. The caller username is never a request field.
- Join server order: not signed in, game not found, already a member, full (20), then the password check, then the existing send. No dummy scrypt on game-not-found. Public joins ignore a password argument.
- Auto-join at creation does not check the password and does not call `join_game`. An admin who is not a member is not exempt on a later join.
- A password change does not touch `player_count`, ATAs, balances, `Game.admin`, or the account length. No second confirmation, no old-password field, no toast.
- `BrowseGame`, `MemberGame`, and `GameDetail` gain `isPrivate` only. Do not put the salt or hash in client props.
- One shared system `admin: KeyPairSigner` per on-chain e2e test. See the DEVIATION comment in `apps/on-chain-program-e2e/tests/game/mint_to_player.test.ts`.
- Create form defaults to Public so `apps/e2e/tests/game-creation.spec.ts` and `game-joining.spec.ts` keep passing without new clicks.
- No CircleCI changes.
- TDD: failing test first. Rust unit tests cover only the pure helpers and `INIT_SPACE`. Account writes and `join_game`'s indifference to the password are `on-chain-program-e2e`.

---

## File Structure

New files:

- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/game_password.rs` — pure checks and their unit tests
- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/set_game_password.rs` — instruction and handler
- `apps/on-chain-program-e2e/tests/game/private_game.test.ts` — instruction round-trips
- `apps/e2e/tests/private-game.spec.ts` — Playwright flow

Modified files:

- `apps/on-chain-program/programs/game_token_wallet/src/state/game.rs` — three fields, `INIT_SPACE` test
- `apps/on-chain-program/programs/game_token_wallet/src/errors.rs` — two appended variants
- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs` — new args and the material check
- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs` — export the modules
- `apps/on-chain-program/programs/game_token_wallet/src/lib.rs` — argument list and `set_game_password`
- `apps/on-chain-client/src/generated/**` — codegen only, not hand-edited
- `apps/on-chain-client/src/index.test.ts`
- `apps/on-chain-program-e2e/tests/game/{create_game,join_game,mint_to_player,quit_game,close_game}.test.ts` and `apps/on-chain-program-e2e/tests/general_mode/transfer_token.test.ts` — public password args on create
- `apps/frontend/src/server/actions/game.ts` and `game.test.ts`
- `apps/frontend/src/app/(app)/games/new/page.tsx` and `page.test.tsx`
- `apps/frontend/src/app/(app)/games/all/BrowseGameRow.tsx` and `BrowseGameRow.test.tsx`
- `apps/frontend/src/app/(app)/page.tsx` and `page.test.tsx`
- `apps/frontend/src/app/(app)/games/[address]/page.tsx` and `page.test.tsx`
- `apps/frontend/src/app/(app)/games/[address]/AdminControlsModal.tsx` and `AdminControlsModal.test.tsx`

`join_game.rs` is not modified. The account page only shows a count; leave it.

---

### Task 1: `Game` layout and pure password checks

**Files:**

- Modify: `apps/on-chain-program/programs/game_token_wallet/src/state/game.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/game_password.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`

**Interfaces:**

- Produces: `Game.is_private`, `Game.password_salt`, `Game.password_hash`; `pub fn ensure_password_material(is_private: bool, salt: &[u8; 16], hash: &[u8; 64]) -> Result<()>`; `pub fn ensure_game_is_private(is_private: bool) -> Result<()>`.

- [ ] **Step 1: Write the failing `INIT_SPACE` assertion**

In `state/game.rs`, import the widths and change the expected size:

```rust
use super::user::{PASSWORD_HASH_BYTES, SALT_BYTES};
```

```rust
    #[test]
    fn game_init_space_accounts_for_all_fixed_and_bounded_fields() {
        // 1 (bump) + 1 (mint_bump) + GAME_ID_BYTES (game_id)
        // + (4 byte String length prefix + MAX_GAME_NAME_BYTES) (name)
        // + 1 (mode discriminant) + 32 (admin) + 32 (mint)
        // + 1 (player_count)
        // + 1 (is_private) + SALT_BYTES + PASSWORD_HASH_BYTES.
        let expected = 1 + 1 + GAME_ID_BYTES + (4 + MAX_GAME_NAME_BYTES) + 1 + 32 + 32 + 1
            + 1 + SALT_BYTES + PASSWORD_HASH_BYTES;
        assert_eq!(Game::INIT_SPACE, expected);
    }
```

The formula evaluates to 201. Today `INIT_SPACE` is 120.

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml game_init_space`
Expected: FAIL — `left: 120, right: 201`.

- [ ] **Step 2: Append the fields**

After `player_count` on `Game`:

```rust
    pub player_count: u8,
    pub is_private: bool,
    pub password_salt: [u8; SALT_BYTES],
    pub password_hash: [u8; PASSWORD_HASH_BYTES],
```

Run the same test. Expected: PASS.

- [ ] **Step 3: Write the failing helper tests**

Create `game_password.rs` with the two functions calling a missing `todo_unimplemented` (the red state, same shape as the ticket 010 plan), and this module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn nonzero(len: usize) -> Vec<u8> {
        vec![1u8; len]
    }

    #[test]
    fn private_with_salt_and_hash_is_ok() {
        let salt = nonzero(16).try_into().unwrap();
        let hash = nonzero(64).try_into().unwrap();
        assert!(ensure_password_material(true, &salt, &hash).is_ok());
    }

    #[test]
    fn private_rejects_a_zero_salt() {
        let hash = nonzero(64).try_into().unwrap();
        assert!(ensure_password_material(true, &[0u8; 16], &hash).is_err());
    }

    #[test]
    fn private_rejects_a_zero_hash() {
        let salt = nonzero(16).try_into().unwrap();
        assert!(ensure_password_material(true, &salt, &[0u8; 64]).is_err());
    }

    #[test]
    fn private_rejects_both_zero() {
        assert!(ensure_password_material(true, &[0u8; 16], &[0u8; 64]).is_err());
    }

    #[test]
    fn public_with_zeros_is_ok() {
        assert!(ensure_password_material(false, &[0u8; 16], &[0u8; 64]).is_ok());
    }

    #[test]
    fn public_rejects_a_nonzero_salt() {
        let salt = nonzero(16).try_into().unwrap();
        assert!(ensure_password_material(false, &salt, &[0u8; 64]).is_err());
    }

    #[test]
    fn public_rejects_a_nonzero_hash() {
        let hash = nonzero(64).try_into().unwrap();
        assert!(ensure_password_material(false, &[0u8; 16], &hash).is_err());
    }

    #[test]
    fn allows_a_private_game() {
        assert!(ensure_game_is_private(true).is_ok());
    }

    #[test]
    fn rejects_a_public_game() {
        assert!(ensure_game_is_private(false).is_err());
    }
}
```

Declare `pub mod game_password;` in `instructions/game/mod.rs`. Do not `pub use` a second `ensure_caller_is_admin`.

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml game_password`
Expected: FAIL to compile — `todo_unimplemented` is missing.

- [ ] **Step 4: Implement the helpers**

```rust
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

fn is_all_zero(bytes: &[u8]) -> bool {
    bytes.iter().all(|byte| *byte == 0)
}

pub fn ensure_password_material(is_private: bool, salt: &[u8; 16], hash: &[u8; 64]) -> Result<()> {
    let salt_zero = is_all_zero(salt);
    let hash_zero = is_all_zero(hash);
    if is_private {
        require!(!salt_zero && !hash_zero, ErrorCode::InvalidGamePassword);
    } else {
        require!(salt_zero && hash_zero, ErrorCode::InvalidGamePassword);
    }
    Ok(())
}

pub fn ensure_game_is_private(is_private: bool) -> Result<()> {
    require!(is_private, ErrorCode::GameIsNotPrivate);
    Ok(())
}
```

`InvalidGamePassword` and `GameIsNotPrivate` do not exist until Task 2. Either append the variants in this step so the test compiles, or land Task 2 Step 1 first. The variants must be appended, not inserted.

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml game_password game_init_space`
Expected: PASS.

---

### Task 2: `create_game` arguments and `set_game_password`

**Files:**

- Modify: `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/set_game_password.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`

**Interfaces:**

- Consumes: `ensure_password_material`, `ensure_game_is_private`, `close_game::ensure_caller_is_admin`.
- Produces: `create_game(..., is_private: bool, password_salt: [u8; 16], password_hash: [u8; 64])`; `set_game_password(ctx, game_id: [u8; 16], username: String, password_salt: [u8; 16], password_hash: [u8; 64])`.

- [ ] **Step 1: Append the errors**

After `GameNotInRegistry`:

```rust
    #[msg("Game was not found in the registry's active-games list")]
    GameNotInRegistry,
    #[msg("A private game's password salt and hash must each contain a non-zero byte, and a public game's must each be all zeros")]
    InvalidGamePassword,
    #[msg("Only a private game has a password")]
    GameIsNotPrivate,
}
```

If a variant already follows `GameNotInRegistry`, append after the last one. Do not renumber.

- [ ] **Step 2: Thread the arguments through `create_game`**

`lib.rs` and the handler gain the three parameters at the end. The accounts struct's `#[instruction(...)]` list gains them too, even though the seeds do not use them, so the list stays the full argument list.

Before writing `game.is_private`:

```rust
    ensure_password_material(is_private, &password_salt, &password_hash)?;

    let game = &mut ctx.accounts.game;
    // ... existing field writes, including player_count = 1 ...
    game.is_private = is_private;
    game.password_salt = password_salt;
    game.password_hash = password_hash;
```

Do not add a `join_game` CPI. The creator ATA and `player_count = 1` stay as they are.

- [ ] **Step 3: Add `set_game_password`**

```rust
use anchor_lang::prelude::*;

use super::close_game::ensure_caller_is_admin;
use super::game_password::{ensure_game_is_private, ensure_password_material};
use crate::state::{Game, User};

#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String)]
pub struct SetGamePassword<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    #[account(mut, seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,
}

pub fn handler(
    ctx: Context<SetGamePassword>,
    _game_id: [u8; 16],
    _username: String,
    password_salt: [u8; 16],
    password_hash: [u8; 64],
) -> Result<()> {
    ensure_caller_is_admin(ctx.accounts.user.key(), ctx.accounts.game.admin)?;
    ensure_game_is_private(ctx.accounts.game.is_private)?;
    ensure_password_material(true, &password_salt, &password_hash)?;

    ctx.accounts.game.password_salt = password_salt;
    ctx.accounts.game.password_hash = password_hash;
    Ok(())
}
```

Register `pub mod set_game_password;` and `pub use set_game_password::*;` in `mod.rs`, and the program function in `lib.rs` next to the other game instructions. No `system_program`. No token accounts.

- [ ] **Step 4: Run the program tests**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: PASS. `join_game.rs` has no diff.

---

### Task 3: Regenerate the Codama client and keep public creates compiling

**Files:**

- Modify: `apps/on-chain-client/src/generated/**`
- Modify: `apps/on-chain-client/src/index.test.ts`
- Modify: the six e2e call sites listed in File Structure

**Interfaces:**

- Produces: `getSetGamePasswordInstructionAsync`; `GAME_TOKEN_WALLET_ERROR__INVALID_GAME_PASSWORD`; `GAME_TOKEN_WALLET_ERROR__GAME_IS_NOT_PRIVATE`. `getCreateGameInstructionAsync` now requires `isPrivate`, `passwordSalt`, `passwordHash`.

- [ ] **Step 1: Extend the client export test so it fails**

Import the new builder and the two error constants. Assert the builder is a function and both constants are numbers. Assert `GAME_TOKEN_WALLET_ERROR__GAME_NOT_IN_REGISTRY` is still `0x177e` when the new variants were appended directly after it.

Run: `pnpm --filter on-chain-client run test`
Expected: FAIL — the exports are missing.

- [ ] **Step 2: Codegen**

From `apps/on-chain-program`: `anchor build`
Then: `pnpm --filter on-chain-client run codegen`

Expected: `src/generated/instructions/setGamePassword.ts` exists. Create-game data has `isPrivate`, `passwordSalt` (16), `passwordHash` (64) and no password string. On today's enum the new codes are `0x177f` and `0x1780`.

- [ ] **Step 3: Public args at existing create call sites**

```ts
isPrivate: false,
passwordSalt: new Uint8Array(16),
passwordHash: new Uint8Array(64),
```

Add those three fields to every `getCreateGameInstructionAsync({...})` in:

- `apps/on-chain-program-e2e/tests/game/create_game.test.ts`
- `apps/on-chain-program-e2e/tests/game/join_game.test.ts`
- `apps/on-chain-program-e2e/tests/game/mint_to_player.test.ts`
- `apps/on-chain-program-e2e/tests/game/quit_game.test.ts`
- `apps/on-chain-program-e2e/tests/game/close_game.test.ts`
- `apps/on-chain-program-e2e/tests/general_mode/transfer_token.test.ts`

In `create_game.test.ts`'s happy path, also expect `game.data.isPrivate` false, `passwordSalt` 16 zeros, `passwordHash` 64 zeros.

Run: `pnpm --filter on-chain-client run test && pnpm --filter on-chain-client run typecheck`
Expected: PASS. Frontend `createGame` still fails typecheck until Task 5; that is the next task, not a reason to hand-edit generated code.

---

### Task 4: On-chain e2e

**Files:**

- Create: `apps/on-chain-program-e2e/tests/game/private_game.test.ts`

**Interfaces:**

- Consumes: `getCreateGameInstructionAsync`, `getSetGamePasswordInstructionAsync`, `getJoinGameInstructionAsync`. Copy `fundedAdmin`, `buildAndSend`, `registeredAdmin`, and the shared-signer rule from `mint_to_player.test.ts`.

Use a distinct username suffix and `gameId` fill byte per test. Timeouts `30_000`.

- [ ] **Step 1: Write the cases**

1. **Private create.** Shared `admin`. Register `privhost1`. `create_game` with `isPrivate: true`, `passwordSalt` sixteen `7`s, `passwordHash` sixty-four `9`s, name `"Private Table"`. `fetchGame`: `isPrivate` true, salt and hash equal those bytes, `playerCount` 1, `admin` is `findUserPda({ username: "privhost1", admin: admin.address })`. Creator ATA exists and its amount is `0n`. Raw account data length is 209 (`rpc.getAccountInfo`). No second instruction was required to make the creator a player.

2. **Public create.** `isPrivate: false` and zero arrays. Flag false, both arrays zero, `playerCount` 1, length 209.

3. **Private create, zero hash.** `isPrivate: true`, non-zero salt, zero hash. Expect `GAME_TOKEN_WALLET_ERROR__INVALID_GAME_PASSWORD`. `fetchMaybeGame` on the derived address is `exists: false`.

4. **Public create, non-zero hash.** `isPrivate: false`, zero salt, non-zero hash. Same error, no account.

5. **Admin changes the password.** Private game, host plus `privplayer2` joined via `join_game` (no password argument — this is the program path). Record `playerCount` (2) and the player's token amount. `set_game_password` with `username: "privhost1"` and a different non-zero salt and hash. Account salt and hash are the new bytes, `isPrivate` still true, `admin` still the host, length still 209, `playerCount` still 2, player amount unchanged.

6. **Non-admin.** A third registered user who has joined submits `set_game_password` with their username. Expect `NOT_GAME_ADMIN`. Salt and hash unchanged. (Their target game is private, so this is not the public-game error.)

7. **Public game.** The admin calls `set_game_password` with a non-zero salt and hash. Expect `GAME_IS_NOT_PRIVATE`. Flag still false, arrays still zero.

8. **Zero replacement.** Admin of a private game submits a zero hash. Expect `INVALID_GAME_PASSWORD`. Previous salt and hash unchanged.

9. **Missing game.** `set_game_password` with a `gameId` never created. Transaction fails. `fetchMaybeGame` is `exists: false`.

10. **Direct join.** On a fresh private game (`playerCount` 1), `join_game` for a new user with no password argument succeeds. `playerCount` is 2 and their ATA amount is `0n`.

11. **Cap.** Fill a private game to 20 players using `join_game`, then one more `join_game`. Expect `GAME_FULL`. `playerCount` stays 20. This is the existing cap, not a password result.

A failure of `AccountNotInitialized` / custom error 3012 means a test used a second system keypair. Go back to the shared signer.

- [ ] **Step 2: Run the file**

Run from `apps/on-chain-program` (validator must be the repo's Surfpool, not a hand-rolled one):

`anchor test --skip-local-validator --provider.wallet ../../docker/local/fixtures/deployer-keypair.dev.json`

Filter to `private_game` if the runner supports it. Expected: PASS, all eleven cases.

---

### Task 5: Server Actions

**Files:**

- Modify: `apps/frontend/src/server/actions/game.ts`
- Modify: `apps/frontend/src/server/actions/game.test.ts`

**Interfaces:**

```ts
export interface CreateGameInput {
  name: string;
  isPrivate?: boolean;
  password?: string;
}

export async function joinGame(gameAddress: string, password?: string): Promise<JoinGameResult>;

export interface ChangeGamePasswordInput {
  gameAddress: string;
  password: string;
}

export async function changeGamePassword(
  input: ChangeGamePasswordInput,
): Promise<{ ok: true } | { ok: false; error: string }>;
```

`BrowseGame`, `MemberGame`, and `GameDetail` each gain `isPrivate: boolean` and nothing else from the password fields.

- [ ] **Step 1: Failing action tests**

Mock `@/server/password`:

```ts
vi.mock("../password", () => ({
  hashPassword: mockHashPassword,
  verifyPassword: mockVerifyPassword,
}));
```

`mockHashPassword` resolves `{ salt: FIXED_SALT, hash: FIXED_HASH }` with `FIXED_SALT` a 16-byte `Uint8Array` of `3`s and `FIXED_HASH` a 64-byte `Uint8Array` of `4`s. Add the two new error codes to the `on-chain-client` mock (`0x177f` and `0x1780` when appended after `GameNotInRegistry`). Extend `gameData()` with `isPrivate: false`, `passwordSalt: new Uint8Array(16)`, `passwordHash: new Uint8Array(64)` so existing fetches still typecheck.

Tests, written before the behavior exists:

`createGame`

- `{ name: "Friday Poker" }` still succeeds and the instruction receives `isPrivate: false`, 16 zero bytes, 64 zero bytes. `hashPassword` not called.
- `{ name, isPrivate: true, password: "Abcdef123!" }` succeeds, `hashPassword` called with that password, instruction receives `isPrivate: true` and the mocked salt and hash, and the instruction argument object has no `password` key.
- `{ name, isPrivate: true, password: "" }` → `"Password must be between 8 and 20 characters"`, `getSolanaContext` not called.
- `{ name, isPrivate: true, password: "Abcdef 12" }` → `"Password contains a disallowed character"`, no context call.
- `{ name, isPrivate: false, password: "Abcdef123!" }` succeeds as public and does not call `hashPassword`.
- not signed in, unchanged.

`joinGame`

- public game (`isPrivate: false`), no password: `verifyPassword` not called, join instruction sent (existing success test, plus this assert).
- private, room, non-member, `verifyPassword` false: `{ ok: false, error: "Incorrect password." }`, `getJoinGameInstructionAsync` not called, `signAndSendTransaction` not called.
- private, password `""`: the length message, `verifyPassword` not called.
- private, password `"Abcdef 12"`: the charset message, `verifyPassword` not called.
- `fetchMaybeGame` exists false, with a password: `"Game not found"`, `verifyPassword` not called.
- ATA exists: `"You are already a player in this game"`, `verifyPassword` not called, even if the game is private and a password was passed.
- `playerCount: 20`: the existing full-game message, `verifyPassword` not called.
- private, `verifyPassword` true: `{ ok: true }` and the join instruction sent.
- `game.data.admin` equals the session PDA, ATA absent, `isPrivate` true, no password: the length message (admin is not exempt).

`changeGamePassword`

- no session → `"Not signed in"`, no context call.
- password `""` and password `"short"` → validation reason, `hashPassword` not called.
- game missing → `"Game not found"`, no send.
- session PDA !== `game.data.admin` → `"Only the game's admin can change the password"`, no send.
- `isPrivate: false` while the caller is admin → `"Only a private game has a password"`, no send.
- success: `hashPassword` called with the new password; instruction called with `username` equal to the session username (the input type has no username field), `passwordSalt` / `passwordHash` the mock's new bytes, not `game.data.passwordSalt`.
- mapped program errors: `NotGameAdmin` → the admin message; `GameIsNotPrivate` → `"Only a private game has a password"`; `InvalidGamePassword` → `"That password could not be stored"`.

`listBrowseGames` / `listMyMemberGames` / `fetchGameDetail`: a fixture with `isPrivate: true` comes back as `isPrivate: true`, and the returned object has no `passwordSalt` or `passwordHash` key.

Run: `pnpm --filter frontend exec vitest run src/server/actions/game.test.ts -t "createGame|joinGame|changeGamePassword|listBrowseGames|listMyMemberGames|fetchGameDetail"`
Expected: FAIL — new behavior missing, and `createGame`'s instruction mock is not yet passed the new fields.

- [ ] **Step 2: Implement**

Follow `depositToPlayer` for the signed send and the `isGameTokenWalletError` catch. `createGame` treats `input.isPrivate !== true` as public. `joinGame`'s new parameter is optional and the existing single-argument call still typechecks.

Password check only after the not-found, already-member, and full pre-checks. `verifyPassword(password, game.data.passwordSalt, game.data.passwordHash)`.

`changeGamePassword` compares the session PDA to `game.data.admin` before building the instruction. Username in the builder is the session value.

List and detail mappers copy `game.data.isPrivate` and stop there.

- [ ] **Step 3: Run the action tests**

Run: `pnpm --filter frontend exec vitest run src/server/actions/game.test.ts`
Expected: PASS, including the pre-existing deposit, transfer, quit, and close tests.

---

### Task 6: UI

**Files:** the page, row, home, detail, and modal files in File Structure.

**Interfaces:**

- Create form calls `createGame({ name, isPrivate, password })` with `isPrivate: false` and no password when Public is selected.
- Private browse button label is `Enter password`. Prompt test id `join-password-form`. Empty-prompt error test id `join-password-error`.
- Visibility test id `game-visibility` on the browse row, the home row, and the detail header. Text is `Private` or `Public`.
- Modal shows Change password only when `isPrivate`. Error test id `change-password-error`.

- [ ] **Step 1: Failing component tests**

`games/new/page.test.tsx`

- The existing success test currently expects `createGame({ name: "Friday Poker" })`. Change it to `{ name: "Friday Poker", isPrivate: false }` and assert no password field is visible by default.
- Click Private: `data-testid="create-game-password"` is visible. Submit with empty password: action not called, length message shown.
- Submit private with `"Abcdef123!"`: `createGame({ name, isPrivate: true, password: "Abcdef123!" })`.
- Click Private, type a password, click Public, submit: `{ name, isPrivate: false }` and the action was not given a password.
- `"short"` while Private: action not called.

`BrowseGameRow.test.tsx` — add `isPrivate` to every fixture (`false` on the existing ones).

- Public non-member: button `Join`, click calls `joinGame("Game1")` with one argument.
- Private non-member: text `Private`, button `Enter password`. Click does not call `joinGame`. `join-password-form` is visible.
- Submit empty: `join-password-error` shows the length message, `joinGame` not called.
- Submit `"nope-but-valid1"`: `joinGame("Game1", "nope-but-valid1")`. When the mock returns `{ ok: false, error: "Incorrect password." }`, the row shows that text and `mockPush` is not called.
- When the mock returns `{ ok: true }`, push `/games/Game1`.
- Private member: button `Open`, no prompt, click does not call `joinGame`.

`page.test.tsx` (home): one private row contains `Private`, one public row contains `Public`. Add `isPrivate` to fixtures.

`games/[address]/page.test.tsx`: header shows `Private` or `Public`. A non-admin fixture does not render a button named `Admin controls`. An admin + `isPrivate: true` fixture does.

`AdminControlsModal.test.tsx`

- `isPrivate: false`: no control named `Change password`. Deposit form still there.
- `isPrivate: true`: the control is there. Empty submit does not call `changeGamePassword` and shows the length message in `change-password-error`.
- Valid password and `{ ok: true }`: `changeGamePassword({ gameAddress, password })`, `router.refresh()` called, the dialog closes.
- `{ ok: false, error: "Only the game's admin can change the password" }`: dialog stays open and shows that text.

Run each file's vitest before the implementation. Expected: FAIL.

- [ ] **Step 2: Implement**

Match design.md D6. Reuse `Button`, `Input`, `Alert`. The password inputs are `type="password"`. Public/Private are buttons, not a free-text field. Default `isPrivate` state is false.

`joinGame` from the public path stays a one-argument call so the existing test's arity assert holds.

Detail page passes `isPrivate={game.isPrivate}` into the modal and still renders the modal only when `game.isAdmin`.

- [ ] **Step 3: Run the component tests**

Run: `pnpm --filter frontend exec vitest run src/app/\(app\)/games/new/page.test.tsx src/app/\(app\)/games/all/BrowseGameRow.test.tsx src/app/\(app\)/page.test.tsx "src/app/(app)/games/[address]/page.test.tsx" "src/app/(app)/games/[address]/AdminControlsModal.test.tsx"`
Expected: PASS.

---

### Task 7: Playwright

**Files:**

- Create: `apps/e2e/tests/private-game.spec.ts`

- [ ] **Step 1: Write the flow**

Follow `game-joining.spec.ts`: `uniqueUsername`, `registerAndLogin` with login password `Abcdef123!`. Game password is `TablePass1!` and the replacement is `TablePass2!`. Both pass `validatePassword` and neither equals the login password.

1. Host registers, opens `/games/new`, fills the name `E2E Private Game`, clicks `Private`, fills the game password, clicks `Create game`. Lands on `/`. Home row contains the name, `Private`, and `Admin`.
2. Host opens browse. That row's button is `Open`, not `Enter password` (creator is already a member). Count `1/20`.
3. Second context, second user. Browse row contains `Private` and `Enter password`. Submit `WrongPass1!`. Row shows `Incorrect password.`. URL stays on `/games/all`. Count still `1/20`.
4. Submit `TablePass1!`. URL matches `/games/(?!all\b)`. Roster contains the joiner. Balance `0.00`.
5. Host opens the game, opens `Admin controls`, fills `TablePass2!`, clicks `Change password`. No second dialog. Still on the game page. Roster still contains the joiner.
6. Joiner reloads browse. Button is `Open`. Joiner opens the game. Roster still contains both. No password prompt.
7. Third context, third user. `TablePass1!` shows `Incorrect password.` and the count is `2/20`. `TablePass2!` joins. Count `3/20`. Roster contains the host, the first joiner, and the third user.
8. Third user's detail page does not show `Admin controls` or `Change password`.

Timeouts `30_000` on the URL expects, same as `game-joining.spec.ts`.

- [ ] **Step 2: Run it against the e2e stack**

The repo's gate is `just test`, which boots `docker-compose.e2e.yml`. While iterating, `just test-e2e` once that stack is up. Expected: PASS. `game-creation.spec.ts` and `game-joining.spec.ts` still pass without edits.

---

### Task 8: Gate

- [ ] **Step 1: Full suite**

Run: `just lint` and `just test`
Expected: PASS. Cargo log shows `game_password` tests. On-chain e2e log shows `private_game.test.ts`. Playwright log shows `private-game.spec.ts` executed, not skipped. Codegen output is committed and has no unrelated export changes.

- [ ] **Step 2: Do not migrate old accounts**

Confirm there is no `realloc` constraint and no migrate instruction. If a local validator still has 128-byte `Game` accounts, `just down-clean` and recreate them. That reset is the migration.

---

## Scenario coverage

| Spec scenario | Layer | Task |
|---|---|---|
| Successful public creation, zeros stored | on-chain e2e | 4.1, existing `create_game.test.ts` |
| Creator is a player with no `join_game`, public or private | on-chain e2e + Playwright | 4.1, 7.1 |
| New account is 209 bytes | on-chain e2e | 4.1 |
| Private create stores the exact salt and hash | on-chain e2e + server (mocked hash bytes) | 4.1, 5.2 |
| Public create with a non-zero hash writes nothing | on-chain e2e | 4.2 |
| Private create with a zero hash writes nothing | on-chain e2e | 4.2 |
| Empty / charset / length rejected on create | server + component | 5.2, 6.2 |
| Plaintext is not a create argument | server + codegen | 5.2, 3.2 |
| Correct password joins | server + component + Playwright | 5.2, 6.2, 7.1 |
| Member opens without a password | component + Playwright | 6.2, 7.1 |
| Admin with no ATA still needs a password | server | 5.2 |
| Wrong password, no tx, count unchanged | server + Playwright | 5.2, 7.1 |
| Empty join password, no `verifyPassword` | server + component | 5.2, 6.2 |
| Illegal join password, no `verifyPassword` | server | 5.2 |
| Unknown game, no `verifyPassword` | server | 5.2 |
| 20-player private game rejects, no `verifyPassword` | server + on-chain `GameFull` | 5.2, 4.3 |
| Already a player, no `verifyPassword` | server | 5.2 |
| Admin replaces salt and hash | on-chain e2e + server + Playwright | 4.2, 5.2, 7.1 |
| Non-admin `NotGameAdmin`, bytes unchanged | on-chain e2e + server | 4.2, 5.2 |
| Signed-out change, no tx | server | 5.2 |
| Caller username is the session, input has no username | server | 5.2 |
| Unknown game change, no tx | server | 5.2 |
| Missing game on-chain writes nothing | on-chain e2e | 4.2 |
| Empty or illegal new password, no `hashPassword` | server + component | 5.2, 6.2 |
| All-zero replacement `InvalidGamePassword` | on-chain e2e + server mapping | 4.2, 5.2 |
| Existing member stays, balance and count unchanged | on-chain e2e + Playwright | 4.2, 7.1 |
| Old password stops, new password works | Playwright | 7.1 |
| No second confirmation, no old password | component + Playwright | 6.2, 7.1 |
| Account length unchanged by the change | on-chain e2e | 4.2 |
| Public game rejects a later password | server + on-chain `GameIsNotPrivate` | 5.2, 4.2 |
| Stray password on a public create is ignored | server | 5.2 |
| Toggling back to Public drops the password | component | 6.2 |
| Direct `join_game` does not consult the password | on-chain e2e | 4.3 |
| Server does not call the join builder on a bad password | server | 5.2 |
| Browse / home / detail visibility labels | component + Playwright | 6.2, 7.1 |
| Hash is not rendered | component (no salt/hash key, no hash text) | 5.2, 6.2 |
| Prompt, cancel, empty prompt, public one-click | component | 6.2 |
| Wrong password stays on browse | component + Playwright | 6.2, 7.1 |
| Change form only for a private game's admin | component | 6.2 |
| Non-admin does not see Admin controls | component + Playwright | 6.2, 7.1 |
| Success refreshes in place; error keeps the modal open | component | 6.2 |
| Public join still has no password (regression) | existing on-chain e2e + existing Playwright | 3.3, 7.1 |
| New error codes, predecessor unchanged | client unit | 3.1 |
