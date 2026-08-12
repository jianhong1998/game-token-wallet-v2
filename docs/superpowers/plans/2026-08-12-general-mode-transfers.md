# General Mode Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ticket:** [009 — General Mode transfers](../../tickets/009-general-mode-transfers.md)
**Spec:** [openspec/changes/general-mode-transfers/](../../../openspec/changes/general-mode-transfers/)

**Goal:** Let any player in a General Mode game send tokens directly to one or several other members of that game in a single submit action, on-chain and from the game detail page.

**Architecture:** A new `transfer_token` Anchor instruction moves tokens between two players' ATAs for the same game's mint, authorized by the sender's own `User` PDA (not the game admin) — fixed accounts, no dynamic recipient list (per architecture decision Q14). The frontend adds a `transferTokens` Server Action that validates a batch of `{recipient, amount}` pairs, builds one instruction per recipient, packs them into as few transactions as actually fit Solana's real per-transaction size limit (measured via `@solana/kit`'s own message-compilation, not a hardcoded per-chunk count), and sends chunks sequentially — stopping at the first chunk failure and reporting `transfersApplied`/`transfersTotal` so a partial batch is never shown as a bare success or failure. A new inline "Send tokens" section on the game detail page lets any General Mode player build a multi-recipient batch and submit it in one action.

**Tech Stack:** Rust/Anchor 1.x (on-chain program), TypeScript/Next.js App Router (Server Actions + React client component), Codama-generated `on-chain-client`, Vitest (unit tests), Playwright (e2e).

## Global Constraints

- Base units: the mint has 2 decimals; UI amounts are whole game-tokens (e.g. "5.00"), converted ×100 to the on-chain `u64` base-unit amount — same convention as `depositToPlayer`.
- `MAX_USERNAME_BYTES = 32` (`state/user.rs`) — the chunking worst-case math assumes usernames up to this length.
- `MAX_PLAYERS_PER_GAME = 20` (`state/game.rs`) — a batch can target at most 19 recipients (every other member); the chunking algorithm must be verified against that worst case.
- Solana's real per-transaction size ceiling is `@solana/kit`'s `TRANSACTION_SIZE_LIMIT` constant (1232 bytes) — chunking must measure against this via actual message compilation, never a hand-rolled byte estimator.
- No on-chain balance pre-check inside `transfer_token` — the SPL `token::transfer` CPI's native insufficient-funds rejection is the actual guarantee; the server action's pre-flight balance check is best-effort only.
- Self-transfer and non-positive amounts are rejected both client-side (before touching the chain) and independently on-chain (defense in depth).
- A recipient must already hold an ATA for the game's mint — transferring never auto-joins a player.
- No live/push balance updates; a viewer sees fresh state on their next load/navigation (`router.refresh()`), same convention as ticket 008.
- No off-chain DB — everything (users, games, balances) lives on-chain.

---

### Task 1: On-chain `transfer_token` instruction

**Files:**
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/general_mode/mod.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/general_mode/transfer_token.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/mod.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`
- Test: inline `#[cfg(test)] mod tests` inside `transfer_token.rs`

**Interfaces:**
- Consumes: `Game` (`state/game.rs`: `bump`, `mint_bump`, `mint: Pubkey`), `User` (`state/user.rs`), `ErrorCode` (`errors.rs`), `PlayerNotInGame`/`InvalidPlayerAta` (already exist).
- Produces: Anchor instruction `transfer_token(ctx, game_id: [u8; 16], sender_username: String, recipient_username: String, amount: u64)`; new `ErrorCode` variants `SelfTransfer`, `InvalidTransferAmount`; pure helper `pub fn ensure_positive_amount(amount: u64) -> Result<()>` (local to this module, distinct from `mint_to_player`'s own helper of the same name).

- [ ] **Step 1: Add the two new error codes**

Edit `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`, adding after `InvalidDepositAmount`:

```rust
    #[msg("Deposit amount must be greater than zero")]
    InvalidDepositAmount,
    #[msg("Cannot transfer tokens to yourself")]
    SelfTransfer,
    #[msg("Transfer amount must be greater than zero")]
    InvalidTransferAmount,
}
```

- [ ] **Step 2: Write the failing test for the pure amount guard**

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/general_mode/transfer_token.rs`:

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

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/general_mode/mod.rs`:

```rust
pub mod transfer_token;

pub use transfer_token::*;
```

Wire the new top-level module into the instructions tree — edit `apps/on-chain-program/programs/game_token_wallet/src/instructions/mod.rs`:

```rust
pub mod game;
pub mod general_mode;
pub mod registry;
pub mod user;

pub use game::*;
pub use general_mode::*;
pub use registry::*;
pub use user::*;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml transfer_token`
Expected: FAIL to compile — `cannot find function 'todo_unimplemented'`.

- [ ] **Step 4: Implement the minimal guard function**

In `transfer_token.rs`, replace the `ensure_positive_amount` body:

```rust
pub fn ensure_positive_amount(amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidTransferAmount);
    Ok(())
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml transfer_token`
Expected: PASS — both `allows_a_positive_amount` and `rejects_a_zero_amount` green.

- [ ] **Step 6: Implement the full instruction (Accounts + handler + CPI)**

Replace the top of `transfer_token.rs` (above the `#[cfg(test)]` module, which stays as-is) with:

```rust
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{transfer, Mint, Token, Transfer};

use crate::errors::ErrorCode;
use crate::state::{Game, User};

// Named `sender`/`recipient` (not `user`/`player_user`, unlike
// `MintToPlayer`) because neither side here is "the caller's own identity
// checked against an on-chain fact" the way `mint_to_player`'s `user` is
// checked against `game.admin` — there is no on-chain "owner" fact for a P2P
// sender (see openspec/changes/general-mode-transfers/design.md decision 1
// and the architecture decision Q14 grill-me session). Both are still seeded
// identically to `User`'s seeds elsewhere (`[b"user", <username>,
// admin.key()]`), so Codama's IDL-driven client generator will not
// canonicalize them into the existing `user` finder — the same accepted
// trade-off `MintToPlayer`'s own `player_user` field already documents.
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], sender_username: String, recipient_username: String, amount: u64)]
pub struct TransferToken<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", sender_username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub sender: Account<'info, User>,

    #[account(
        seeds = [b"user", recipient_username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub recipient: Account<'info, User>,

    #[account(seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    #[account(seeds = [b"mint", game.key().as_ref()], bump = game.mint_bump)]
    pub mint: Account<'info, Mint>,

    /// CHECK: the sender's own Associated Token Account for `mint`. Its
    /// address is validated against the deterministic ATA derivation for
    /// `(sender, mint)` in the handler. Unlike `recipient_ata` below, its
    /// initialized state isn't checked explicitly — it must already hold a
    /// balance for the CPI to succeed, so the SPL CPI's own rejection is the
    /// guarantee (see design.md decision 1's account table).
    #[account(mut)]
    pub sender_ata: UncheckedAccount<'info>,

    /// CHECK: the recipient's Associated Token Account for `mint`. Its
    /// address is validated against the deterministic ATA derivation for
    /// `(recipient, mint)` in the handler, and its initialized state is
    /// checked explicitly there too — transferring never auto-joins a
    /// player, mirroring `MintToPlayer`'s own `player_ata` validation.
    #[account(mut)]
    pub recipient_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn ensure_positive_amount(amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidTransferAmount);
    Ok(())
}

