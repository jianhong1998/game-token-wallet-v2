# Game Admin Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ticket:** [010 — Game admin transfer](../../tickets/010-game-admin-transfer.md)
**Spec:** [openspec/changes/game-admin-transfer/](../../../openspec/changes/game-admin-transfer/)

**Goal:** Let the current game admin hand the admin role to another player already in that game, so the former admin can afterwards quit through the existing quit flow.

**Architecture:** A new `transfer_game_admin` Anchor instruction overwrites `Game.admin` with the target player's `User` PDA and writes nothing else. Accounts and field names mirror `MintToPlayer` (`admin`, `user`, `player_user`, `game`, `player_ata`) minus `mint` and `token_program`, because there is no token CPI — `Game.mint` is enough to derive the target ATA. The system wallet signs and pays, exactly as it does for deposits; the caller is the session username, checked on-chain against `game.admin`. The frontend adds `transferGameAdmin` and a "Transfer admin role" form inside the existing Admin controls modal.

**Tech Stack:** Rust/Anchor 1.x (on-chain program), TypeScript/Next.js App Router (Server Actions + the existing client modal), Codama-generated `on-chain-client`, Vitest (unit tests), `anchor test` via Surfpool (on-chain-program-e2e), Playwright (e2e).

**Spec:** `openspec/changes/game-admin-transfer/` (`proposal.md`, `design.md`, `specs/game-admin-transfer/spec.md`, `specs/game/spec.md`) — read `design.md` in full before starting. It is the source for the account table, the error-check order, and the UI decisions below.

## Global Constraints

- `Game.admin` is already a `Pubkey` (`state/game.rs`). Overwrite it. Do not realloc, do not add a field, do not touch `player_count`, balances, the mint, or the registry.
- Account field names are `admin`, `user`, `player_user`, `game`, `player_ata`. Codama canonicalizes identically seeded PDAs by field name; `user` and `player_user` must keep those names so the client keeps `findUserPda` and `findPlayerUserPda`. Do not add `mint` or `token_program` to this instruction.
- `player_ata` is an `UncheckedAccount` and is not `mut`. An initialized ATA is the membership proof. Wrong address → existing `InvalidPlayerAta`. Empty account → existing `PlayerNotInGame`. Missing user PDA fails Anchor account resolution (the target must be a registered user).
- Check order in the handler: `NotGameAdmin`, then `CannotTransferAdminToSelf`, then `InvalidPlayerAta`, then `PlayerNotInGame`, then the write. A non-admin who names themselves gets `NotGameAdmin`. The dedicated self error is only for the current admin naming their own `User` PDA. Self-transfer is a failure, not a no-op.
- Append `CannotTransferAdminToSelf` at the end of `ErrorCode`. Anchor codes are `6000 + enum index`. The last existing variant is `GameNotInRegistry` (index 14, `6014` / `0x177E`). The new one is index 15, `6015` / `0x177F`. Inserting it earlier renumbers `GameNotEmpty` and `GameNotInRegistry`.
- Trust model: the system wallet signs every transaction. "Only the current admin" means `getCurrentUsername()` resolves to the `User` PDA equal to `game.admin`, the same way `depositToPlayer` does. The caller username is never a request field. The target username is.
- The new admin does not accept. There is no second confirmation modal and no toast. Success closes the Admin controls modal and calls `router.refresh()`.
- One shared system `admin: KeyPairSigner` per on-chain e2e test, for the host and every other user. `transfer_game_admin` derives both `user` and `player_user` from that signer, same as `mint_to_player`. A per-user random keypair fails with `AccountNotInitialized` (custom program error 3012) before the handler runs. See the DEVIATION comment in `apps/on-chain-program-e2e/tests/game/mint_to_player.test.ts`.
- No CircleCI changes.
- Out of scope: kick player (`docs/business-related/003-roadmap.md`) and private-game passwords (ticket 007).
- TDD: failing test first, then the code that makes it pass. Rust unit tests are inline `#[cfg(test)]` and cover only the pure helpers. ATA checks, the write, and the quit/mint/close follow-on are `on-chain-program-e2e`.

---

## File Structure

