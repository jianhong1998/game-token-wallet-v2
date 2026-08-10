# Deposit / Mint to Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ticket:** [008 — Deposit / mint to player](../../tickets/008-deposit-mint-to-player.md)
**Spec:** [openspec/changes/deposit-mint-to-player/](../../../openspec/changes/deposit-mint-to-player/)

**Goal:** Let a game's admin mint an arbitrary amount into an existing player's balance (representing an offline cash deposit), restricted on-chain to that game's admin, with an admin-facing deposit form on the game detail page.

**Architecture:** A new `mint_to_player` Anchor instruction mints directly into a target player's existing ATA, gated by an on-chain identity check (`user.key() == game.admin`) rather than a transaction-signer check (every tx is signed by the same custodial system wallet). The frontend adds a `depositToPlayer` Server Action and a client-component "Admin controls" modal on `/games/[address]`, refreshing via `router.refresh()` after a successful deposit.

**Tech Stack:** Rust/Anchor 1.x (on-chain program), TypeScript/Next.js App Router (Server Actions + React client component), Codama-generated `on-chain-client`, Vitest (unit tests), Playwright (e2e).

## Global Constraints

- Deposit amount is admin-discretionary; no conversion rate exists anywhere in the system.
- The mint has 2 decimals; UI amount input is whole game-tokens (e.g. "5.00"), converted ×100 to the on-chain u64 base-unit amount.
- The target player's ATA must already exist; the instruction never auto-joins a player.
- Admin identity is enforced on-chain via `user.key() == game.admin`, independent of the UI.
- No live/push balance updates; a viewer sees fresh state on their next load/navigation only.
- Only the "Deposit for offline cash-in" sub-form of the mockup's "Admin controls" modal is built now; "Transfer admin role" and "Close game" stay out of scope (tickets 010/013) and must not appear, stubbed or otherwise.

---

### Task 1: On-chain `mint_to_player` instruction

**Files:**
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mint_to_player.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`
- Test: inline `#[cfg(test)] mod tests` inside `mint_to_player.rs`

**Interfaces:**
- Consumes: `Game` (`state/game.rs`: `bump`, `mint_bump`, `admin: Pubkey`, `mint: Pubkey`), `User` (`state/user.rs`), `ErrorCode` (`errors.rs`).
- Produces: Anchor instruction `mint_to_player(ctx, game_id: [u8; 16], username: String, player_username: String, amount: u64)`; new `ErrorCode` variants `NotGameAdmin`, `PlayerNotInGame`, `InvalidDepositAmount`; pure helper `pub fn ensure_positive_amount(amount: u64) -> Result<()>` (used by Task 1 only, not exported further).

- [ ] **Step 1: Add the three new error codes**

Edit `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`, adding after `InvalidPlayerAta`:

```rust
    #[msg("Player token account address does not match the expected associated token account")]
    InvalidPlayerAta,
    #[msg("Only the game's admin can perform this action")]
    NotGameAdmin,
    #[msg("Target user has not joined this game")]
    PlayerNotInGame,
    #[msg("Deposit amount must be greater than zero")]
    InvalidDepositAmount,
}
```

- [ ] **Step 2: Write the failing test for the pure amount guard**

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mint_to_player.rs`:

```rust
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

pub fn ensure_positive_amount(amount: u64) -> Result<()> {
    todo_unimplemented(amount)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_a_positive_amount() {
        assert!(ensure_positive_amount(1).is_ok());
    }

    #[test]
    fn rejects_a_zero_amount() {
        assert!(ensure_positive_amount(0).is_err());
    }
}
```

This intentionally references an undefined `todo_unimplemented` so the module fails to compile — the red state. Wire the file into the module tree so `cargo test` picks it up: edit `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`:

```rust
pub mod create_game;
pub mod join_game;
pub mod mint_to_player;

pub use create_game::*;
pub use join_game::*;
pub use mint_to_player::*;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml mint_to_player`
Expected: FAIL to compile — `cannot find function 'todo_unimplemented'`.

- [ ] **Step 4: Implement the minimal guard function**

In `mint_to_player.rs`, replace the `ensure_positive_amount` body:

```rust
pub fn ensure_positive_amount(amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidDepositAmount);
    Ok(())
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml mint_to_player`
Expected: PASS — both `allows_a_positive_amount` and `rejects_a_zero_amount` green.

- [ ] **Step 6: Implement the full instruction (Accounts + handler + CPI)**

Replace the top of `mint_to_player.rs` (above the `#[cfg(test)]` module, which stays as-is) with:

```rust
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{mint_to, Mint, MintTo, Token};

use crate::errors::ErrorCode;
use crate::state::{Game, User};

// Named `user` (not `admin_user`) and `admin` (the system wallet, not the
// game's admin) for the same reasons documented on `JoinGame`/`CreateGame`'s
// own `user`/`admin` fields: identical PDA seeds across instructions need
// identical field names for Codama's IDL-driven client generator to
// canonicalize them into a single named finder. The *target* player's own
// `User` PDA can't reuse the `user` name (Anchor forbids duplicate accessor
// names in one `Accounts` struct), so it's `player_user` instead, following
// the same `player_`-prefix convention `JoinGame` already uses for
// `player_ata`.
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String, player_username: String, amount: u64)]
pub struct MintToPlayer<'info> {
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

    #[account(seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [b"mint", game.key().as_ref()], bump = game.mint_bump)]
    pub mint: Account<'info, Mint>,

    /// CHECK: this is the target player's Associated Token Account for
    /// `mint`. Its address is validated against the deterministic ATA
    /// derivation for `(player_user, mint)` in the handler, and its
    /// initialized state is checked explicitly there too — it must already
    /// exist, since depositing never auto-joins a player — mirroring
    /// `JoinGame`'s own `player_ata` validation approach.
    #[account(mut)]
    pub player_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn ensure_positive_amount(amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidDepositAmount);
    Ok(())
}

pub fn handler(
    ctx: Context<MintToPlayer>,
    game_id: [u8; 16],
    _username: String,
    _player_username: String,
    amount: u64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.user.key(),
        ctx.accounts.game.admin,
        ErrorCode::NotGameAdmin
    );

    ensure_positive_amount(amount)?;

    let expected_ata =
        get_associated_token_address(&ctx.accounts.player_user.key(), &ctx.accounts.mint.key());
    require_keys_eq!(
        ctx.accounts.player_ata.key(),
        expected_ata,
        ErrorCode::InvalidPlayerAta
    );
    require!(
        !ctx.accounts.player_ata.data_is_empty(),
        ErrorCode::PlayerNotInGame
    );

    let signer_seeds: &[&[u8]] = &[b"game", game_id.as_ref(), &[ctx.accounts.game.bump]];
    let cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.player_ata.to_account_info(),
        authority: ctx.accounts.game.to_account_info(),
    };
    // This repo's resolved anchor-lang/anchor-spl (1.1.2) uses a
    // `CpiContext::new_with_signer(program_id: Pubkey, accounts: T, signer_seeds)`
    // signature — pass `.key()`, not `.to_account_info()`, matching the same
    // convention `JoinGame`'s own CPI already documents.
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        &[signer_seeds],
    );
    mint_to(cpi_ctx, amount)?;

    Ok(())
}
```

(Leave the existing `#[cfg(test)] mod tests { ... }` block at the bottom of the file untouched — it still covers `ensure_positive_amount`.)

- [ ] **Step 7: Wire the instruction into `lib.rs`**

Edit `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`, adding inside the `#[program] pub mod game_token_wallet { ... }` block, after `join_game`:

```rust
    pub fn mint_to_player(
        ctx: Context<MintToPlayer>,
        game_id: [u8; 16],
        username: String,
        player_username: String,
        amount: u64,
    ) -> Result<()> {
        instructions::game::mint_to_player::handler(ctx, game_id, username, player_username, amount)
    }
```

- [ ] **Step 8: Run the full program unit test suite and confirm it compiles**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: PASS — all existing tests plus the two new `mint_to_player` tests green, no compile errors.

- [ ] **Step 9: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/errors.rs \
        apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mint_to_player.rs \
        apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs \
        apps/on-chain-program/programs/game_token_wallet/src/lib.rs