pub fn handler(
    ctx: Context<TransferToken>,
    _game_id: [u8; 16],
    sender_username: String,
    _recipient_username: String,
    amount: u64,
) -> Result<()> {
    require_keys_neq!(
        ctx.accounts.sender.key(),
        ctx.accounts.recipient.key(),
        ErrorCode::SelfTransfer
    );

    ensure_positive_amount(amount)?;

    let expected_sender_ata =
        get_associated_token_address(&ctx.accounts.sender.key(), &ctx.accounts.mint.key());
    require_keys_eq!(
        ctx.accounts.sender_ata.key(),
        expected_sender_ata,
        ErrorCode::InvalidPlayerAta
    );

    let expected_recipient_ata =
        get_associated_token_address(&ctx.accounts.recipient.key(), &ctx.accounts.mint.key());
    require_keys_eq!(
        ctx.accounts.recipient_ata.key(),
        expected_recipient_ata,
        ErrorCode::InvalidPlayerAta
    );
    require!(
        !ctx.accounts.recipient_ata.data_is_empty(),
        ErrorCode::PlayerNotInGame
    );

    // Authority is the sender's own `User` PDA (not `game`, unlike
    // `mint_to_player`'s mint-authority CPI) — this is what makes the
    // transfer spend from the specific player who initiated it rather than
    // relying on any admin privilege. See design.md decision 1.
    let signer_seeds: &[&[u8]] = &[
        b"user",
        sender_username.as_bytes(),
        ctx.accounts.admin.key().as_ref(),
        &[ctx.bumps.sender],
    ];
    let cpi_accounts = Transfer {
        from: ctx.accounts.sender_ata.to_account_info(),
        to: ctx.accounts.recipient_ata.to_account_info(),
        authority: ctx.accounts.sender.to_account_info(),
    };
    let signer_seeds_arr = [signer_seeds];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        &signer_seeds_arr,
    );
    transfer(cpi_ctx, amount)?;

    Ok(())
}
```

- [ ] **Step 7: Wire the instruction into `lib.rs`**

Edit `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`, adding after `mint_to_player`:

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

    pub fn transfer_token(
        ctx: Context<TransferToken>,
        game_id: [u8; 16],
        sender_username: String,
        recipient_username: String,
        amount: u64,
    ) -> Result<()> {
        instructions::general_mode::transfer_token::handler(
            ctx,
            game_id,
            sender_username,
            recipient_username,
            amount,
        )
    }
}
```

- [ ] **Step 8: Run the full crate test suite to confirm no regressions**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: PASS — every existing test plus the two new `transfer_token::tests` green.

- [ ] **Step 9: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/errors.rs \
  apps/on-chain-program/programs/game_token_wallet/src/instructions/general_mode \
  apps/on-chain-program/programs/game_token_wallet/src/instructions/mod.rs \
  apps/on-chain-program/programs/game_token_wallet/src/lib.rs