New files:
- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/transfer_game_admin.rs` — instruction, helpers, unit tests
- `apps/on-chain-program-e2e/tests/game/transfer_game_admin.test.ts` — instruction round-trips
- `apps/e2e/tests/general-mode/transfer-admin.spec.ts` — Playwright flow

Modified files:
- `apps/on-chain-program/programs/game_token_wallet/src/errors.rs` — append `CannotTransferAdminToSelf`
- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs` — export the module
- `apps/on-chain-program/programs/game_token_wallet/src/lib.rs` — register `transfer_game_admin`
- `apps/on-chain-client/src/generated/**` — codegen output, not hand-edited
- `apps/on-chain-client/src/index.test.ts` — assert the new builder and error
- `apps/frontend/src/server/actions/game.ts` — `transferGameAdmin`
- `apps/frontend/src/server/actions/game.test.ts` — action tests and the new mock
- `apps/frontend/src/app/(app)/games/[address]/AdminControlsModal.tsx` — transfer form
- `apps/frontend/src/app/(app)/games/[address]/AdminControlsModal.test.tsx` — form tests

`page.tsx` already renders `AdminControlsModal` only when `game.isAdmin`, and `QuitGameButton` / `CloseGameButton` from the same flag. Do not add a second entry point.

---

### Task 1: On-chain `transfer_game_admin` instruction

**Files:**
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/transfer_game_admin.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`
- Test: inline `#[cfg(test)] mod tests` in `transfer_game_admin.rs`

**Interfaces:**
- Consumes: `Game.admin: Pubkey`, `Game.mint: Pubkey`, `Game.bump` (`state/game.rs`); `User`; `ErrorCode::{NotGameAdmin, InvalidPlayerAta, PlayerNotInGame}`.
- Produces: `transfer_game_admin(ctx, game_id: [u8; 16], username: String, player_username: String) -> Result<()>`; `ErrorCode::CannotTransferAdminToSelf`; `pub fn ensure_caller_is_admin(user: Pubkey, game_admin: Pubkey) -> Result<()>`; `pub fn ensure_not_self_admin(user: Pubkey, player_user: Pubkey) -> Result<()>`.

- [ ] **Step 1: Append the error variant**

At the end of `ErrorCode` in `errors.rs`, after `GameNotInRegistry`:

```rust
    #[msg("Game was not found in the registry's active-games list")]
    GameNotInRegistry,
    #[msg("Cannot transfer the admin role to yourself")]
    CannotTransferAdminToSelf,
}
```

Do not insert it above any existing variant.

- [ ] **Step 2: Write the failing helper tests**

Create `transfer_game_admin.rs`:

```rust
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

pub fn ensure_caller_is_admin(user: Pubkey, game_admin: Pubkey) -> Result<()> {
    todo_unimplemented(user, game_admin)
}

pub fn ensure_not_self_admin(user: Pubkey, player_user: Pubkey) -> Result<()> {
    todo_unimplemented(user, player_user)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_games_admin() {
        let admin_user = Pubkey::new_unique();
        assert!(ensure_caller_is_admin(admin_user, admin_user).is_ok());
    }

    #[test]
    fn rejects_a_non_admin_caller() {
        assert!(ensure_caller_is_admin(Pubkey::new_unique(), Pubkey::new_unique()).is_err());
    }

    #[test]
    fn allows_transfer_to_a_different_player() {
        assert!(ensure_not_self_admin(Pubkey::new_unique(), Pubkey::new_unique()).is_ok());
    }

    #[test]
    fn rejects_transfer_to_self() {
        let admin_user = Pubkey::new_unique();
        assert!(ensure_not_self_admin(admin_user, admin_user).is_err());
    }
}
```

The `todo_unimplemented` calls are the red state. Wire the module so `cargo test` compiles it. In `instructions/game/mod.rs`:

```rust
pub mod close_game;
pub mod close_game_player;
pub mod create_game;
pub mod join_game;
pub mod mint_to_player;
pub mod quit_game;
pub mod transfer_game_admin;

pub use close_game::*;
pub use close_game_player::*;
pub use create_game::*;
pub use join_game::*;
pub use mint_to_player::*;
pub use quit_game::*;
pub use transfer_game_admin::*;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml transfer_game_admin`
Expected: FAIL to compile — `cannot find function 'todo_unimplemented'`.