git commit -m "feat(008): add mint_to_player on-chain instruction"
```

---

### Task 2: Regenerate the on-chain client

**Files:**
- Modify (generated): `apps/on-chain-client/src/generated/**` (regenerated, not hand-edited)
- Modify: `apps/on-chain-client/src/index.test.ts`

**Interfaces:**
- Consumes: Task 1's built IDL (`apps/on-chain-program/target/idl/game_token_wallet.json`).
- Produces (re-exported from `on-chain-client`): `getMintToPlayerInstructionAsync`, `GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN`, `GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME`, `GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT`.

- [ ] **Step 1: Write the failing smoke test**

Edit `apps/on-chain-client/src/index.test.ts`, adding to the import list:

```ts
  GAME_TOKEN_WALLET_ERROR__INVALID_PLAYER_ATA,
  getMintToPlayerInstructionAsync,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT,
} from "./index";
```

and adding a new test at the end of the `describe` block:

```ts
  it("exports a mint_to_player instruction builder and its error helpers", () => {
    expect(typeof getMintToPlayerInstructionAsync).toBe("function");
    expect(typeof GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN).toBe("number");
    expect(typeof GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME).toBe("number");
    expect(typeof GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT).toBe("number");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter on-chain-client run test`
Expected: FAIL — `getMintToPlayerInstructionAsync` etc. are not exported yet (import error / undefined).

- [ ] **Step 3: Rebuild the program IDL and regenerate the client**

Run:
```bash
just program-build
pnpm --filter on-chain-client run codegen
```
This regenerates `apps/on-chain-client/src/generated/**` from the freshly built IDL — do not hand-edit generated files.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter on-chain-client run test`
Expected: PASS — including the new `mint_to_player` smoke test.

- [ ] **Step 5: Lint and typecheck the regenerated client**

Run: `pnpm --filter on-chain-client run lint && pnpm --filter on-chain-client run typecheck`
Expected: both PASS with no changes needed.

- [ ] **Step 6: Commit**

```bash
git add apps/on-chain-client
git commit -m "feat(008): regenerate on-chain-client for mint_to_player"
```

---

### Task 3: `on-chain-program-e2e` integration tests

**Files:**
- Create: `apps/on-chain-program-e2e/tests/game/mint_to_player.test.ts`

**Interfaces:**
- Consumes: `getMintToPlayerInstructionAsync`, `getCreateUserInstructionAsync`, `getCreateGameInstructionAsync`, `getJoinGameInstructionAsync`, `findUserPda`, `findGamePda`, `fetchGame`, `GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN`, `GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME`, `GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT`, `isGameTokenWalletError` (all from `on-chain-client`, produced by Task 2); `fetchToken`, `findAssociatedTokenPda`, `TOKEN_PROGRAM_ADDRESS` (from `@solana-program/token`).
- Produces: nothing consumed by later tasks — this is a leaf verification task.

- [ ] **Step 1: Write the test file**

Create `apps/on-chain-program-e2e/tests/game/mint_to_player.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  airdropFactory,
  lamports,
  assertIsTransactionWithBlockhashLifetime,
  unwrapSimulationError,
  type KeyPairSigner,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import { findAssociatedTokenPda, fetchToken, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync,
  findGamePda,
  findUserPda,
  fetchGame,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT,
  isGameTokenWalletError,
} from "on-chain-client";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS_URL = process.env.SOLANA_RPC_WS_URL ?? "ws://127.0.0.1:8900";

async function fundedAdmin(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
): Promise<KeyPairSigner> {
  const admin = await generateKeyPairSigner();
  const airdrop = airdropFactory({ rpc, rpcSubscriptions });
  await airdrop({
    commitment: "confirmed",
    recipientAddress: admin.address,
    lamports: lamports(1_000_000_000n),
  });
  return admin;
}

async function buildAndSend(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  payer: KeyPairSigner,
  instruction: { programAddress: unknown; accounts: unknown; data: unknown },
): Promise<void> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([instruction as never], tx),
  );
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
}

async function registeredAdmin(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  username: string,
): Promise<KeyPairSigner> {
  const admin = await fundedAdmin(rpc, rpcSubscriptions);
  const createUserInstruction = await getCreateUserInstructionAsync({
    admin,
    username,
    salt: new Uint8Array(16),
    passwordHash: new Uint8Array(64),
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createUserInstruction);
  return admin;
}

function gameId(fill: number): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = fill;
  return bytes;
}

async function createdGame(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  hostUsername: string,
  idFill: number,
) {
  const hostAdmin = await registeredAdmin(rpc, rpcSubscriptions, hostUsername);
  const id = gameId(idFill);
  const createGameInstruction = await getCreateGameInstructionAsync({
    admin: hostAdmin,
    username: hostUsername,
    gameId: id,
    name: "Deposit Test Game",
  });
  await buildAndSend(rpc, rpcSubscriptions, hostAdmin, createGameInstruction);
  const [gameAddress] = await findGamePda({ gameId: id });
  return { hostAdmin, id, gameAddress };
}

async function joinedPlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  username: string,
) {
  const admin = await registeredAdmin(rpc, rpcSubscriptions, username);
  const [userAddress] = await findUserPda({ username, admin: admin.address });
  const [playerAta] = await findAssociatedTokenPda({
    owner: userAddress,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const joinGameInstruction = await getJoinGameInstructionAsync({
    admin,
    username,
    gameId: gameIdBytes,
    playerAta,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, joinGameInstruction);
  return { admin, userAddress, playerAta };
}

describe("mint_to_player instruction", () => {
  it("mints the amount into the target player's existing ATA", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { hostAdmin, id, gameAddress } = await createdGame(
      rpc,
      rpcSubscriptions,
      "deposithost1",
      201,
    );
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      id,
      game.data.mint,
      "depositplayer1",
    );

    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin: hostAdmin,
      username: "deposithost1",
      gameId: id,
      playerUsername: "depositplayer1",
      playerAta,
      amount: 500n,
    });
    await buildAndSend(rpc, rpcSubscriptions, hostAdmin, mintInstruction);

    const token = await fetchToken(rpc, playerAta);
    expect(token.data.amount).toBe(500n);
  }, 30_000);

  it("rejects a non-admin caller with NotGameAdmin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, "deposithost2", 202);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      id,
      game.data.mint,
      "depositplayer2",
    );
    // A second, independently registered user — not this game's admin.
    const impostorAdmin = await registeredAdmin(rpc, rpcSubscriptions, "depositimpostor2");

    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin: impostorAdmin,
      username: "depositimpostor2",
      gameId: id,
      playerUsername: "depositplayer2",
      playerAta,
      amount: 500n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(impostorAdmin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([mintInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the deposit to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
        ),
      ).toBe(true);
    }

    const token = await fetchToken(rpc, playerAta);
    expect(token.data.amount).toBe(0n);
  }, 30_000);

  it("rejects a deposit to a non-member with PlayerNotInGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { hostAdmin, id } = await createdGame(rpc, rpcSubscriptions, "deposithost3", 203);
    // Registered but never joined to the game — no ATA exists yet.
    const nonMemberUsername = "depositnonmember3";
    await registeredAdmin(rpc, rpcSubscriptions, nonMemberUsername);
    const [nonMemberUserAddress] = await findUserPda({
      username: nonMemberUsername,
      admin: hostAdmin.address,
    });
    const game = await fetchGame(rpc, (await findGamePda({ gameId: id }))[0]);
    const [nonMemberAta] = await findAssociatedTokenPda({
      owner: nonMemberUserAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin: hostAdmin,
      username: "deposithost3",
      gameId: id,
      playerUsername: nonMemberUsername,
      playerAta: nonMemberAta,
      amount: 500n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(hostAdmin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([mintInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the deposit to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
        ),
      ).toBe(true);
    }
  }, 30_000);

  it("rejects a zero amount with InvalidDepositAmount", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { hostAdmin, id, gameAddress } = await createdGame(
      rpc,
      rpcSubscriptions,
      "deposithost4",
      204,
    );
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      id,
      game.data.mint,
      "depositplayer4",
    );

    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin: hostAdmin,
      username: "deposithost4",
      gameId: id,
      playerUsername: "depositplayer4",
      playerAta,
      amount: 0n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(hostAdmin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([mintInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the deposit to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT,
        ),
      ).toBe(true);
    }

    const token = await fetchToken(rpc, playerAta);
    expect(token.data.amount).toBe(0n);
  }, 30_000);
});
```

- [ ] **Step 2: Run the e2e program test suite**

Run: `just test-e2e-program`
Expected: PASS — all four new `mint_to_player` scenarios green, no regressions in sibling test files.

- [ ] **Step 3: Commit**

```bash
git add apps/on-chain-program-e2e/tests/game/mint_to_player.test.ts
git commit -m "test(008): add mint_to_player e2e program tests"
```

---

### Task 4: `depositToPlayer` Server Action

**Files:**
- Modify: `apps/frontend/src/server/actions/game.ts`
- Test: `apps/frontend/src/server/actions/game.test.ts`

**Interfaces:**
- Consumes: `getMintToPlayerInstructionAsync`, `GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN`, `GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME` (from `on-chain-client`, Task 2); existing `getCurrentUsername`, `getSolanaContext`, `signAndSendTransaction`, `findUserPda`, `findAssociatedTokenPda`, `fetchMaybeGame`.
- Produces: `export interface DepositToPlayerInput { gameAddress: string; playerUsername: string; amount: number }`, `export type DepositToPlayerResult = { ok: true } | { ok: false; error: string }`, `export async function depositToPlayer(input: DepositToPlayerInput): Promise<DepositToPlayerResult>` — consumed by Task 5's UI component.

- [ ] **Step 1: Write the failing tests**

Edit `apps/frontend/src/server/actions/game.test.ts`. First extend the two mock blocks near the top:

```ts
const {
  mockFindUserPda,
  mockFindRegistryPda,
  mockFetchMaybeRegistry,
  mockFetchGame,
  mockFetchMaybeGame,
  mockGetCreateGameInstructionAsync,
  mockGetJoinGameInstructionAsync,
  mockGetMintToPlayerInstructionAsync,
  mockFetchAllUser,
  mockIsGameTokenWalletError,
} = vi.hoisted(() => ({
  mockFindUserPda: vi.fn(),
  mockFindRegistryPda: vi.fn(),
  mockFetchMaybeRegistry: vi.fn(),
  mockFetchGame: vi.fn(),
  mockFetchMaybeGame: vi.fn(),
  mockGetCreateGameInstructionAsync: vi.fn(),
  mockGetJoinGameInstructionAsync: vi.fn(),
  mockGetMintToPlayerInstructionAsync: vi.fn(),
  mockFetchAllUser: vi.fn(),
  mockIsGameTokenWalletError: vi.fn(),
}));
// Mirrors on-chain-client's actual generated error codes (see
// apps/on-chain-client/src/generated/errors/gameTokenWallet.ts) — only the
// codes joinGame()/depositToPlayer() map to friendly messages need real
// values here since mockIsGameTokenWalletError compares against them directly.
const {
  GAME_FULL_CODE,
  ALREADY_JOINED_GAME_CODE,
  NOT_GAME_ADMIN_CODE,
  PLAYER_NOT_IN_GAME_CODE,
} = vi.hoisted(() => ({
  GAME_FULL_CODE: 0x1774,
  ALREADY_JOINED_GAME_CODE: 0x1775,
  NOT_GAME_ADMIN_CODE: 0x1777,
  PLAYER_NOT_IN_GAME_CODE: 0x1778,
}));
vi.mock("on-chain-client", () => ({
  findUserPda: mockFindUserPda,
  findRegistryPda: mockFindRegistryPda,
  fetchMaybeRegistry: mockFetchMaybeRegistry,
  fetchGame: mockFetchGame,
  fetchMaybeGame: mockFetchMaybeGame,
  getCreateGameInstructionAsync: mockGetCreateGameInstructionAsync,
  getJoinGameInstructionAsync: mockGetJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync: mockGetMintToPlayerInstructionAsync,
  fetchAllUser: mockFetchAllUser,
  isGameTokenWalletError: mockIsGameTokenWalletError,
  GAME_TOKEN_WALLET_ERROR__GAME_FULL: GAME_FULL_CODE,
  GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME: ALREADY_JOINED_GAME_CODE,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN: NOT_GAME_ADMIN_CODE,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME: PLAYER_NOT_IN_GAME_CODE,
}));
```

Update the import line:

```ts
import {
  createGame,
  joinGame,
  depositToPlayer,
  listBrowseGames,
  listMyMemberGames,
  fetchGameDetail,
} from "./game";
```

Then add a new `describe` block at the end of the file:

```ts
describe("depositToPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("hostadmin");
    mockGetSolanaContext.mockResolvedValue({
      rpc: {
        getLatestBlockhash: () => ({
          send: async () => ({ value: { blockhash: "fake", lastValidBlockHeight: 1n } }),
        }),
      },
      rpcSubscriptions: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFetchMaybeGame.mockResolvedValue({
      exists: true,
      address: GAME_ADDRESS,
      data: gameData({ mint: MINT_ADDRESS }),
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    mockFindAssociatedTokenPda.mockResolvedValue([PLAYER_ATA_ADDRESS, 254]);
    mockGetMintToPlayerInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignAndSendTransaction.mockResolvedValue(undefined);
    mockIsGameTokenWalletError.mockReturnValue(false);
  });

  it("rejects when not signed in, without touching the chain", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(
      depositToPlayer({ gameAddress: GAME_ADDRESS, playerUsername: "bob", amount: 5 }),
    ).resolves.toEqual({ ok: false, error: "Not signed in" });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects a zero amount before touching the chain", async () => {
    const result = await depositToPlayer({
      gameAddress: GAME_ADDRESS,
      playerUsername: "bob",
      amount: 0,
    });
    expect(result).toEqual({ ok: false, error: "Amount must be greater than zero" });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects a negative amount before touching the chain", async () => {
    const result = await depositToPlayer({
      gameAddress: GAME_ADDRESS,
      playerUsername: "bob",
      amount: -5,
    });
    expect(result.ok).toBe(false);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects when the game doesn't exist", async () => {
    mockFetchMaybeGame.mockResolvedValue({ exists: false });
    const result = await depositToPlayer({
      gameAddress: GAME_ADDRESS,
      playerUsername: "bob",
      amount: 5,
    });
    expect(result).toEqual({ ok: false, error: "Game not found" });
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("converts whole-token amount to base units and sends the transaction on success", async () => {
    await expect(
      depositToPlayer({ gameAddress: GAME_ADDRESS, playerUsername: "bob", amount: 5 }),
    ).resolves.toEqual({ ok: true });
    expect(mockGetMintToPlayerInstructionAsync).toHaveBeenCalledWith(
      {
        admin: { address: ADMIN_ADDRESS },
        username: "hostadmin",
        gameId: expect.anything(),
        playerUsername: "bob",
        playerAta: PLAYER_ATA_ADDRESS,
        amount: 500n,
      },
      { programAddress: PROGRAM_ADDRESS },
    );
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(1);
  });

  it("maps an on-chain NotGameAdmin rejection to the friendly message", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("simulation failed"));
    mockIsGameTokenWalletError.mockImplementation(
      (_error, _tx, code) => code === NOT_GAME_ADMIN_CODE,
    );
    await expect(
      depositToPlayer({ gameAddress: GAME_ADDRESS, playerUsername: "bob", amount: 5 }),
    ).resolves.toEqual({ ok: false, error: "Only the game's admin can deposit tokens" });
  });

  it("maps an on-chain PlayerNotInGame rejection to the friendly message", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("simulation failed"));
    mockIsGameTokenWalletError.mockImplementation(
      (_error, _tx, code) => code === PLAYER_NOT_IN_GAME_CODE,
    );
    await expect(
      depositToPlayer({ gameAddress: GAME_ADDRESS, playerUsername: "bob", amount: 5 }),
    ).resolves.toEqual({ ok: false, error: "That player hasn't joined this game" });
  });

  it("re-throws an on-chain error that isn't a recognized mint_to_player program error", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("network blip"));
    mockIsGameTokenWalletError.mockReturnValue(false);
    await expect(
      depositToPlayer({ gameAddress: GAME_ADDRESS, playerUsername: "bob", amount: 5 }),
    ).rejects.toThrow("network blip");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter frontend run test -- game.test.ts`
Expected: FAIL — `depositToPlayer` is not exported from `./game` yet.

- [ ] **Step 3: Implement `depositToPlayer`**

Edit `apps/frontend/src/server/actions/game.ts`. Add to the `on-chain-client` import list:

```ts
  getMintToPlayerInstructionAsync,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
```

Then add the new action (placed after `joinGame`, before the `fetchGamesWithMyAtas` helper):

```ts
export interface DepositToPlayerInput {
  gameAddress: string;
  playerUsername: string;
  amount: number;
}

export type DepositToPlayerResult = { ok: true } | { ok: false; error: string };

export async function depositToPlayer(
  input: DepositToPlayerInput,
): Promise<DepositToPlayerResult> {
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in" };
  }

  if (!(input.amount > 0)) {
    return { ok: false, error: "Amount must be greater than zero" };
  }
  const baseUnitsAmount = BigInt(Math.round(input.amount * 100));

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

  const mintToPlayerInstruction = await getMintToPlayerInstructionAsync(
    {
      admin: adminSigner,
      username,
      gameId: game.data.gameId,
      playerUsername: input.playerUsername,
      playerAta,
      amount: baseUnitsAmount,
    },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([mintToPlayerInstruction], tx),
  );
  try {
    await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });
  } catch (error) {
    const cause = unwrapSimulationError(error);
    if (
      isGameTokenWalletError(cause, transactionMessage, GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN)
    ) {
      return { ok: false, error: "Only the game's admin can deposit tokens" };
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
    throw error;
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter frontend run test -- game.test.ts`
Expected: PASS — all `depositToPlayer` tests green, no regressions in `createGame`/`joinGame`/`listBrowseGames`/`listMyMemberGames`/`fetchGameDetail` tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/server/actions/game.ts apps/frontend/src/server/actions/game.test.ts
git commit -m "feat(008): add depositToPlayer server action"
```

---

### Task 5: Admin controls modal on the game detail page

**Files:**
- Create: `apps/frontend/src/app/(app)/games/[address]/AdminControlsModal.tsx`
- Create: `apps/frontend/src/app/(app)/games/[address]/AdminControlsModal.test.tsx`
- Modify: `apps/frontend/src/app/(app)/games/[address]/page.tsx`
- Modify: `apps/frontend/src/app/(app)/games/[address]/page.test.tsx`

**Interfaces:**
- Consumes: `depositToPlayer`, `DepositToPlayerInput`, and the existing `GamePlayer`/`GameDetail` types (from `@/server/actions/game`, Task 4); `Button`, `Input`, `Alert` (from `@/components/ui/*`).
- Produces: default-exported `AdminControlsModal({ gameAddress: string; players: GamePlayer[] }): JSX.Element`, rendered by `page.tsx` — consumed by Task 6's Playwright spec via its rendered button/label text.

- [ ] **Step 1: Write the failing component test**

Create `apps/frontend/src/app/(app)/games/[address]/AdminControlsModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockDepositToPlayer } = vi.hoisted(() => ({ mockDepositToPlayer: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ depositToPlayer: mockDepositToPlayer }));

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import AdminControlsModal from "./AdminControlsModal";

const PLAYERS = [
  { username: "alice", balance: 4, isAdmin: true },
  { username: "bob", balance: 1.5, isAdmin: false },
];

describe("AdminControlsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the Admin controls button and no modal content until clicked", () => {
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    expect(screen.getByRole("button", { name: "Admin controls" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Player")).not.toBeInTheDocument();
  });

  it("opens the modal with a player picker listing current players and an amount field", () => {
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    expect(screen.getByLabelText("Player")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "alice" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "bob" })).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
  });

  it("rejects submitting without a selected player", () => {
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(screen.getByTestId("deposit-error")).toHaveTextContent("Select a player");
    expect(mockDepositToPlayer).not.toHaveBeenCalled();
  });

  it("rejects submitting a zero amount", () => {
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    fireEvent.change(screen.getByLabelText("Player"), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(screen.getByTestId("deposit-error")).toHaveTextContent(
      "Amount must be greater than zero",
    );
    expect(mockDepositToPlayer).not.toHaveBeenCalled();
  });

  it("deposits, closes the modal, and refreshes on success", async () => {
    mockDepositToPlayer.mockResolvedValue({ ok: true });
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    fireEvent.change(screen.getByLabelText("Player"), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(mockDepositToPlayer).toHaveBeenCalledWith({
      gameAddress: "Game1",
      playerUsername: "bob",
      amount: 5,
    });
    expect(screen.queryByLabelText("Player")).not.toBeInTheDocument();
  });

  it("shows a friendly error and keeps the modal open when the deposit is rejected", async () => {
    mockDepositToPlayer.mockResolvedValue({
      ok: false,
      error: "Only the game's admin can deposit tokens",
    });
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    fireEvent.change(screen.getByLabelText("Player"), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));

    await waitFor(() =>
      expect(screen.getByTestId("deposit-error")).toHaveTextContent(
        "Only the game's admin can deposit tokens",
      ),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Player")).toBeInTheDocument();
  });

  it("shows a fallback error when depositToPlayer throws unexpectedly", async () => {
    mockDepositToPlayer.mockRejectedValue(new Error("Network error"));
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    fireEvent.change(screen.getByLabelText("Player"), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));

    await waitFor(() => expect(screen.getByTestId("deposit-error")).toBeInTheDocument());
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- AdminControlsModal`
Expected: FAIL — `./AdminControlsModal` module doesn't exist yet.

- [ ] **Step 3: Implement `AdminControlsModal`**

Create `apps/frontend/src/app/(app)/games/[address]/AdminControlsModal.tsx`:

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { depositToPlayer, type GamePlayer } from "@/server/actions/game";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function AdminControlsModal({
  gameAddress,
  players,
}: {
  gameAddress: string;
  players: GamePlayer[];
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [playerUsername, setPlayerUsername] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function closeModal() {
    setIsOpen(false);
    setPlayerUsername("");
    setAmount("");
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!playerUsername) {
      setError("Select a player");
      return;
    }
    const parsedAmount = Number(amount);
    if (!(parsedAmount > 0)) {
      setError("Amount must be greater than zero");
      return;
    }

    startTransition(async () => {
      try {
        const result = await depositToPlayer({ gameAddress, playerUsername, amount: parsedAmount });
        if (result.ok) {
          closeModal();
          router.refresh();
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setIsOpen(true)}>
        Admin controls
      </Button>
      {isOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/70 p-6">
          <div className="glass-hero w-full max-w-sm p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-text-primary">Admin controls</h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 text-text-primary"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                Deposit for offline cash-in
              </p>
              <div>
                <label
                  htmlFor="deposit-player"
                  className="mb-1.5 block text-[11px] font-bold text-text-primary"
                >
                  Player
                </label>
                <select
                  id="deposit-player"
                  value={playerUsername}
                  onChange={(event) => setPlayerUsername(event.target.value)}
                  className="glass-input h-11 w-full px-4 text-sm text-text-primary"
                >
                  <option value="">Select player…</option>
                  {players.map((player) => (
                    <option key={player.username} value={player.username}>
                      {player.username}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label
                    htmlFor="deposit-amount"
                    className="mb-1.5 block text-[11px] font-bold text-text-primary"
                  >
                    Amount
                  </label>
                  <Input
                    id="deposit-amount"
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <Button type="submit" variant="secondary" isLoading={isPending}>
                  Deposit
                </Button>
              </div>
              {error && (
                <Alert data-testid="deposit-error" variant="error">
                  {error}
                </Alert>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend run test -- AdminControlsModal`
Expected: PASS — all `AdminControlsModal` tests green.

- [ ] **Step 5: Write the failing page-level test for the admin-only button**

Edit `apps/frontend/src/app/(app)/games/[address]/page.test.tsx`, updating the `next/navigation` mock to include `useRouter` (needed because `page.tsx` will render the real `AdminControlsModal`, which calls it):

```ts
const { mockRedirect, mockNotFound, mockRefresh } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
  mockNotFound: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
  useRouter: () => ({ refresh: mockRefresh }),
}));
```

Then extend the "shows the admin badge" test and add a new one, appended to the `describe` block:

```tsx
  it("shows the admin badge and the Admin controls button when the viewer is the game's admin", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockFetchGameDetail.mockResolvedValue({
      address: "Game1",
      name: "Friday Poker",
      mode: 0,
      isAdmin: true,
      myBalance: 4,
      players: [{ username: "alice", balance: 4, isAdmin: true }],
    });
    const jsx = await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    render(jsx);
    expect(screen.getByTestId("game-admin-badge")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admin controls" })).toBeInTheDocument();
  });

  it("does not show the Admin controls button for a non-admin viewer", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFetchGameDetail.mockResolvedValue({
      address: "Game1",
      name: "Friday Poker",
      mode: 0,
      isAdmin: false,
      myBalance: 1.5,
      players: [
        { username: "alice", balance: 4, isAdmin: true },
        { username: "bob", balance: 1.5, isAdmin: false },
      ],
    });
    const jsx = await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    render(jsx);
    expect(screen.queryByRole("button", { name: "Admin controls" })).not.toBeInTheDocument();
  });
```

(Replace the existing "shows the admin badge in the header when the viewer is the game's admin" test with the first block above — same scenario, extended assertion.)

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- games/\\[address\\]/page`
Expected: FAIL — `page.tsx` doesn't render an "Admin controls" button yet.

- [ ] **Step 7: Wire `AdminControlsModal` into `page.tsx`**

Edit `apps/frontend/src/app/(app)/games/[address]/page.tsx`, adding the import:

```tsx
import AdminControlsModal from "./AdminControlsModal";
```

and rendering the modal after the players list `<div>` (immediately before the closing `</main>`):

```tsx
      </div>

      {game.isAdmin && <AdminControlsModal gameAddress={game.address} players={game.players} />}
    </main>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter frontend run test -- games/\\[address\\]/page`
Expected: PASS — including the new admin/non-admin button assertions.

- [ ] **Step 9: Run the full frontend test suite, lint, and typecheck**

Run: `pnpm --filter frontend run test && pnpm lint && pnpm typecheck`
Expected: all PASS, no regressions elsewhere in the frontend.

- [ ] **Step 10: Commit**

```bash
git add apps/frontend/src/app/\(app\)/games/\[address\]/AdminControlsModal.tsx \
        apps/frontend/src/app/\(app\)/games/\[address\]/AdminControlsModal.test.tsx \
        apps/frontend/src/app/\(app\)/games/\[address\]/page.tsx \
        apps/frontend/src/app/\(app\)/games/\[address\]/page.test.tsx
git commit -m "feat(008): add admin controls deposit modal to game detail page"
```

---

### Task 6: Playwright end-to-end verification

**Files:**
- Create: `apps/e2e/tests/game-deposit.spec.ts`

**Interfaces:**
- Consumes: the running frontend (Task 5's "Admin controls" button, "Player"/"Amount" labeled fields, "Deposit" button) and on-chain program (Task 1–3) via the full stack.
- Produces: nothing consumed by later tasks — final acceptance-level verification.

- [ ] **Step 1: Write the spec**

Create `apps/e2e/tests/game-deposit.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

function uniqueUsername(prefix: string): string {
  return `${prefix}${Date.now()}`;
}

async function registerAndLogin(page: import("@playwright/test").Page, username: string) {
  const password = "Abcdef123!";
  await page.goto("/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
}

test("game admin deposits to a player, and the player sees the credited balance", async ({
  page,
  browser,
}) => {
  const hostUsername = uniqueUsername("e2edeposithost");
  const playerUsername = uniqueUsername("e2edepositplayer");

  await registerAndLogin(page, hostUsername);
  await page.goto("/games/new");
  await page.getByLabel("Game name").fill("E2E Deposit Test Game");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await registerAndLogin(secondPage, playerUsername);
  await secondPage.goto("/games/all");
  const row = secondPage.locator("li").filter({ hasText: "E2E Deposit Test Game" });
  await row.getByRole("button", { name: "Join" }).click();
  await expect(secondPage).toHaveURL(/\/games\/.+/, { timeout: 30_000 });
  await expect(secondPage.getByTestId("my-balance")).toContainText("0.00");

  // Non-admin has no access to the deposit form.
  await expect(secondPage.getByRole("button", { name: "Admin controls" })).toHaveCount(0);

  // Host opens the game and deposits to the newly joined player.
  await page.getByRole("link", { name: /E2E Deposit Test Game/ }).click();
  await expect(page).toHaveURL(/\/games\/.+/, { timeout: 30_000 });
  await expect(page.getByTestId("players-list")).toContainText(playerUsername);
  await page.getByRole("button", { name: "Admin controls" }).click();
  await page.getByLabel("Player").selectOption(playerUsername);
  await page.getByLabel("Amount").fill("5.00");
  await page.getByRole("button", { name: "Deposit" }).click();

  const playerRow = page.getByTestId("players-list").locator("li").filter({ hasText: playerUsername });
  await expect(playerRow).toContainText("5.00");

  // Player's own view reflects the deposit once they next load the page —
  // no live/push update while they're already on it.
  await secondPage.reload();
  await expect(secondPage.getByTestId("my-balance")).toContainText("5.00");

  await secondContext.close();
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `just test-e2e`
Expected: PASS — new spec green, no regressions in `auth.spec.ts`, `game-creation.spec.ts`, `game-joining.spec.ts`, `admin-registry.spec.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/game-deposit.spec.ts
git commit -m "test(008): add game-deposit playwright e2e spec"
```

---

## Final Verification

- [ ] Run the full project gate: `just lint && just typecheck && just test`
- [ ] Confirm all four `player-deposit` spec scenarios from `openspec/changes/deposit-mint-to-player/specs/player-deposit/spec.md` are covered: admin-only mint, on-chain-enforced admin identity, target-must-already-be-a-player, positive-amount validation (client + on-chain), admin-facing form with member-only picker, and player balance reflecting deposits on next load.
- [ ] Manually verify against a freshly reset local stack (`just down-clean && just up-build`): register two users, create a game (host auto-joins), join as the second user, host deposits via the Admin controls modal, confirm the balance on both the host's view (immediate) and the player's own view (after reload).