git commit -m "feat(009): add transfer_token instruction"
```

---

### Task 2: Regenerate the on-chain client

**Files:**
- Modify (generated): `apps/on-chain-client/src/generated/**` (regenerated, not hand-edited)
- Modify: `apps/on-chain-client/src/index.test.ts`

**Interfaces:**
- Consumes: Task 1's built IDL (`apps/on-chain-program/target/idl/game_token_wallet.json`).
- Produces (re-exported from `on-chain-client`): `getTransferTokenInstructionAsync`, `GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER`, `GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT`.

- [ ] **Step 1: Write the failing smoke test**

Edit `apps/on-chain-client/src/index.test.ts`, adding to the import list and adding a new test at the end of the `describe` block (match whatever existing import/test structure Task 008's `mint_to_player` smoke test used):

```ts
  getTransferTokenInstructionAsync,
  GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER,
  GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT,
} from "./index";
```

```ts
  it("exports a transfer_token instruction builder and its error helpers", () => {
    expect(typeof getTransferTokenInstructionAsync).toBe("function");
    expect(typeof GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER).toBe("number");
    expect(typeof GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT).toBe("number");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter on-chain-client run test`
Expected: FAIL — `getTransferTokenInstructionAsync` etc. are not exported yet.

- [ ] **Step 3: Rebuild the program IDL and regenerate the client**

Run:
```bash
just program-build
pnpm --filter on-chain-client run codegen
```
This regenerates `apps/on-chain-client/src/generated/**` from the freshly built IDL — do not hand-edit generated files.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter on-chain-client run test`
Expected: PASS — including the new `transfer_token` smoke test.

- [ ] **Step 5: Lint and typecheck the regenerated client**

Run: `pnpm --filter on-chain-client run lint && pnpm --filter on-chain-client run typecheck`
Expected: both PASS with no changes needed.

- [ ] **Step 6: Commit**

```bash
git add apps/on-chain-client
git commit -m "feat(009): regenerate on-chain-client for transfer_token"
```

---

### Task 3: `on-chain-program-e2e` integration tests

**Files:**
- Create: `apps/on-chain-program-e2e/tests/general_mode/transfer_token.test.ts`

**Interfaces:**
- Consumes: `getTransferTokenInstructionAsync`, `getMintToPlayerInstructionAsync`, `getCreateUserInstructionAsync`, `getCreateGameInstructionAsync`, `getJoinGameInstructionAsync`, `findUserPda`, `findGamePda`, `fetchGame`, `GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER`, `GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME`, `GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT`, `isGameTokenWalletError` (all from `on-chain-client`, Task 2); `fetchToken`, `findAssociatedTokenPda`, `TOKEN_PROGRAM_ADDRESS`, `isTokenError`, `TOKEN_ERROR__INSUFFICIENT_FUNDS` (from `@solana-program/token`).
- Produces: nothing consumed by later tasks — leaf verification task.

**Important:** `transfer_token`'s `sender`/`recipient` `User` PDAs are seeded `[b"user", <username>, admin.key()]` — exactly like `mint_to_player`'s `user`/`player_user`. Both players involved in a transfer MUST be registered under the *same* shared `admin` signer (production always signs with one custodial system wallet); use the `mint_to_player.test.ts` helper pattern (a single `fundedAdmin` passed into `registeredAdmin`), not one random admin per user.

- [ ] **Step 1: Write the test file**

Create `apps/on-chain-program-e2e/tests/general_mode/transfer_token.test.ts`:

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
import {
  findAssociatedTokenPda,
  fetchToken,
  TOKEN_PROGRAM_ADDRESS,
  isTokenError,
  TOKEN_ERROR__INSUFFICIENT_FUNDS,
} from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync,
  getTransferTokenInstructionAsync,
  findGamePda,
  findUserPda,
  fetchGame,
  GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT,
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

// Registers `username` under an already-funded, shared `admin` — required
// because `transfer_token`'s `sender`/`recipient` PDAs are both seeded off
// the SAME `admin.key()` (see the note above this task's Step 1).
async function registeredAdmin(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  username: string,
): Promise<void> {
  const createUserInstruction = await getCreateUserInstructionAsync({
    admin,
    username,
    salt: new Uint8Array(16),
    passwordHash: new Uint8Array(64),
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createUserInstruction);
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
  admin: KeyPairSigner,
  hostUsername: string,
  idFill: number,
) {
  await registeredAdmin(rpc, rpcSubscriptions, admin, hostUsername);
  const id = gameId(idFill);
  const createGameInstruction = await getCreateGameInstructionAsync({
    admin,
    username: hostUsername,
    gameId: id,
    name: "Transfer Test Game",
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createGameInstruction);
  const [gameAddress] = await findGamePda({ gameId: id });
  return { id, gameAddress };
}

async function joinedPlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  username: string,
) {
  await registeredAdmin(rpc, rpcSubscriptions, admin, username);
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
  return { userAddress, playerAta };
}

async function fundedPlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  hostUsername: string,
  username: string,
  amount: bigint,
) {
  const { playerAta } = await joinedPlayer(rpc, rpcSubscriptions, admin, gameIdBytes, mint, username);
  const mintInstruction = await getMintToPlayerInstructionAsync({
    admin,
    username: hostUsername,
    gameId: gameIdBytes,
    playerUsername: username,
    playerAta,
    amount,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, mintInstruction);
  return { playerAta };
}

describe("transfer_token instruction", () => {
  it("moves tokens from the sender's ATA to the recipient's ATA", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "transferhost1", 301);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta: senderAta } = await fundedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferhost1",
      "transfersender1",
      1000n,
    );
    const { playerAta: recipientAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferrecipient1",
    );

    const transferInstruction = await getTransferTokenInstructionAsync({
      admin,
      gameId: id,
      senderUsername: "transfersender1",
      recipientUsername: "transferrecipient1",
      senderAta,
      recipientAta,
      amount: 300n,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, transferInstruction);

    const senderToken = await fetchToken(rpc, senderAta);
    const recipientToken = await fetchToken(rpc, recipientAta);
    expect(senderToken.data.amount).toBe(700n);
    expect(recipientToken.data.amount).toBe(300n);
  }, 30_000);

  it("rejects a self-transfer with SelfTransfer", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "transferhost2", 302);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await fundedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferhost2",
      "transferself2",
      500n,
    );

    const transferInstruction = await getTransferTokenInstructionAsync({
      admin,
      gameId: id,
      senderUsername: "transferself2",
      recipientUsername: "transferself2",
      senderAta: playerAta,
      recipientAta: playerAta,
      amount: 100n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the self-transfer to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER,
        ),
      ).toBe(true);
    }

    const token = await fetchToken(rpc, playerAta);
    expect(token.data.amount).toBe(500n);
  }, 30_000);

  it("rejects a transfer to a non-member with PlayerNotInGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "transferhost3", 303);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta: senderAta } = await fundedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferhost3",
      "transfersender3",
      500n,
    );
    // Registered (under the same shared admin) but never joined — no ATA exists yet.
    const nonMemberUsername = "transfernonmember3";
    await registeredAdmin(rpc, rpcSubscriptions, admin, nonMemberUsername);
    const [nonMemberUserAddress] = await findUserPda({ username: nonMemberUsername, admin: admin.address });
    const [nonMemberAta] = await findAssociatedTokenPda({
      owner: nonMemberUserAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const transferInstruction = await getTransferTokenInstructionAsync({
      admin,
      gameId: id,
      senderUsername: "transfersender3",
      recipientUsername: nonMemberUsername,
      senderAta,
      recipientAta: nonMemberAta,
      amount: 100n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the transfer to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
        ),
      ).toBe(true);
    }

    const senderToken = await fetchToken(rpc, senderAta);
    expect(senderToken.data.amount).toBe(500n);
  }, 30_000);

  it("rejects a zero amount with InvalidTransferAmount", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "transferhost4", 304);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta: senderAta } = await fundedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferhost4",
      "transfersender4",
      500n,
    );
    const { playerAta: recipientAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferrecipient4",
    );

    const transferInstruction = await getTransferTokenInstructionAsync({
      admin,
      gameId: id,
      senderUsername: "transfersender4",
      recipientUsername: "transferrecipient4",
      senderAta,
      recipientAta,
      amount: 0n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the transfer to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT,
        ),
      ).toBe(true);
    }

    const senderToken = await fetchToken(rpc, senderAta);
    const recipientToken = await fetchToken(rpc, recipientAta);
    expect(senderToken.data.amount).toBe(500n);
    expect(recipientToken.data.amount).toBe(0n);
  }, 30_000);

  it("rejects a transfer exceeding the sender's balance via the SPL token program's native error", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "transferhost5", 305);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta: senderAta } = await fundedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferhost5",
      "transfersender5",
      100n,
    );
    const { playerAta: recipientAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferrecipient5",
    );

    const transferInstruction = await getTransferTokenInstructionAsync({
      admin,
      gameId: id,
      senderUsername: "transfersender5",
      recipientUsername: "transferrecipient5",
      senderAta,
      recipientAta,
      amount: 500n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the transfer to be rejected");
    } catch (error) {
      expect(
        isTokenError(unwrapSimulationError(error), transactionMessage, TOKEN_ERROR__INSUFFICIENT_FUNDS),
      ).toBe(true);
    }

    const senderToken = await fetchToken(rpc, senderAta);
    const recipientToken = await fetchToken(rpc, recipientAta);
    expect(senderToken.data.amount).toBe(100n);
    expect(recipientToken.data.amount).toBe(0n);
  }, 30_000);
});
```

- [ ] **Step 2: Run the e2e program test suite**

Run: `just test-e2e-program`
Expected: PASS — all five new `transfer_token` scenarios green, no regressions in sibling test files.

- [ ] **Step 3: Commit**

```bash
git add apps/on-chain-program-e2e/tests/general_mode/transfer_token.test.ts
git commit -m "test(009): add transfer_token e2e program tests"
```

---

### Task 4: Chunking helper (`transfer-chunking.ts`)

**Files:**
- Create: `apps/frontend/src/server/actions/transfer-chunking.ts`
- Create: `apps/frontend/src/server/actions/transfer-chunking.test.ts`

**Interfaces:**
- Consumes: `getTransferTokenInstructionAsync` (from `on-chain-client`, Task 2) only in tests, to build real instructions; `getTransactionMessageSize`, `TRANSACTION_SIZE_LIMIT`, `createTransactionMessage`, `setTransactionMessageFeePayer`, `appendTransactionMessageInstructions` (from `@solana/kit`).
- Produces: `chunkInstructionsBySize(instructions: readonly Instruction[], feePayer: Address): Instruction[][]` — consumed by Task 5's `transferTokens`.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/server/actions/transfer-chunking.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  address,
  generateKeyPairSigner,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  appendTransactionMessageInstructions,
  getTransactionMessageSize,
  TRANSACTION_SIZE_LIMIT,
} from "@solana/kit";
import { getTransferTokenInstructionAsync } from "on-chain-client";
import { chunkInstructionsBySize } from "./transfer-chunking";

const GAME_ID = new Uint8Array(16).fill(9);
// Worst case per design.md decision 3: usernames at the 32-byte max.
const MAX_USERNAME = "a".repeat(30);

async function buildInstructions(count: number) {
  const admin = await generateKeyPairSigner();
  const senderAta = await generateKeyPairSigner();
  const instructions = [];
  for (let i = 0; i < count; i++) {
    const recipientAta = await generateKeyPairSigner();
    instructions.push(
      await getTransferTokenInstructionAsync({
        admin,
        gameId: GAME_ID,
        senderUsername: `${MAX_USERNAME}s${i % 10}`,
        recipientUsername: `${MAX_USERNAME}r${i % 10}`,
        senderAta: senderAta.address,
        recipientAta: recipientAta.address,
        amount: 100n,
      }),
    );
  }
  return { admin, instructions };
}

describe("chunkInstructionsBySize", () => {
  it("returns no chunks for an empty instruction list", () => {
    expect(
      chunkInstructionsBySize([], address("Prog1111111111111111111111111111111111111")),
    ).toEqual([]);
  });

  it("packs a small batch into a single chunk", async () => {
    const { admin, instructions } = await buildInstructions(2);
    const chunks = chunkInstructionsBySize(instructions, admin.address);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
  });

  it("splits a 19-recipient max-username-length batch across multiple transactions, each within the real size limit", async () => {
    const { admin, instructions } = await buildInstructions(19);
    const chunks = chunkInstructionsBySize(instructions, admin.address);

    const totalRecipients = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(totalRecipients).toBe(19);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      const message = appendTransactionMessageInstructions(
        chunk,
        setTransactionMessageFeePayer(admin.address, createTransactionMessage({ version: 0 })),
      );
      expect(getTransactionMessageSize(message)).toBeLessThanOrEqual(TRANSACTION_SIZE_LIMIT);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter frontend run test -- transfer-chunking`
Expected: FAIL — `./transfer-chunking` module doesn't exist yet.

- [ ] **Step 3: Implement `chunkInstructionsBySize`**

Create `apps/frontend/src/server/actions/transfer-chunking.ts`:

```ts
import {
  createTransactionMessage,
  setTransactionMessageFeePayer,
  appendTransactionMessageInstructions,
  getTransactionMessageSize,
  TRANSACTION_SIZE_LIMIT,
  type Address,
  type Instruction,
} from "@solana/kit";

// Safety margin below @solana/kit's real TRANSACTION_SIZE_LIMIT (1232
// bytes) — compact-u16 length-prefix widths can shift by a byte at certain
// thresholds, so packing right up to the hard limit risks an off-by-one
// overflow once blockhash/signatures are attached at send time. See
// openspec/changes/general-mode-transfers/design.md decision 3.
const CHUNK_BYTE_BUDGET = TRANSACTION_SIZE_LIMIT - 32;

// Chosen defensive ceiling, well above what transfer_token ever needs (44
// accounts at the 19-recipient worst case) — cheap protection against
// future account additions to the instruction, not a protocol-mandated
// number (see design.md decision 3).
const MAX_ACCOUNTS_PER_CHUNK = 64;

function uniqueAccountCount(instructions: readonly Instruction[]): number {
  const keys = new Set<string>();
  for (const instruction of instructions) {
    for (const account of instruction.accounts ?? []) {
      keys.add(account.address);
    }
  }
  return keys.size;
}

// Packs instructions into the fewest transactions that each fit Solana's
// real per-transaction size limit, measured by actually compiling each
// candidate message via @solana/kit — no hand-rolled byte estimator, so
// this stays correct regardless of username length or future instruction
// changes. See design.md decision 3 for why a hardcoded per-chunk recipient
// count was rejected.
export function chunkInstructionsBySize(
  instructions: readonly Instruction[],
  feePayer: Address,
): Instruction[][] {
  const chunks: Instruction[][] = [];
  let current: Instruction[] = [];

  for (const instruction of instructions) {
    const candidate = [...current, instruction];
    const candidateMessage = appendTransactionMessageInstructions(
      candidate,
      setTransactionMessageFeePayer(feePayer, createTransactionMessage({ version: 0 })),
    );
    const fits =
      getTransactionMessageSize(candidateMessage) <= CHUNK_BYTE_BUDGET &&
      uniqueAccountCount(candidate) <= MAX_ACCOUNTS_PER_CHUNK;

    if (fits || current.length === 0) {
      current = candidate;
    } else {
      chunks.push(current);
      current = [instruction];
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter frontend run test -- transfer-chunking`
Expected: PASS — all three tests green, including the 19-recipient worst case.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm --filter frontend run lint && pnpm --filter frontend run typecheck`
Expected: both PASS with no changes needed.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/server/actions/transfer-chunking.ts apps/frontend/src/server/actions/transfer-chunking.test.ts
git commit -m "feat(009): add size-aware instruction chunking for batched transfers"
```

---

### Task 5: `transferTokens` Server Action

**Files:**
- Modify: `apps/frontend/src/server/actions/game.ts`
- Modify: `apps/frontend/src/server/actions/game.test.ts`

**Interfaces:**
- Consumes: `chunkInstructionsBySize` (Task 4); `getTransferTokenInstructionAsync`, `GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER`, `GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT`, `GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME`, `isGameTokenWalletError` (from `on-chain-client`); `fetchMaybeToken`, `isTokenError`, `TOKEN_ERROR__INSUFFICIENT_FUNDS`, `findAssociatedTokenPda`, `TOKEN_PROGRAM_ADDRESS` (from `@solana-program/token`); `findUserPda`, `fetchMaybeGame` (existing, already imported); `getCurrentUsername` (existing); `signAndSendTransaction` (existing).
- Produces: `TransferRecipientInput { recipientUsername: string; amount: number }`, `TransferTokensInput { gameAddress: string; recipients: TransferRecipientInput[] }`, `TransferTokensResult = { ok: true } | { ok: false; error: string; transfersApplied: number; transfersTotal: number }`, `transferTokens(input: TransferTokensInput): Promise<TransferTokensResult>` — consumed by Task 6's `SendTokensForm`.

- [ ] **Step 1: Write the failing tests for pre-chain validation**

Edit `apps/frontend/src/server/actions/game.test.ts`. This step **replaces** three existing blocks near the top of the file (the `on-chain-client` mock's hoisted fns/codes and its `vi.mock` call, and the `@solana-program/token` mock's hoisted fns and its `vi.mock` call) — do not add second, duplicate `vi.hoisted`/`vi.mock` calls alongside the originals; each module can only be `vi.mock`'d once per file. The blocks below show each one's complete final contents.

Replace the existing `mockFindUserPda`/…/`mockIsGameTokenWalletError` hoisted block, the error-code hoisted block, and the `vi.mock("on-chain-client", ...)` call with:

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
  mockGetTransferTokenInstructionAsync,
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
  mockGetTransferTokenInstructionAsync: vi.fn(),
  mockFetchAllUser: vi.fn(),
  mockIsGameTokenWalletError: vi.fn(),
}));
const {
  GAME_FULL_CODE,
  ALREADY_JOINED_GAME_CODE,
  NOT_GAME_ADMIN_CODE,
  PLAYER_NOT_IN_GAME_CODE,
  INVALID_DEPOSIT_AMOUNT_CODE,
  SELF_TRANSFER_CODE,
  INVALID_TRANSFER_AMOUNT_CODE,
} = vi.hoisted(() => ({
  GAME_FULL_CODE: 0x1774,
  ALREADY_JOINED_GAME_CODE: 0x1775,
  NOT_GAME_ADMIN_CODE: 0x1777,
  PLAYER_NOT_IN_GAME_CODE: 0x1778,
  INVALID_DEPOSIT_AMOUNT_CODE: 0x1779,
  SELF_TRANSFER_CODE: 0x177a,
  INVALID_TRANSFER_AMOUNT_CODE: 0x177b,
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
  getTransferTokenInstructionAsync: mockGetTransferTokenInstructionAsync,
  fetchAllUser: mockFetchAllUser,
  isGameTokenWalletError: mockIsGameTokenWalletError,
  GAME_TOKEN_WALLET_ERROR__GAME_FULL: GAME_FULL_CODE,
  GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME: ALREADY_JOINED_GAME_CODE,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN: NOT_GAME_ADMIN_CODE,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME: PLAYER_NOT_IN_GAME_CODE,
  GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT: INVALID_DEPOSIT_AMOUNT_CODE,
  GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER: SELF_TRANSFER_CODE,
  GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT: INVALID_TRANSFER_AMOUNT_CODE,
}));

```

Similarly, replace the existing `mockFindAssociatedTokenPda`/`mockGetTokenDecoder` hoisted block and its `vi.mock("@solana-program/token", ...)` call with:

```ts
const { mockFindAssociatedTokenPda, mockGetTokenDecoder, mockFetchMaybeToken, mockIsTokenError } =
  vi.hoisted(() => ({
    mockFindAssociatedTokenPda: vi.fn(),
    mockGetTokenDecoder: vi.fn(),
    mockFetchMaybeToken: vi.fn(),
    mockIsTokenError: vi.fn(),
  }));
const { TOKEN_INSUFFICIENT_FUNDS_CODE } = vi.hoisted(() => ({ TOKEN_INSUFFICIENT_FUNDS_CODE: 1 }));
vi.mock("@solana-program/token", () => ({
  findAssociatedTokenPda: mockFindAssociatedTokenPda,
  getTokenDecoder: mockGetTokenDecoder,
  fetchMaybeToken: mockFetchMaybeToken,
  isTokenError: mockIsTokenError,
  TOKEN_ERROR__INSUFFICIENT_FUNDS: TOKEN_INSUFFICIENT_FUNDS_CODE,
  TOKEN_PROGRAM_ADDRESS: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
}));
```

Finally, add a new mock block (this one is a genuine addition, not a replacement — `../transfer-chunking` isn't mocked anywhere yet) directly below it:

```ts
const { mockChunkInstructionsBySize } = vi.hoisted(() => ({ mockChunkInstructionsBySize: vi.fn() }));
vi.mock("../transfer-chunking", () => ({ chunkInstructionsBySize: mockChunkInstructionsBySize }));
```

Update the final import line:

```ts
import {
  createGame,
  joinGame,
  depositToPlayer,
  transferTokens,
  listBrowseGames,
  listMyMemberGames,
  fetchGameDetail,
} from "./game";
```

Add the new `describe` block at the end of the file:

```ts
describe("transferTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("alice");
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
    mockFetchMaybeToken.mockResolvedValue({ exists: true, data: { amount: 100_000n } });
    mockGetTransferTokenInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockChunkInstructionsBySize.mockImplementation((instructions: unknown[]) => [instructions]);
    mockSignAndSendTransaction.mockResolvedValue(undefined);
    mockIsGameTokenWalletError.mockReturnValue(false);
    mockIsTokenError.mockReturnValue(false);
  });

  it("rejects when not signed in, without touching the chain", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(
      transferTokens({ gameAddress: GAME_ADDRESS, recipients: [{ recipientUsername: "bob", amount: 5 }] }),
    ).resolves.toEqual({ ok: false, error: "Not signed in", transfersApplied: 0, transfersTotal: 1 });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects an empty recipient list before touching the chain", async () => {
    await expect(transferTokens({ gameAddress: GAME_ADDRESS, recipients: [] })).resolves.toEqual({
      ok: false,
      error: "Add at least one recipient",
      transfersApplied: 0,
      transfersTotal: 0,
    });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects a duplicate recipient before touching the chain", async () => {
    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [
        { recipientUsername: "bob", amount: 5 },
        { recipientUsername: "bob", amount: 3 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects a self-transfer before touching the chain", async () => {
    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [{ recipientUsername: "alice", amount: 5 }],
    });
    expect(result).toEqual({
      ok: false,
      error: "Cannot transfer tokens to yourself",
      transfersApplied: 0,
      transfersTotal: 1,
    });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects a zero amount before touching the chain", async () => {
    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [{ recipientUsername: "bob", amount: 0 }],
    });
    expect(result).toEqual({
      ok: false,
      error: "Amount must be greater than zero",
      transfersApplied: 0,
      transfersTotal: 1,
    });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects an amount whose base-unit conversion exceeds u64::MAX, before touching the chain", async () => {
    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [{ recipientUsername: "bob", amount: 1e29 }],
    });
    expect(result).toEqual({
      ok: false,
      error: "Amount is too large",
      transfersApplied: 0,
      transfersTotal: 1,
    });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter frontend run test -- game.test.ts -t transferTokens`
Expected: FAIL — `transferTokens` is not exported from `./game` yet.

- [ ] **Step 3: Implement pre-chain validation**

Edit `apps/frontend/src/server/actions/game.ts`. Extend the imports:

```ts
import {
  findUserPda,
  findRegistryPda,
  fetchMaybeRegistry,
  fetchGame,
  fetchMaybeGame,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync,
  getTransferTokenInstructionAsync,
  fetchAllUser,
  isGameTokenWalletError,
  GAME_TOKEN_WALLET_ERROR__GAME_FULL,
  GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT,
  GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER,
  GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT,
  type GameMode,
} from "on-chain-client";
import {
  findAssociatedTokenPda,
  fetchMaybeToken,
  getTokenDecoder,
  isTokenError,
  TOKEN_ERROR__INSUFFICIENT_FUNDS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { normalizeGameName, validateGameName } from "@/lib/game-name";
import { getSolanaContext } from "../connection";
import { generateGameId } from "../game-id";
import { signAndSendTransaction } from "../transaction";
import { chunkInstructionsBySize } from "../transfer-chunking";
import { getCurrentUsername } from "./auth";
```

Add, after `depositToPlayer`:

```ts
export interface TransferRecipientInput {
  recipientUsername: string;
  amount: number;
}

export interface TransferTokensInput {
  gameAddress: string;
  recipients: TransferRecipientInput[];
}

export type TransferTokensResult =
  | { ok: true }
  | { ok: false; error: string; transfersApplied: number; transfersTotal: number };

export async function transferTokens(input: TransferTokensInput): Promise<TransferTokensResult> {
  const transfersTotal = input.recipients.length;
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in", transfersApplied: 0, transfersTotal };
  }

  if (transfersTotal === 0) {
    return { ok: false, error: "Add at least one recipient", transfersApplied: 0, transfersTotal };
  }

  const seenRecipients = new Set<string>();
  for (const recipient of input.recipients) {
    if (seenRecipients.has(recipient.recipientUsername)) {
      return {
        ok: false,
        error: `Duplicate recipient: ${recipient.recipientUsername}`,
        transfersApplied: 0,
        transfersTotal,
      };
    }
    seenRecipients.add(recipient.recipientUsername);
    if (recipient.recipientUsername === username) {
      return {
        ok: false,
        error: "Cannot transfer tokens to yourself",
        transfersApplied: 0,
        transfersTotal,
      };
    }
  }

  // Same base-unit guards as depositToPlayer, applied per recipient: reject
  // non-positive/non-finite amounts before BigInt/Math.round, then amounts
  // that round to 0 base units, then amounts that overflow u64.
  const baseUnitsAmounts: bigint[] = [];
  for (const recipient of input.recipients) {
    if (!(recipient.amount > 0) || !Number.isFinite(recipient.amount * 100)) {
      return {
        ok: false,
        error: "Amount must be greater than zero",
        transfersApplied: 0,
        transfersTotal,
      };
    }
    const baseUnits = BigInt(Math.round(recipient.amount * 100));
    if (baseUnits <= 0n) {
      return {
        ok: false,
        error: "Amount must be greater than zero",
        transfersApplied: 0,
        transfersTotal,
      };
    }
    if (baseUnits > 18446744073709551615n) {
      return { ok: false, error: "Amount is too large", transfersApplied: 0, transfersTotal };
    }
    baseUnitsAmounts.push(baseUnits);
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter frontend run test -- game.test.ts -t transferTokens`
Expected: the six pre-chain validation tests PASS.

- [ ] **Step 5: Write the failing test for the pre-flight balance check**

Add to the `describe("transferTokens", ...)` block:

```ts
  it("rejects when the batch total exceeds the sender's balance, before sending any transaction", async () => {
    mockFetchMaybeToken.mockResolvedValue({ exists: true, data: { amount: 400n } });
    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [{ recipientUsername: "bob", amount: 5 }],
    });
    expect(result).toEqual({
      ok: false,
      error: "Not enough balance for this transfer",
      transfersApplied: 0,
      transfersTotal: 1,
    });
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("treats a sender with no ATA yet as a zero balance", async () => {
    mockFetchMaybeToken.mockResolvedValue({ exists: false });
    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [{ recipientUsername: "bob", amount: 5 }],
    });
    expect(result.ok).toBe(false);
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the game doesn't exist", async () => {
    mockFetchMaybeGame.mockResolvedValue({ exists: false });
    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [{ recipientUsername: "bob", amount: 5 }],
    });
    expect(result).toEqual({
      ok: false,
      error: "Game not found",
      transfersApplied: 0,
      transfersTotal: 1,
    });
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pnpm --filter frontend run test -- game.test.ts -t transferTokens`
Expected: FAIL — the current implementation always returns `{ ok: true }` after validation, never checks the game or balance.

- [ ] **Step 7: Implement the game lookup and pre-flight balance check**

In `transferTokens`, replace the final `return { ok: true };` with:

```ts
  const totalBaseUnits = baseUnitsAmounts.reduce((sum, amount) => sum + amount, 0n);

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();

  const game = await fetchMaybeGame(rpc, input.gameAddress as Address);
  if (!game.exists) {
    return { ok: false, error: "Game not found", transfersApplied: 0, transfersTotal };
  }

  const [senderUserAddress] = await findUserPda(
    { username, admin: adminSigner.address },
    { programAddress },
  );
  const [senderAta] = await findAssociatedTokenPda({
    owner: senderUserAddress,
    mint: game.data.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  // Best-effort pre-flight check against the sender's balance at request
  // time — a concurrent transfer between this check and chunk execution can
  // still make a later chunk fail; that's handled by the
  // stop-on-first-failure send loop below, not by this check (see design.md
  // decision 5).
  const senderToken = await fetchMaybeToken(rpc, senderAta);
  const senderBalance = senderToken.exists ? senderToken.data.amount : 0n;
  if (senderBalance < totalBaseUnits) {
    return {
      ok: false,
      error: "Not enough balance for this transfer",
      transfersApplied: 0,
      transfersTotal,
    };
  }

  return { ok: true };
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter frontend run test -- game.test.ts -t transferTokens`
Expected: PASS — all nine tests so far green.

- [ ] **Step 9: Write the failing tests for instruction composition and sequential sending**

Add to the `describe("transferTokens", ...)` block:

```ts
  it("composes one instruction per recipient and sends a single chunk on success", async () => {
    await expect(
      transferTokens({
        gameAddress: GAME_ADDRESS,
        recipients: [
          { recipientUsername: "bob", amount: 5 },
          { recipientUsername: "carol", amount: 2.5 },
        ],
      }),
    ).resolves.toEqual({ ok: true });

    expect(mockGetTransferTokenInstructionAsync).toHaveBeenCalledTimes(2);
    expect(mockGetTransferTokenInstructionAsync).toHaveBeenCalledWith(
      {
        admin: { address: ADMIN_ADDRESS },
        gameId: expect.anything(),
        senderUsername: "alice",
        recipientUsername: "bob",
        senderAta: PLAYER_ATA_ADDRESS,
        recipientAta: PLAYER_ATA_ADDRESS,
        amount: 500n,
      },
      { programAddress: PROGRAM_ADDRESS },
    );
    expect(mockChunkInstructionsBySize).toHaveBeenCalledTimes(1);
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(1);
  });

  it("sends each chunk sequentially, stops at the first chunk failure, and reports transfersApplied", async () => {
    mockChunkInstructionsBySize.mockReturnValue([["ix1"], ["ix2"], ["ix3"]]);
    mockSignAndSendTransaction
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("simulation failed"));
    mockIsGameTokenWalletError.mockReturnValue(false);
    mockIsTokenError.mockImplementation((_error, _tx, code) => code === TOKEN_INSUFFICIENT_FUNDS_CODE);

    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [
        { recipientUsername: "bob", amount: 1 },
        { recipientUsername: "carol", amount: 1 },
        { recipientUsername: "dave", amount: 1 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: "Not enough balance for this transfer",
      transfersApplied: 2,
      transfersTotal: 3,
    });
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(3);
  });

  it("maps an on-chain SelfTransfer rejection (bypassed client-side check) to the friendly message", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("simulation failed"));
    mockIsGameTokenWalletError.mockImplementation((_error, _tx, code) => code === SELF_TRANSFER_CODE);
    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [{ recipientUsername: "bob", amount: 5 }],
    });
    expect(result).toEqual({
      ok: false,
      error: "Cannot transfer tokens to yourself",
      transfersApplied: 0,
      transfersTotal: 1,
    });
  });

  it("maps an on-chain InvalidTransferAmount rejection to the friendly message", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("simulation failed"));
    mockIsGameTokenWalletError.mockImplementation(
      (_error, _tx, code) => code === INVALID_TRANSFER_AMOUNT_CODE,
    );
    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [{ recipientUsername: "bob", amount: 5 }],
    });
    expect(result).toEqual({
      ok: false,
      error: "Amount must be greater than zero",
      transfersApplied: 0,
      transfersTotal: 1,
    });
  });

  it("maps an on-chain PlayerNotInGame rejection to the friendly message", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("simulation failed"));
    mockIsGameTokenWalletError.mockImplementation(
      (_error, _tx, code) => code === PLAYER_NOT_IN_GAME_CODE,
    );
    const result = await transferTokens({
      gameAddress: GAME_ADDRESS,
      recipients: [{ recipientUsername: "bob", amount: 5 }],
    });
    expect(result).toEqual({
      ok: false,
      error: "That player hasn't joined this game",
      transfersApplied: 0,
      transfersTotal: 1,
    });
  });

  it("re-throws an on-chain error that isn't a recognized transfer_token or token program error", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("network blip"));
    mockIsGameTokenWalletError.mockReturnValue(false);
    mockIsTokenError.mockReturnValue(false);
    await expect(
      transferTokens({ gameAddress: GAME_ADDRESS, recipients: [{ recipientUsername: "bob", amount: 5 }] }),
    ).rejects.toThrow("network blip");
  });
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `pnpm --filter frontend run test -- game.test.ts -t transferTokens`
Expected: FAIL — no instructions are built or sent yet.

- [ ] **Step 11: Implement instruction composition, chunked sequential send, and error mapping**

In `transferTokens`, replace the final `return { ok: true };` with:

```ts
  const instructions = await Promise.all(
    input.recipients.map(async (recipient, index) => {
      const [recipientUserAddress] = await findUserPda(
        { username: recipient.recipientUsername, admin: adminSigner.address },
        { programAddress },
      );
      const [recipientAta] = await findAssociatedTokenPda({
        owner: recipientUserAddress,
        mint: game.data.mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      return getTransferTokenInstructionAsync(
        {
          admin: adminSigner,
          gameId: game.data.gameId,
          senderUsername: username,
          recipientUsername: recipient.recipientUsername,
          senderAta,
          recipientAta,
          amount: baseUnitsAmounts[index],
        },
        { programAddress },
      );
    }),
  );

  const chunks = chunkInstructionsBySize(instructions, adminSigner.address);

  let transfersApplied = 0;
  for (const chunk of chunks) {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions(chunk, tx),
    );
    try {
      await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });
    } catch (error) {
      const cause = unwrapSimulationError(error);
      let friendly: string;
      if (isGameTokenWalletError(cause, transactionMessage, GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER)) {
        friendly = "Cannot transfer tokens to yourself";
      } else if (
        isGameTokenWalletError(cause, transactionMessage, GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT)
      ) {
        friendly = "Amount must be greater than zero";
      } else if (
        isGameTokenWalletError(cause, transactionMessage, GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME)
      ) {
        friendly = "That player hasn't joined this game";
      } else if (isTokenError(cause, transactionMessage, TOKEN_ERROR__INSUFFICIENT_FUNDS)) {
        friendly = "Not enough balance for this transfer";
      } else {
        throw error;
      }
      return { ok: false, error: friendly, transfersApplied, transfersTotal };
    }
    transfersApplied += chunk.length;
  }

  return { ok: true };
```

Add `Instruction` and the transaction-building imports already used elsewhere in the file to the top import list if not already present (`createTransactionMessage`, `pipe`, `setTransactionMessageFeePayerSigner`, `setTransactionMessageLifetimeUsingBlockhash`, `appendTransactionMessageInstructions` are already imported at the top of `game.ts` — no change needed there).

- [ ] **Step 12: Run the tests to verify they pass**

Run: `pnpm --filter frontend run test -- game.test.ts`
Expected: PASS — every `transferTokens` test green, and no regressions in `createGame`/`joinGame`/`depositToPlayer`/`listBrowseGames`/`listMyMemberGames`/`fetchGameDetail`.

- [ ] **Step 13: Lint and typecheck**

Run: `pnpm --filter frontend run lint && pnpm --filter frontend run typecheck`
Expected: both PASS with no changes needed.

- [ ] **Step 14: Commit**

```bash
git add apps/frontend/src/server/actions/game.ts apps/frontend/src/server/actions/game.test.ts
git commit -m "feat(009): add transferTokens server action"
```

---

### Task 6: `SendTokensForm` on the game detail page

**Files:**
- Create: `apps/frontend/src/app/(app)/games/[address]/SendTokensForm.tsx`
- Create: `apps/frontend/src/app/(app)/games/[address]/SendTokensForm.test.tsx`
- Modify: `apps/frontend/src/app/(app)/games/[address]/page.tsx`
- Modify: `apps/frontend/src/app/(app)/games/[address]/page.test.tsx`

**Interfaces:**
- Consumes: `transferTokens`, `TransferTokensResult`, `GamePlayer` (from `@/server/actions/game`, Task 5); `Button`, `Input`, `Alert` (from `@/components/ui/*`); `GameMode` (from `on-chain-client`).
- Produces: default-exported `SendTokensForm({ gameAddress: string; players: GamePlayer[]; currentUsername: string }): JSX.Element`, rendered by `page.tsx` for General Mode games — consumed by Task 7's Playwright spec via its rendered labels/buttons.

- [ ] **Step 1: Write the failing component test**

Create `apps/frontend/src/app/(app)/games/[address]/SendTokensForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockTransferTokens } = vi.hoisted(() => ({ mockTransferTokens: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ transferTokens: mockTransferTokens }));

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import SendTokensForm from "./SendTokensForm";

const PLAYERS = [
  { username: "alice", balance: 4, isAdmin: true },
  { username: "bob", balance: 1.5, isAdmin: false },
  { username: "carol", balance: 0, isAdmin: false },
];

describe("SendTokensForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows one recipient row by default, excluding the current user", () => {
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    const pickers = screen.getAllByLabelText("Recipient");
    expect(pickers).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "alice" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "bob" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "carol" })).toBeInTheDocument();
  });

  it("adds and removes recipient rows", () => {
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add recipient" }));
    expect(screen.getAllByLabelText("Recipient")).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove recipient" })[0]);
    expect(screen.getAllByLabelText("Recipient")).toHaveLength(1);
  });

  it("excludes a recipient already chosen in another row from every other row's picker", () => {
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add recipient" }));
    const pickers = screen.getAllByLabelText("Recipient");
    fireEvent.change(pickers[0], { target: { value: "bob" } });

    const secondRowOptions = screen.getAllByLabelText("Recipient")[1].querySelectorAll("option");
    const secondRowUsernames = Array.from(secondRowOptions).map((option) => option.textContent);
    expect(secondRowUsernames).not.toContain("bob");
    expect(secondRowUsernames).toContain("carol");
  });

  it("rejects submitting with an incomplete row", () => {
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.change(screen.getAllByLabelText("Recipient")[0], { target: { value: "bob" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(screen.getByTestId("transfer-error")).toBeInTheDocument();
    expect(mockTransferTokens).not.toHaveBeenCalled();
  });

  it("submits the whole batch, refreshes, and resets on success", async () => {
    mockTransferTokens.mockResolvedValue({ ok: true });
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add recipient" }));
    const pickers = screen.getAllByLabelText("Recipient");
    const amounts = screen.getAllByLabelText("Amount");
    fireEvent.change(pickers[0], { target: { value: "bob" } });
    fireEvent.change(amounts[0], { target: { value: "5" } });
    fireEvent.change(pickers[1], { target: { value: "carol" } });
    fireEvent.change(amounts[1], { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(mockTransferTokens).toHaveBeenCalledWith({
      gameAddress: "Game1",
      recipients: [
        { recipientUsername: "bob", amount: 5 },
        { recipientUsername: "carol", amount: 2.5 },
      ],
    });
  });

  it("shows a count-naming partial-failure message and does not reset the form", async () => {
    mockTransferTokens.mockResolvedValue({
      ok: false,
      error: "Not enough balance for this transfer",
      transfersApplied: 1,
      transfersTotal: 2,
    });
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.change(screen.getAllByLabelText("Recipient")[0], { target: { value: "bob" } });
    fireEvent.change(screen.getAllByLabelText("Amount")[0], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() =>
      expect(screen.getByTestId("transfer-error")).toHaveTextContent(
        "Sent to 1 of 2 recipients, then failed: Not enough balance for this transfer",
      ),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("shows a plain validation-style message when nothing was sent", async () => {
    mockTransferTokens.mockResolvedValue({
      ok: false,
      error: "Not enough balance for this transfer",
      transfersApplied: 0,
      transfersTotal: 1,
    });
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.change(screen.getAllByLabelText("Recipient")[0], { target: { value: "bob" } });
    fireEvent.change(screen.getAllByLabelText("Amount")[0], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() =>
      expect(screen.getByTestId("transfer-error")).toHaveTextContent(
        "Not enough balance for this transfer",
      ),
    );
    expect(screen.getByTestId("transfer-error")).not.toHaveTextContent("Sent to");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- SendTokensForm`
Expected: FAIL — `./SendTokensForm` doesn't exist yet.

- [ ] **Step 3: Implement `SendTokensForm`**

Create `apps/frontend/src/app/(app)/games/[address]/SendTokensForm.tsx`:

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { transferTokens, type GamePlayer } from "@/server/actions/game";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

interface RecipientRow {
  id: number;
  username: string;
  amount: string;
}

let nextRowId = 0;
function newRow(): RecipientRow {
  return { id: nextRowId++, username: "", amount: "" };
}

export default function SendTokensForm({
  gameAddress,
  players,
  currentUsername,
}: {
  gameAddress: string;
  players: GamePlayer[];
  currentUsername: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<RecipientRow[]>([newRow()]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const otherPlayers = players.filter((player) => player.username !== currentUsername);

  function optionsForRow(rowId: number) {
    const chosenElsewhere = new Set(
      rows.filter((row) => row.id !== rowId && row.username).map((row) => row.username),
    );
    return otherPlayers.filter((player) => !chosenElsewhere.has(player.username));
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  }

  function updateRow(id: number, field: "username" | "amount", value: string) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const filled = rows.filter((row) => row.username || row.amount);
    if (filled.length === 0 || filled.some((row) => !row.username || !(Number(row.amount) > 0))) {
      setError("Every recipient needs a player and an amount greater than zero");
      return;
    }

    startTransition(async () => {
      try {
        const result = await transferTokens({
          gameAddress,
          recipients: filled.map((row) => ({
            recipientUsername: row.username,
            amount: Number(row.amount),
          })),
        });
        if (result.ok) {
          setRows([newRow()]);
          router.refresh();
        } else {
          setError(
            result.transfersApplied > 0
              ? `Sent to ${result.transfersApplied} of ${result.transfersTotal} recipients, then failed: ${result.error}`
              : result.error,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-extrabold text-text-primary">Send tokens</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <select
              aria-label="Recipient"
              value={row.username}
              onChange={(event) => updateRow(row.id, "username", event.target.value)}
              className="glass-input h-11 flex-1 px-4 text-sm text-text-primary"
            >
              <option value="">Select player…</option>
              {optionsForRow(row.id).map((player) => (
                <option key={player.username} value={player.username}>
                  {player.username}
                </option>
              ))}
            </select>
            <Input
              aria-label="Amount"
              type="number"
              step="0.01"
              value={row.amount}
              onChange={(event) => updateRow(row.id, "amount", event.target.value)}
              placeholder="0.00"
              className="w-24"
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                aria-label="Remove recipient"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-danger/20 text-danger"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="self-start rounded-md border border-dashed border-white/30 px-3 py-2 text-xs font-bold text-text-primary"
        >
          + Add recipient
        </button>
        {error && (
          <Alert data-testid="transfer-error" variant="error">
            {error}
          </Alert>
        )}
        <Button type="submit" variant="secondary" isLoading={isPending}>
          Send {total.toFixed(2)}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend run test -- SendTokensForm`
Expected: PASS — all eight tests green.

- [ ] **Step 5: Write the failing test for wiring into the game detail page**

Edit `apps/frontend/src/app/(app)/games/[address]/page.test.tsx`, adding a new test at the end of the `describe` block:

```tsx
  it("shows the Send tokens form for a General Mode game, for any member (not just the admin)", async () => {
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
    expect(screen.getByText("Send tokens")).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient")).toBeInTheDocument();
  });

  it("hides the Send tokens form for a non-General-Mode game", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFetchGameDetail.mockResolvedValue({
      address: "Game1",
      name: "Friday Hold'em",
      mode: 1,
      isAdmin: false,
      myBalance: 1.5,
      players: [{ username: "bob", balance: 1.5, isAdmin: false }],
    });
    const jsx = await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    render(jsx);
    expect(screen.queryByText("Send tokens")).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- page.test.tsx`
Expected: FAIL — `page.tsx` doesn't render `SendTokensForm` yet.

- [ ] **Step 7: Wire `SendTokensForm` into `page.tsx`**

Edit `apps/frontend/src/app/(app)/games/[address]/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import { GameMode } from "on-chain-client";
import { getCurrentUsername } from "@/server/actions/auth";
import { fetchGameDetail } from "@/server/actions/game";
import { gameModeLabel } from "@/lib/game-mode";
import AdminControlsModal from "./AdminControlsModal";
import SendTokensForm from "./SendTokensForm";
```

Add, after the `{game.isAdmin && <AdminControlsModal ... />}` line:

```tsx
      {game.isAdmin && <AdminControlsModal gameAddress={game.address} players={game.players} />}

      {game.mode === GameMode.General && (
        <SendTokensForm
          gameAddress={game.address}
          players={game.players}
          currentUsername={username}
        />
      )}
    </main>
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter frontend run test -- page.test.tsx`
Expected: PASS — all six `GameDetailPage` tests green, including the two new ones.

- [ ] **Step 9: Run the full frontend suite, lint, and typecheck**

Run: `pnpm --filter frontend run test && pnpm --filter frontend run lint && pnpm --filter frontend run typecheck`
Expected: all PASS with no regressions.

- [ ] **Step 10: Commit**

```bash
git add apps/frontend/src/app/\(app\)/games/\[address\]/SendTokensForm.tsx \
  apps/frontend/src/app/\(app\)/games/\[address\]/SendTokensForm.test.tsx \
  apps/frontend/src/app/\(app\)/games/\[address\]/page.tsx \
  apps/frontend/src/app/\(app\)/games/\[address\]/page.test.tsx
git commit -m "feat(009): add Send tokens form to the game detail page"
```

---

### Task 7: Playwright end-to-end verification

**Files:**
- Create: `apps/e2e/tests/general-mode/transfer.spec.ts`

**Interfaces:**
- Consumes: the running frontend (Task 6's "Send tokens" section, "Recipient"/"Amount" labeled fields, "+ Add recipient" and "Send …" buttons) and on-chain program (Tasks 1–5) via the full stack.
- Produces: nothing consumed by later tasks — final acceptance-level verification.

- [ ] **Step 1: Write the spec**

Create `apps/e2e/tests/general-mode/transfer.spec.ts`:

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

test("a player sends tokens to two other members in one batch", async ({ page, browser }) => {
  const hostUsername = uniqueUsername("e2etransferhost");
  const senderUsername = uniqueUsername("e2etransfersender");
  const recipientUsername = uniqueUsername("e2etransferrecipient");

  await registerAndLogin(page, hostUsername);
  await page.goto("/games/new");
  await page.getByLabel("Game name").fill("E2E Transfer Test Game");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  const senderContext = await browser.newContext();
  const senderPage = await senderContext.newPage();
  await registerAndLogin(senderPage, senderUsername);
  await senderPage.goto("/games/all");
  await senderPage
    .locator("li")
    .filter({ hasText: "E2E Transfer Test Game" })
    .getByRole("button", { name: "Join" })
    .click();
  await expect(senderPage).toHaveURL(/\/games\/.+/, { timeout: 30_000 });

  const recipientContext = await browser.newContext();
  const recipientPage = await recipientContext.newPage();
  await registerAndLogin(recipientPage, recipientUsername);
  await recipientPage.goto("/games/all");
  await recipientPage
    .locator("li")
    .filter({ hasText: "E2E Transfer Test Game" })
    .getByRole("button", { name: "Join" })
    .click();
  await expect(recipientPage).toHaveURL(/\/games\/.+/, { timeout: 30_000 });

  // Host deposits so the sender has a balance to transfer from.
  await page.getByRole("link", { name: /E2E Transfer Test Game/ }).click();
  await expect(page).toHaveURL(/\/games\/.+/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Admin controls" }).click();
  await page.getByLabel("Player").selectOption(senderUsername);
  await page.getByLabel("Amount").fill("10.00");
  await page.getByRole("button", { name: "Deposit" }).click();
  await expect(
    page.getByTestId("players-list").locator("li").filter({ hasText: senderUsername }),
  ).toContainText("10.00");

  // Sender opens the game and sends a batch to the host and the recipient.
  // Fill the first row while it's the only one (so the "Recipient"/"Amount"
  // labels are unambiguous), then add a second row and address it by index.
  await senderPage.reload();
  await expect(senderPage.getByTestId("my-balance")).toContainText("10.00");
  await senderPage.getByLabel("Recipient").selectOption(hostUsername);
  await senderPage.getByLabel("Amount").fill("3.00");
  await senderPage.getByRole("button", { name: "+ Add recipient" }).click();
  await senderPage.getByLabel("Recipient").nth(1).selectOption(recipientUsername);
  await senderPage.getByLabel("Amount").nth(1).fill("2.00");
  await senderPage.getByRole("button", { name: /Send/ }).click();

  await expect(senderPage.getByTestId("my-balance")).toContainText("5.00", { timeout: 30_000 });

  await recipientPage.reload();
  await expect(recipientPage.getByTestId("my-balance")).toContainText("2.00");

  await page.reload();
  const hostRow = page.getByTestId("players-list").locator("li").filter({ hasText: hostUsername });
  await expect(hostRow).toContainText("3.00");

  await senderContext.close();
  await recipientContext.close();
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `just test-e2e`
Expected: PASS — new spec green, no regressions in `auth.spec.ts`, `game-creation.spec.ts`, `game-joining.spec.ts`, `game-deposit.spec.ts`, `admin-registry.spec.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/general-mode/transfer.spec.ts
git commit -m "test(009): add general-mode transfer playwright e2e spec"
```

---

### Task 8: Housekeeping — ticket index correction

**Files:**
- Modify: `docs/tickets/000-index.md`

**Interfaces:**
- Consumes/produces: nothing — documentation-only correction, independent of every other task.

- [ ] **Step 1: Correct ticket 009's status**

Ticket 009's row in `docs/tickets/000-index.md` currently reads `Done` — a copy-paste slip in commit `0e9f2ee` (008's `done` mermaid class was correctly added, but 009's table row status was mistakenly flipped alongside it). Edit line 24:

```diff
-| 009 | General Mode transfers                                                                    | 008           | Done    |
+| 009 | General Mode transfers                                                                    | 008           | Pending |
```

Leave the mermaid `class ... done;` line untouched — 009 was never in that list, so nothing there needs to change.

- [ ] **Step 2: Commit**

```bash
git add docs/tickets/000-index.md
git commit -m "docs(009): correct ticket 009 status back to Pending"
```

This step can be done independently, any time — including right now, before the rest of the plan, since it depends on nothing else. Once this whole plan ships, a *separate* follow-up documentation change flips it (and the mermaid diagram) to `Done` for real.

---

## Final Verification

- [ ] Run the full project gate: `just lint && just typecheck && just test`
- [ ] Confirm every requirement in `openspec/changes/general-mode-transfers/specs/general-mode-transfers/spec.md` is covered:
  - Single-recipient on-chain transfer (Task 1, Task 3)
  - Sender is always the authenticated caller (Task 5 — `username` from `getCurrentUsername()`, never a request parameter)
  - Self-transfer rejected client-side and on-chain (Task 5, Task 1/3)
  - Recipient must already be a member, on-chain and via the picker (Task 1/3, Task 6)
  - Transfer amount must be positive, client-side and on-chain (Task 5, Task 1/3)
  - Insufficient balance fails cleanly, both the up-front and mid-batch cases (Task 5)
  - Duplicate recipients rejected, and excluded from other rows' pickers (Task 5, Task 6)
  - Multi-recipient batch composed and chunked automatically, verified at the 19-recipient worst case (Task 4, Task 5)
  - Partial batch failure surfaced with applied/total counts (Task 5, Task 6)
  - Transfer form on the game detail page, single-submit batch (Task 6)
- [ ] Manually verify against a freshly reset local stack (`just down-clean && just up-build`): register three users, create a General Mode game (host auto-joins), join as two more players, host deposits to one of them via Admin controls, that player sends a two-recipient batch (to the host and the other player) via Send tokens, confirm all three balances update correctly after reload. If feasible, also exercise a ~19-recipient batch manually (e.g. via a scripted `transferTokens` call against the local stack) to confirm real multi-transaction chunking end-to-end; if not feasible, note why and rely on Task 3's and Task 4's automated coverage of that worst case.
- [ ] Confirm `docs/tickets/000-index.md`'s ticket 009 row reads `Pending` until this branch actually merges (Task 8).
- [ ] After merge: run the `openspec-sync-specs`/`openspec-archive-change` skill to archive `openspec/changes/general-mode-transfers/`, and update ticket 009's own status file and `docs/tickets/000-index.md` (table row + mermaid `done` class) to reflect real completion — out of scope for this plan's tasks, tracked here as the final process step.