- [ ] **Step 4: Implement the two helpers**

```rust
pub fn ensure_caller_is_admin(user: Pubkey, game_admin: Pubkey) -> Result<()> {
    require_keys_eq!(user, game_admin, ErrorCode::NotGameAdmin);
    Ok(())
}

pub fn ensure_not_self_admin(user: Pubkey, player_user: Pubkey) -> Result<()> {
    require_keys_neq!(user, player_user, ErrorCode::CannotTransferAdminToSelf);
    Ok(())
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml transfer_game_admin`
Expected: PASS — all four tests.

- [ ] **Step 6: Implement the accounts struct and handler**

Replace the top of `transfer_game_admin.rs` (keep the `#[cfg(test)]` module) with:

```rust
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;

use crate::errors::ErrorCode;
use crate::state::{Game, User};

// Field names match `MintToPlayer` (`admin`, `user`, `player_user`, `game`,
// `player_ata`). Identical PDA seeds need identical field names so Codama
// keeps a single finder per account (`findUserPda`, `findPlayerUserPda`).
// `mint` and `token_program` are omitted: this instruction performs no token
// CPI, and `game.mint` is enough to derive the target ATA (design.md D2).
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String, player_username: String)]
pub struct TransferGameAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    #[account(
        seeds = [b"user", player_username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub player_user: Account<'info, User>,

    #[account(mut, seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    /// CHECK: the new admin's associated token account for `game.mint`.
    /// The handler checks the address against the ATA derivation and requires
    /// the account to already be initialized. `UncheckedAccount` so a missing
    /// ATA reports `PlayerNotInGame` instead of an Anchor deserialization
    /// error. Not `mut`: this instruction never writes token state.
    pub player_ata: UncheckedAccount<'info>,
}

pub fn ensure_caller_is_admin(user: Pubkey, game_admin: Pubkey) -> Result<()> {
    require_keys_eq!(user, game_admin, ErrorCode::NotGameAdmin);
    Ok(())
}

pub fn ensure_not_self_admin(user: Pubkey, player_user: Pubkey) -> Result<()> {
    require_keys_neq!(user, player_user, ErrorCode::CannotTransferAdminToSelf);
    Ok(())
}

pub fn handler(
    ctx: Context<TransferGameAdmin>,
    _game_id: [u8; 16],
    _username: String,
    _player_username: String,
) -> Result<()> {
    ensure_caller_is_admin(ctx.accounts.user.key(), ctx.accounts.game.admin)?;
    ensure_not_self_admin(ctx.accounts.user.key(), ctx.accounts.player_user.key())?;

    let expected_ata = get_associated_token_address(
        &ctx.accounts.player_user.key(),
        &ctx.accounts.game.mint,
    );
    require_keys_eq!(
        ctx.accounts.player_ata.key(),
        expected_ata,
        ErrorCode::InvalidPlayerAta
    );
    require!(
        !ctx.accounts.player_ata.data_is_empty(),
        ErrorCode::PlayerNotInGame
    );

    ctx.accounts.game.admin = ctx.accounts.player_user.key();
    Ok(())
}
```

Register it in `lib.rs` next to the other game instructions:

```rust
    pub fn transfer_game_admin(
        ctx: Context<TransferGameAdmin>,
        game_id: [u8; 16],
        username: String,
        player_username: String,
    ) -> Result<()> {
        instructions::game::transfer_game_admin::handler(
            ctx,
            game_id,
            username,
            player_username,
        )
    }
```

- [ ] **Step 7: Run the program tests**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: PASS, including the four new tests. `Game::INIT_SPACE` test still passes (no layout change).

---

### Task 2: Regenerate the Codama client

**Files:**
- Modify: `apps/on-chain-client/src/generated/**` (codegen only)
- Modify: `apps/on-chain-client/src/index.test.ts`

**Interfaces:**
- Produces: `getTransferGameAdminInstructionAsync`, `GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF` (`0x177f`). Does not add a new user PDA finder.

- [ ] **Step 1: Extend the client export test before codegen so it fails**

In `apps/on-chain-client/src/index.test.ts`, import `getTransferGameAdminInstructionAsync` and `GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF` and add:

```ts
  it("exports a transfer_game_admin instruction builder and its error helper", () => {
    expect(typeof getTransferGameAdminInstructionAsync).toBe("function");
    expect(typeof GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF).toBe("number");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter on-chain-client run test`
Expected: FAIL — the new exports are not defined.

- [ ] **Step 3: Rebuild the IDL and regenerate**

Run, from `apps/on-chain-program`: `anchor build`
Then: `pnpm --filter on-chain-client run codegen`

Expected: `src/generated/instructions/transferGameAdmin.ts` exists. `findUserPda` / `findPlayerUserPda` are still the only user finders (no third finder for a renamed account). `GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF` equals `0x177f`, and `GAME_TOKEN_WALLET_ERROR__GAME_NOT_IN_REGISTRY` is still `0x177e`.

- [ ] **Step 4: Run the client tests and typecheck**

Run: `pnpm --filter on-chain-client run test && pnpm --filter on-chain-client run typecheck`
Expected: PASS.

---

### Task 3: On-chain e2e round-trip

**Files:**
- Create: `apps/on-chain-program-e2e/tests/game/transfer_game_admin.test.ts`
- Test: `cd apps/on-chain-program && anchor test --skip-local-validator --provider.wallet ../../docker/local/fixtures/deployer-keypair.dev.json` (or the repo's `just test-e2e-program` once the local validator is up). While iterating, filter to this file if the runner supports it; the full program e2e is the gate in Task 7.

**Interfaces:**
- Consumes: `getTransferGameAdminInstructionAsync({ admin, username, gameId, playerUsername, playerAta })`, plus the existing create/join/mint/quit/close builders. Copy `fundedAdmin`, `buildAndSend`, `registeredAdmin`, `gameId`, `createdGame`, and `joinedPlayer` from `mint_to_player.test.ts`, including that file's shared-signer rule. Do not give each username its own keypair.

Every rejection test asserts the game's `admin` pubkey is unchanged after the failed transaction. Happy-path tests also assert both ATAs' amounts and `playerCount`.

- [ ] **Step 1: Write the file with these cases**

1. **Happy path.** Shared `admin`. Host `xferhost1` creates the game (auto-joined, `playerCount === 1`). Player `xferplayer1` joins (`playerCount === 2`). Mint `500` to the player and `200` to the host (`playerUsername` = host, host ATA derived the same way). Record both amounts and `playerCount`. `transfer_game_admin` with `username: "xferhost1"`, `playerUsername: "xferplayer1"`, and the player's ATA. Then `fetchGame`: `data.admin` equals `findUserPda({ username: "xferplayer1", admin: admin.address })`, `playerCount` is still 2, both token amounts are still `500n` and `200n`.

2. **Zero-balance target.** Same setup with fresh usernames and a fresh `gameId` fill byte, no mint. Transfer succeeds. Target ATA amount is still `0n`. `playerCount` is still 2.

3. **Non-admin caller.** Host, player, and a third registered user `xferother3` who did join (so their own ATA exists and this is not the non-member case). Build `transfer_game_admin` with `username: "xferother3"` and `playerUsername` set to the host or the player — not `xferother3`. Expect `GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN` via `isGameTokenWalletError(unwrapSimulationError(error), transactionMessage, code)`, the same catch shape as `mint_to_player.test.ts`. `game.admin` is still the host.

4. **Non-member.** Register `xfernomember4` under the shared signer and do not join them. Derive their ATA; it is uninitialized. Admin transfers to that username. Expect `GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME`. `game.admin` unchanged.

5. **Wrong ATA address.** Admin names the joined player but passes the host's ATA (a real token account that is not the player's derivation). Expect `GAME_TOKEN_WALLET_ERROR__INVALID_PLAYER_ATA`. `game.admin` unchanged.

6. **Self-transfer.** Admin names their own username as `playerUsername` and passes the host ATA. Expect `GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF`. `game.admin`, both balances, and `playerCount` unchanged. This must not be reported as success.

7. **Missing game.** `transfer_game_admin` with a `gameId` that was never created, and otherwise-valid user accounts. The transaction fails. `fetchMaybeGame` on the derived game address reports `exists: false` (nothing was created). A closed game hits this same on-chain condition, because `close_game` deletes the `Game` PDA; the Server Action's "Game not found" test covers that path before a transaction is sent.

8. **Quit split, after a successful transfer.** Former host calls `getQuitGameInstructionAsync` with their own ATA. It succeeds: their ATA is gone and `playerCount` is 1. New admin calls `quit_game` with their own ATA. Expect `GAME_TOKEN_WALLET_ERROR__ADMIN_CANNOT_QUIT_GAME`. Their ATA and balance still exist, and `playerCount` stays 1.

9. **Mint power follows the role.** After a transfer (do this in a test that has not quit), former host `mint_to_player` expects `NOT_GAME_ADMIN` and the target balance is unchanged. New admin `mint_to_player` of `100n` to the former host succeeds and that balance increases by `100n`.

10. **Close authorization follows the role.** After a transfer, on a game that still has players, former host `close_game` expects `NOT_GAME_ADMIN`. New admin `close_game` expects `GAME_NOT_EMPTY` (they passed the admin check; the empty-game precondition is what rejected them). The `Game` account still exists in both cases.

Use a distinct username suffix and `gameId` fill byte per test so accounts do not collide inside one validator run. Timeouts: `30_000`, matching `mint_to_player.test.ts`.

- [ ] **Step 2: Run the on-chain e2e file and verify all ten cases pass**

Expected: PASS. A failure of `AccountNotInitialized` / custom error 3012 means a test minted a second system keypair — go back to the shared-signer rule before changing the instruction.

---

### Task 4: `transferGameAdmin` Server Action

**Files:**
- Modify: `apps/frontend/src/server/actions/game.ts`
- Modify: `apps/frontend/src/server/actions/game.test.ts`
- Test: `pnpm --filter frontend exec vitest run src/server/actions/game.test.ts`

**Interfaces:**
- Produces:

```ts
export interface TransferGameAdminInput {
  gameAddress: string;
  playerUsername: string;
}

export type TransferGameAdminResult = { ok: true } | { ok: false; error: string };

export async function transferGameAdmin(
  input: TransferGameAdminInput,
): Promise<TransferGameAdminResult>;
```

- [ ] **Step 1: Add the mock and the failing tests**

In `game.test.ts`, add `mockGetTransferGameAdminInstructionAsync` and `CANNOT_TRANSFER_ADMIN_TO_SELF_CODE: 0x177f` next to the existing hoisted codes, and export them from the `vi.mock("on-chain-client")` factory as `getTransferGameAdminInstructionAsync` and `GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF`. Import `transferGameAdmin` beside `depositToPlayer`.

Add a `describe("transferGameAdmin")` whose `beforeEach` copies `depositToPlayer`'s: signed-in username `"hostadmin"`, solana context, `fetchMaybeGame` exists with `gameData()`, `findUserPda` → `USER_ADDRESS`, `findAssociatedTokenPda` → the existing player ATA constant, instruction mock resolves, `signAndSendTransaction` resolves, `isGameTokenWalletError` returns false.

Tests, written before the function exists (red: `transferGameAdmin is not a function`):

- not signed in → `{ ok: false, error: "Not signed in" }`, and `getSolanaContext` is not called
- `playerUsername: ""` → `{ ok: false, error: "Select a player" }`, no context call
- `playerUsername` equal to the session username → `{ ok: false, error: "Cannot transfer the admin role to yourself" }`, no context call
- `fetchMaybeGame` exists false → `{ ok: false, error: "Game not found" }`, `signAndSendTransaction` not called
- success → `{ ok: true }`, and `getTransferGameAdminInstructionAsync` was called with `{ admin: { address: ADMIN_ADDRESS }, username: "hostadmin", gameId: expect.anything(), playerUsername: "bob", playerAta: PLAYER_ATA_ADDRESS }` and `{ programAddress: PROGRAM_ADDRESS }`. The username in that payload is the session value, not a field on the input.
- `isGameTokenWalletError` true for `NOT_GAME_ADMIN_CODE` → `"Only the game's admin can transfer the admin role"`
- same for `PLAYER_NOT_IN_GAME_CODE` → `"That player hasn't joined this game"`
- same for `CANNOT_TRANSFER_ADMIN_TO_SELF_CODE` → `"Cannot transfer the admin role to yourself"`
- same for `INVALID_PLAYER_ATA` (`0x1776`, the existing constant) → `"That player's token account is invalid"`

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend exec vitest run src/server/actions/game.test.ts -t transferGameAdmin`
Expected: FAIL — `transferGameAdmin` is not exported.

- [ ] **Step 3: Implement the action**

Follow `depositToPlayer`'s shape in the same file. Import `getTransferGameAdminInstructionAsync` and `GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF` from `on-chain-client`. There is no amount, so none of the base-unit guards apply.

```ts
export async function transferGameAdmin(
  input: TransferGameAdminInput,
): Promise<TransferGameAdminResult> {
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in" };
  }
  if (!input.playerUsername) {
    return { ok: false, error: "Select a player" };
  }
  if (input.playerUsername === username) {
    return { ok: false, error: "Cannot transfer the admin role to yourself" };
  }

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();
  const game = await fetchMaybeGame(rpc, input.gameAddress as Address);
  if (!game.exists) {
    return { ok: false, error: "Game not found" };
  }

  const [playerUserAddress] = await findUserPda(
    { username: input.playerUsername, admin: adminSigner.address },
    { programAddress },
  );
  const [playerAta] = await findAssociatedTokenPda({
    owner: playerUserAddress,
    mint: game.data.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const transferInstruction = await getTransferGameAdminInstructionAsync(
    {
      admin: adminSigner,
      username,
      gameId: game.data.gameId,
      playerUsername: input.playerUsername,
      playerAta,
    },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
  );
  try {
    await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });
  } catch (error) {
    const cause = unwrapSimulationError(error);
    if (
      isGameTokenWalletError(cause, transactionMessage, GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN)
    ) {
      return { ok: false, error: "Only the game's admin can transfer the admin role" };
    }
    if (
      isGameTokenWalletError(
        cause,
        transactionMessage,
        GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
      )
    ) {
      return { ok: false, error: "That player hasn't joined this game" };
    }
    if (
      isGameTokenWalletError(
        cause,
        transactionMessage,
        GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF,
      )
    ) {
      return { ok: false, error: "Cannot transfer the admin role to yourself" };
    }
    if (
      isGameTokenWalletError(
        cause,
        transactionMessage,
        GAME_TOKEN_WALLET_ERROR__INVALID_PLAYER_ATA,
      )
    ) {
      return { ok: false, error: "That player's token account is invalid" };
    }
    throw error;
  }

  return { ok: true };
}
```

Confirm the generated builder's input field names against `transferGameAdmin.ts` after Task 2. `depositToPlayer` passes `playerUsername` and `playerAta` in camelCase; match whatever codegen actually emitted, and update the success-test expectation to that shape if it differs. Do not rename the on-chain accounts to chase a friendlier TS name.

- [ ] **Step 4: Run the action tests**

Run: `pnpm --filter frontend exec vitest run src/server/actions/game.test.ts`
Expected: PASS, including the existing `depositToPlayer` / `quitGame` / `closeGame` describes.

---

### Task 5: Transfer form in Admin controls

**Files:**
- Modify: `apps/frontend/src/app/(app)/games/[address]/AdminControlsModal.tsx`
- Modify: `apps/frontend/src/app/(app)/games/[address]/AdminControlsModal.test.tsx`
- Test: `pnpm --filter frontend exec vitest run src/app/\(app\)/games/\[address\]/AdminControlsModal.test.tsx`

**Interfaces:**
- Consumes: `transferGameAdmin` from `@/server/actions/game`, the `players: GamePlayer[]` prop (`isAdmin` is already set).
- Produces: a second form inside the open modal. No new page and no change to `page.tsx`.

- [ ] **Step 1: Write the failing component tests**

The deposit `<select>` and the new `<select>` will both render options. Update the existing "opens the modal..." test so `getByRole("option", { name: "bob" })` does not throw once bob appears twice: scope option assertions with `within(screen.getByLabelText("Player"))` for the deposit list. Alice stays on the deposit list only.

New tests, with `transferGameAdmin` added to the existing `vi.mock("@/server/actions/game")`:

- Opening the modal shows a "New admin" combobox. Its options are bob and not alice (`PLAYERS` marks alice `isAdmin: true`).
- A player list of only alice (the admin) leaves the "New admin" combobox with no player option.
- Submitting Transfer with no selection shows `data-testid="transfer-admin-error"` "Select a player" and does not call `transferGameAdmin`.
- Selecting bob and submitting calls `transferGameAdmin({ gameAddress: "Game1", playerUsername: "bob" })`. On `{ ok: true }`, the modal closes (`queryByLabelText("New admin")` is null) and `router.refresh` was called once.
- On `{ ok: false, error: "Only the game's admin can transfer the admin role" }`, the transfer error slot shows that text and the modal stays open.
- There is no confirm step: one click on Transfer is the submit. Assert `transferGameAdmin` was called once, and that no dialog titled like "Transfer this role?" appears.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend exec vitest run src/app/\(app\)/games/\[address\]/AdminControlsModal.test.tsx`
Expected: FAIL — no "New admin" label.

- [ ] **Step 3: Add the form**

In `AdminControlsModal.tsx`:

- Import `transferGameAdmin` beside `depositToPlayer`.
- State: `transferUsername`, `transferError`. Use a second `useTransition` (`isTransferPending`) so a deposit submit does not drive the Transfer button's loading flag.
- `closeModal` also clears `transferUsername` and `transferError`.
- `otherPlayers = players.filter((player) => !player.isAdmin)`.
- Render this form after the deposit `</form>`, still inside the modal card. Label text is "Transfer admin role". The control's accessible name is "New admin", not "Player" (that name belongs to the deposit select). The button label is "Transfer", `variant="destructive"`. Do not add a confirmation modal. Do not add a toast.

```tsx
<form onSubmit={handleTransfer} className="mt-6 flex flex-col gap-3">
  <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
    Transfer admin role
  </p>
  <div className="flex items-end gap-2">
    <div className="flex-1">
      <label
        htmlFor="transfer-admin-player"
        className="mb-1.5 block text-[11px] font-bold text-text-primary"
      >
        New admin
      </label>
      <select
        id="transfer-admin-player"
        value={transferUsername}
        onChange={(event) => setTransferUsername(event.target.value)}
        className="glass-input h-11 w-full px-4 text-sm text-text-primary"
      >
        <option value="">Select player…</option>
        {otherPlayers.map((player) => (
          <option key={player.username} value={player.username}>
            {player.username}
          </option>
        ))}
      </select>
    </div>
    <Button type="submit" variant="destructive" isLoading={isTransferPending}>
      Transfer
    </Button>
  </div>
  {transferError && (
    <Alert data-testid="transfer-admin-error" variant="error">
      {transferError}
    </Alert>
  )}
</form>
```

`handleTransfer` mirrors `handleSubmit`: prevent default, clear `transferError`, reject an empty `transferUsername` with "Select a player", then `startTransferTransition` calling `transferGameAdmin({ gameAddress, playerUsername: transferUsername })`. Success: `closeModal()` and `router.refresh()`. Failure: `setTransferError(result.error)`. A thrown error uses the same "Something went wrong. Please try again." fallback as deposit.

- [ ] **Step 4: Run the component tests**

Run: `pnpm --filter frontend exec vitest run src/app/\(app\)/games/\[address\]/AdminControlsModal.test.tsx`
Expected: PASS, including the existing deposit tests.

---

### Task 6: Playwright flow

**Files:**
- Create: `apps/e2e/tests/general-mode/transfer-admin.spec.ts`
- Test: `pnpm --filter e2e run test -- tests/general-mode/transfer-admin.spec.ts` against the e2e stack (`docker-compose.e2e.yml` / the suite's existing web server). The full `just test` run is Task 7.

**Interfaces:**
- Consumes the running app. Copy `uniqueUsername` and `registerAndLogin` from `apps/e2e/tests/general-mode/quit-game.spec.ts`. Use `Date.now()` in the game name. The e2e stack persists chain state, so fixed names collide with earlier runs.

- [ ] **Step 1: Write the spec**

One test, two browser contexts. `test.setTimeout(120_000)` and assertion timeouts of `60_000` on the on-chain steps — this flow is longer than quit-game (register ×2, create, join, deposit, transfer, deposit again, quit).

1. Host registers, creates `E2E Transfer Admin ${Date.now()}`, lands on home.
2. Second context: player registers, joins from `/games/all`.
3. Host opens the game from home. Players list contains the player. Host opens Admin controls, deposits `5.00` to the player, and the player's row shows `5.00`.
4. Still in Admin controls, the "New admin" select's options include the player and do not include the host. Choose the player. Click Transfer. There is no second dialog.
5. After refresh, on the host's page: no `game-admin-badge`, no "Admin controls" button, no "Close game" button, and a "Quit game" button is visible. The players list still shows both users, the "Admin" label is on the player's row, and the player's balance is still `5.00`. The host's own balance is unchanged (`0.00` if nothing was minted to them).
6. Player reloads the game. They see `game-admin-badge`, "Admin controls", and "Close game". They do not see "Quit game".
7. Player opens Admin controls and deposits `1.00` to the host. Host's row shows `1.00`. This is the UI proof that mint moved with the role.
8. Host clicks Quit game, confirms in the existing modal ("Quit this game?"), and lands on `/`. Player reloads: the host is gone from the players list, the player still has the admin badge, and "Quit game" is still absent.

Also assert, on the host's home list before they quit, that the game row does not show the "Admin" label, and on the player's home list that it does. Both still see the game. That is the "home list admin label follows the role" scenario. Do it before step 8.

- [ ] **Step 2: Run the spec**

Expected: PASS against the booted stack. A missing registry is the existing one-time `/admin/registry` initialize step (`admin-registry.spec.ts`), not a failure of this ticket.

---

### Task 7: Full gate

- [ ] **Step 1: Lint and the full test suite**

Run: `just lint` then `just test`
Expected: format/lint clean with no further edits, and the suite green (cargo unit tests, on-chain-program-e2e including Task 3, frontend unit tests including Tasks 4 and 5, Playwright including Task 6).

- [ ] **Step 2: No CI edit**

Confirm `git diff` has no `.circleci/` change. CircleCI already runs every suite on the implementation PR.

---

## Spec coverage

| Spec scenario | Where it is verified |
|---|---|
| Successful transfer | Task 3 case 1, Task 6 |
| Zero-balance player can become admin | Task 3 case 2 |
| Token balances untouched | Task 3 case 1, Task 6 step 5 |
| Player count untouched | Task 3 case 1 |
| Non-admin caller → `NotGameAdmin` | Task 3 case 3, Task 4 mapping |
| Caller identity comes from the session | Task 4 success payload uses the session username |
| Signed-out request | Task 4 |
| Admin names themselves on-chain → `CannotTransferAdminToSelf` | Task 3 case 6 |
| Self-transfer rejected before the chain | Task 4 |
| Picker excludes the current admin | Task 5, Task 6 step 4 |
| Non-member → `PlayerNotInGame` | Task 3 case 4, Task 4 |
| Wrong token account → `InvalidPlayerAta` | Task 3 case 5, Task 4 mapping |
| Unknown or closed game → game not found, no transaction | Task 4 (`fetchMaybeGame` exists false; a closed game has no `Game` account) |
| Missing game writes nothing on-chain | Task 3 case 7 |
| Former admin can no longer deposit | Task 3 case 9, Task 6 (host no longer sees Admin controls) |
| New admin can deposit | Task 3 case 9, Task 6 step 7 |
| Former admin can no longer close | Task 3 case 10, Task 6 (no Close game button) |
| New admin passes the close admin check | Task 3 case 10 (`GameNotEmpty`, not `NotGameAdmin`) |
| Former admin quits after transferring | Task 3 case 8, Task 6 step 8 |
| New admin cannot quit | Task 3 case 8, Task 6 steps 6 and 8 |
| Quit control follows the role | Task 6 |
| Admin sees the other players / non-admin does not see the control | Task 5, Task 6 |
| Empty selection | Task 5 |
| Only player has nobody to transfer to | Task 5 |
| Page updates in place | Task 5 (`router.refresh`), Task 6 (same game URL) |
| Home list admin label follows the role | Task 6 |
| `Game.admin` stays a `User` PDA, account not resized | Task 3 case 1 compares the stored pubkey to `findUserPda`; Task 1 leaves `Game::INIT_SPACE` unchanged |
