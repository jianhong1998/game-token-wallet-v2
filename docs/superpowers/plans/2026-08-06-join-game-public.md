# Join Game (Public) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any logged-in user can browse active public games, join one as a player (creating their per-game token account), and see a game's player roster (usernames + balances) after joining.

**Architecture:** `Game` gains a `player_count: u8` field (not a player list — membership stays tracked implicitly via ATA existence, per existing architecture decisions). New `join_game` Anchor instruction manually creates the joining player's Associated Token Account (ATA) for the game's mint, with an explicit pre-check that returns a custom `AlreadyJoinedGame` error instead of a generic account-creation failure, and a `GameFull` cap check at 20 players. Off-chain: two new Server Actions (`listBrowseGames`, `fetchGameDetail`) that derive membership/roster data from bounded, mint-filtered on-chain queries (no new on-chain list), plus `joinGame`. Two new pages: `/games/all` (browse) and `/games/[address]` (read-only game detail — roster + your balance).

**Tech Stack:** Rust + Anchor 1.x + `anchor-spl` (existing dependency) on-chain. TypeScript + Next.js Server Actions + `@solana/kit` + Codama-generated `on-chain-client` on the frontend, plus a **new** `@solana-program/token` production dependency in `apps/frontend` (already a resolved workspace dependency via `apps/on-chain-program-e2e`'s devDependency — see Task 5) for deriving Associated Token Account addresses client-side.

**Spec:** [openspec/changes/join-game-public/](../../../openspec/changes/join-game-public/) (`proposal.md`, `design.md`, `specs/game/spec.md`, `specs/join-game/spec.md`) — this is the spec-of-record; there is no separate superpowers design doc for this ticket (see the updated [planning workflow doc](../../technical-related/development-workflow/001-planning-and-implementation-workflow.md)). Ticket: [docs/tickets/006-join-game-public.md](../../tickets/006-join-game-public.md).

## Global Constraints

- `Game` gains `player_count: u8` (initialized to 0 by `create_game`, incremented by `join_game`). **Not** a `Vec<Pubkey>` — membership stays tracked implicitly via ATA existence (architecture Q15-17), `player_count` is a derived cardinality cache only.
- `MAX_PLAYERS_PER_GAME: usize = 20` (PRD's fixed per-game player cap), added to `state/game.rs` alongside the existing name-length/id constants.
- `join_game`'s player ATA is **not** created via Anchor's declarative `#[account(init, associated_token::...)]` — that surfaces a generic system/token-program error on a duplicate join. Instead: `UncheckedAccount`, explicit `data_is_empty()` check in the handler, custom `AlreadyJoinedGame` error, manual CPI to the Associated Token Program's `create` instruction.
- New errors: `GameFull`, `AlreadyJoinedGame`, `InvalidPlayerAta` (defensive — the supplied `player_ata` account must match the deterministic ATA address for `(user, mint)`).
- ATA ownership: `authority = the joining player's User PDA` (not a bare wallet keypair — none exists in this custodial model), `mint = game.mint`.
- No visibility/password field exists on `Game` yet (007's job) — every game reachable by this ticket is implicitly public. "Browse" = every active game currently in the `Registry`.
- Existing `/games` ("My games", admin-only list, from 005) is **untouched**. New routes: `/games/all` (browse) and `/games/[address]` (detail).
- Game-detail page scope: header (name/mode, admin badge), your-balance card, players list (username + balance) — **read-only**. No transfer form (009), no quit button (011), no admin controls (008/010), no activity log (no ticket owns this).
- Roster/balance data: `getProgramAccounts` on the Token program filtered by `dataSize = 165` + `memcmp(offset: 0, bytes: game.mint)` (bounded ≤20 results), then batch-resolve owners to usernames via `fetchAllUser`. Browse-page membership check: derive the viewer's ATA address per active game, one batched `getMultipleAccounts` call (bounded by `MAX_ACTIVE_GAMES`).
- Local Surfpool state and devnet deployment are reset/redeployed fresh as part of this ticket's verification — the `Game` account layout change is not binary-compatible with any pre-existing `Game` accounts from testing 005.

---

### Task 1: On-chain `Game` account — `player_count` field

**Files:**
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/state/game.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs`

**Interfaces:**
- Consumes: existing `Game`, `GameMode`, `MIN_GAME_NAME_BYTES`, `MAX_GAME_NAME_BYTES`, `GAME_ID_BYTES` (from `state/game.rs`, ticket 005).
- Produces: `pub const MAX_PLAYERS_PER_GAME: usize = 20;`, `Game.player_count: u8` (new field, re-exported unchanged from `crate::state`).

- [ ] **Step 1: Update the `Game::INIT_SPACE` sizing test to expect the new field, and watch it fail**

Edit `apps/on-chain-program/programs/game_token_wallet/src/state/game.rs`, in the `#[cfg(test)] mod tests` block:

```rust
    #[test]
    fn game_init_space_accounts_for_all_fixed_and_bounded_fields() {
        // 1 (bump) + 1 (mint_bump) + GAME_ID_BYTES (game_id)
        // + (4 byte String length prefix + MAX_GAME_NAME_BYTES) (name)
        // + 1 (mode discriminant, fieldless enum) + 32 (admin) + 32 (mint)
        // + 1 (player_count).
        let expected = 1 + 1 + GAME_ID_BYTES + (4 + MAX_GAME_NAME_BYTES) + 1 + 32 + 32 + 1;
        assert_eq!(Game::INIT_SPACE, expected);
    }
```

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml game_init_space`
Expected: FAIL — `left: ..., right: ...` mismatch (the struct doesn't have the new byte yet).

- [ ] **Step 2: Add `MAX_PLAYERS_PER_GAME` and `player_count` to the `Game` struct**

Edit `apps/on-chain-program/programs/game_token_wallet/src/state/game.rs`:

```rust
use anchor_lang::prelude::*;

pub const MIN_GAME_NAME_BYTES: usize = 3;
pub const MAX_GAME_NAME_BYTES: usize = 32;
pub const GAME_ID_BYTES: usize = 16;
pub const MAX_PLAYERS_PER_GAME: usize = 20;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum GameMode {
    General,
    Poker,
    Pool,
}

#[account]
#[derive(InitSpace)]
pub struct Game {
    pub bump: u8,
    pub mint_bump: u8,
    pub game_id: [u8; GAME_ID_BYTES],
    #[max_len(MAX_GAME_NAME_BYTES)]
    pub name: String,
    pub mode: GameMode,
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub player_count: u8,
}
```

(The rest of the file — the `#[cfg(test)] mod tests` block from Step 1 — stays as already edited.)

- [ ] **Step 3: Run the test and verify it passes**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml game_init_space`
Expected: PASS.

- [ ] **Step 4: Initialize `player_count` in `create_game`'s handler**

Edit `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs`, in `handler`, alongside the other `game.*` assignments:

```rust
    let game = &mut ctx.accounts.game;
    game.bump = ctx.bumps.game;
    game.mint_bump = ctx.bumps.mint;
    game.game_id = game_id;
    game.name = name;
    game.mode = GameMode::General;
    game.admin = ctx.accounts.creator_user.key();
    game.mint = ctx.accounts.mint.key();
    game.player_count = 0;
    let game_key = game.key();
```

(Only this one line is added; nothing else in `create_game.rs` changes. There is no standalone unit test for this one-line initialization — Task 4's e2e "starts at zero" assertion is what verifies it, since `create_game`'s handler requires a full Anchor `Context` and is only exercised via e2e tests, same as the rest of that function.)

- [ ] **Step 5: Run the full on-chain unit test suite**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: PASS — all `game`/`registry`/`user` tests green, including the updated sizing test.

- [ ] **Step 6: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/state/game.rs apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs
git commit -m "feat(on-chain): add Game.player_count field"
```

---

### Task 2: On-chain `join_game` instruction

**Files:**
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/join_game.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`

**Interfaces:**
- Consumes: `Game`, `MAX_PLAYERS_PER_GAME` (Task 1); `User` (existing `state/user.rs`); `anchor_spl::associated_token::{AssociatedToken, Create, create, get_associated_token_address}`; `anchor_spl::token::{Mint, Token}`.
- Produces: `pub fn ensure_game_has_capacity(player_count: u8) -> Result<()>` (pure, unit-tested boundary check, mirrors `ensure_registry_has_capacity` from `create_game.rs`); `pub fn handler(ctx: Context<JoinGame>, game_id: [u8; 16], username: String) -> Result<()>`; the `join_game` instruction dispatched from `lib.rs`.

- [ ] **Step 1: Add new error variants**

Edit `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`:

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Username must be between 3 and 32 bytes")]
    InvalidUsernameLength,
    #[msg("Game name must be between 3 and 32 bytes")]
    InvalidGameNameLength,
    #[msg("Game name can only contain letters, numbers, and spaces")]
    InvalidGameNameCharacters,
    #[msg("Registry is full")]
    RegistryFull,
    #[msg("Game already has the maximum of 20 players")]
    GameFull,
    #[msg("You are already a player in this game")]
    AlreadyJoinedGame,
    #[msg("Player token account address does not match the expected associated token account")]
    InvalidPlayerAta,
}
```

- [ ] **Step 2: Write a failing unit test for the capacity boundary**

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/join_game.rs` with the pure capacity-check function stubbed out first:

```rust
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::state::MAX_PLAYERS_PER_GAME;

pub fn ensure_game_has_capacity(_player_count: u8) -> Result<()> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_when_game_has_room() {
        assert!(ensure_game_has_capacity((MAX_PLAYERS_PER_GAME - 1) as u8).is_ok());
    }

    #[test]
    fn rejects_when_game_is_at_capacity() {
        assert!(ensure_game_has_capacity(MAX_PLAYERS_PER_GAME as u8).is_err());
    }
}
```

Wire it into `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`:

```rust
pub mod create_game;
pub mod join_game;

pub use create_game::*;
pub use join_game::*;
```

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml ensure_game_has_capacity`
Expected: FAIL — panics with `not yet implemented` on both tests.

- [ ] **Step 3: Implement `ensure_game_has_capacity` and verify the tests pass**

Replace the `todo!()` body in `join_game.rs`:

```rust
pub fn ensure_game_has_capacity(player_count: u8) -> Result<()> {
    require!(
        (player_count as usize) < MAX_PLAYERS_PER_GAME,
        ErrorCode::GameFull
    );
    Ok(())
}
```

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml ensure_game_has_capacity`
Expected: PASS — both tests green.

- [ ] **Step 4: Write the full `JoinGame` accounts struct and handler**

Replace the contents of `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/join_game.rs` with:

```rust
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self, get_associated_token_address, AssociatedToken, Create};
use anchor_spl::token::{Mint, Token};

use crate::errors::ErrorCode;
use crate::state::{Game, User, MAX_PLAYERS_PER_GAME};

// Named `user` (not `player_user`) to match `create_game`'s own `user` account
// field of the same name: both instructions derive this PDA with identical
// seeds (`[b"user", username, admin]`), and Codama's IDL-driven client
// generator canonicalizes identically-seeded PDA accounts across
// instructions into a single named finder — a different field name here
// would make that name arbitrary (see `create_game.rs`'s own comment on
// this same issue).
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    #[account(mut, seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    #[account(seeds = [b"mint", game.key().as_ref()], bump = game.mint_bump)]
    pub mint: Account<'info, Mint>,

    /// CHECK: this is the joining player's Associated Token Account for
    /// `mint`. Its address is validated against the deterministic ATA
    /// derivation for `(user, mint)` in the handler, and its
    /// not-yet-initialized state is checked explicitly there too — not via
    /// a declarative `init` constraint, so a duplicate join returns the
    /// custom `AlreadyJoinedGame` error instead of a generic
    /// account-already-in-use failure from the CPI below.
    #[account(mut)]
    pub player_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn ensure_game_has_capacity(player_count: u8) -> Result<()> {
    require!(
        (player_count as usize) < MAX_PLAYERS_PER_GAME,
        ErrorCode::GameFull
    );
    Ok(())
}

pub fn handler(ctx: Context<JoinGame>, _game_id: [u8; 16], _username: String) -> Result<()> {
    let expected_ata =
        get_associated_token_address(&ctx.accounts.user.key(), &ctx.accounts.mint.key());
    require_keys_eq!(
        ctx.accounts.player_ata.key(),
        expected_ata,
        ErrorCode::InvalidPlayerAta
    );

    ensure_game_has_capacity(ctx.accounts.game.player_count)?;

    require!(
        ctx.accounts.player_ata.data_is_empty(),
        ErrorCode::AlreadyJoinedGame
    );

    let cpi_accounts = Create {
        payer: ctx.accounts.admin.to_account_info(),
        associated_token: ctx.accounts.player_ata.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        cpi_accounts,
    );
    associated_token::create(cpi_ctx)?;

    ctx.accounts.game.player_count += 1;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_when_game_has_room() {
        assert!(ensure_game_has_capacity((MAX_PLAYERS_PER_GAME - 1) as u8).is_ok());
    }

    #[test]
    fn rejects_when_game_is_at_capacity() {
        assert!(ensure_game_has_capacity(MAX_PLAYERS_PER_GAME as u8).is_err());
    }
}
```

- [ ] **Step 5: Wire `join_game` into `lib.rs`**

Edit `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`:

```rust
    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: [u8; 16],
        name: String,
        username: String,
    ) -> Result<()> {
        instructions::game::create_game::handler(ctx, game_id, name, username)
    }

    pub fn join_game(ctx: Context<JoinGame>, game_id: [u8; 16], username: String) -> Result<()> {
        instructions::game::join_game::handler(ctx, game_id, username)
    }
```

(Add the new `join_game` method inside the `#[program] pub mod game_token_wallet { ... }` block, alongside `create_game`.)

- [ ] **Step 6: Build the program and confirm it compiles for the BPF target**

Run: `just program-build`
Expected: succeeds, regenerates `apps/on-chain-program/target/idl/game_token_wallet.json` including `join_game`, the new `player_count` field on `Game`, and the three new error codes.

- [ ] **Step 7: Run the full unit test suite once more**

Run: `just test-program-unit`
Expected: PASS — all `game`/`registry`/`user` tests green, including both new `ensure_game_has_capacity` tests.

- [ ] **Step 8: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/errors.rs \
  apps/on-chain-program/programs/game_token_wallet/src/instructions/game/join_game.rs \
  apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs \
  apps/on-chain-program/programs/game_token_wallet/src/lib.rs
git commit -m "feat(on-chain): add join_game instruction"
```

---

### Task 3: Regenerate `on-chain-client` and verify the new bindings

**Files:**
- Modify (generated, not hand-edited): `apps/on-chain-client/src/generated/**`
- Modify: `apps/on-chain-client/src/index.test.ts`

**Interfaces:**
- Consumes: `apps/on-chain-program/target/idl/game_token_wallet.json` (produced by Task 2, Step 6).
- Produces (exact names to verify below): `getJoinGameInstructionAsync`, `GAME_TOKEN_WALLET_ERROR__GAME_FULL`, `GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME`, `GAME_TOKEN_WALLET_ERROR__INVALID_PLAYER_ATA` — re-exported from `on-chain-client`. `Game.playerCount: number` (camelCased, generated from `player_count: u8`).

- [ ] **Step 1: Run codegen**

Run (from repo root): `pnpm codegen`
Expected: runs `anchor build` again then `codama generate`, logs `Generated on-chain-client from .../game_token_wallet.json`.

- [ ] **Step 2: Confirm `getJoinGameInstructionAsync`'s required inputs**

Open the generated file (path will be something like `apps/on-chain-client/src/generated/instructions/joinGame.ts`) and check which accounts the async builder requires as explicit caller-supplied input versus auto-derives. `admin` (signer), `user`/`game`/`mint` (all seeded PDAs declared via `seeds =` in the Rust program) should auto-derive from `{ admin, username, gameId }`, matching `getCreateGameInstructionAsync`'s existing behavior. `player_ata` has **no** `seeds =`/`associated_token::` constraint in the Rust program (Task 2, Step 4's deliberate choice), so Codama has no relationship to derive it from — confirm it appears as a **required** `playerAta: Address` input, not auto-derived. This determines Task 6's `joinGame` Server Action implementation below — note which accounts turned out required vs. auto-derived before writing that task.

- [ ] **Step 3: Add a regression test to `apps/on-chain-client/src/index.test.ts`**

Add to the existing `describe("generated on-chain-client", ...)` block:

```ts
  it("exports a join_game instruction builder and its error helpers", () => {
    expect(typeof getJoinGameInstructionAsync).toBe("function");
    expect(typeof GAME_TOKEN_WALLET_ERROR__GAME_FULL).toBe("number");
    expect(typeof GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME).toBe("number");
    expect(typeof GAME_TOKEN_WALLET_ERROR__INVALID_PLAYER_ATA).toBe("number");
  });
```

And extend the top-of-file import list with:

```ts
  getJoinGameInstructionAsync,
  GAME_TOKEN_WALLET_ERROR__GAME_FULL,
  GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME,
  GAME_TOKEN_WALLET_ERROR__INVALID_PLAYER_ATA,
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `just test-on-chain-client`
Expected: PASS, including the new `join_game` bindings test.

- [ ] **Step 5: Commit**

```bash
git add apps/on-chain-client/src/generated apps/on-chain-client/src/index.test.ts
git commit -m "chore(on-chain-client): regenerate client for join_game"
```

---

### Task 4: On-chain e2e tests for `join_game`

**Files:**
- Create: `apps/on-chain-program-e2e/tests/game/join_game.test.ts`

**Interfaces:**
- Consumes: `getCreateUserInstructionAsync`, `getCreateGameInstructionAsync`, `getJoinGameInstructionAsync`, `findGamePda`, `fetchGame`, `GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME`, `GAME_TOKEN_WALLET_ERROR__GAME_FULL`, `isGameTokenWalletError` (all from `on-chain-client`, Task 3); `findAssociatedTokenPda`, `fetchToken`, `TOKEN_PROGRAM_ADDRESS` (from the existing `@solana-program/token` devDependency, already present per ticket 005's Task 4).

- [ ] **Step 1: Write `tests/game/join_game.test.ts`**

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
  findGamePda,
  fetchGame,
  GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME,
  GAME_TOKEN_WALLET_ERROR__GAME_FULL,
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
  return new Uint8Array(16).fill(fill);
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
    name: "Join Test Game",
  });
  await buildAndSend(rpc, rpcSubscriptions, hostAdmin, createGameInstruction);
  const [gameAddress] = await findGamePda({ gameId: id });
  return { hostAdmin, id, gameAddress };
}

async function joinAsNewUser(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  username: string,
): Promise<void> {
  const admin = await registeredAdmin(rpc, rpcSubscriptions, username);
  const [userAddress] = await import("on-chain-client").then((m) =>
    m.findUserPda({ username, admin: admin.address }),
  );
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
}

describe("join_game instruction", () => {
  it("creates the player's ATA and increments player_count", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { gameAddress, id } = await createdGame(rpc, rpcSubscriptions, "joinhost1", 101);

    const gameBefore = await fetchGame(rpc, gameAddress);
    expect(gameBefore.data.playerCount).toBe(0);

    const playerAdmin = await registeredAdmin(rpc, rpcSubscriptions, "joiner1");
    const { findUserPda } = await import("on-chain-client");
    const [userAddress] = await findUserPda({ username: "joiner1", admin: playerAdmin.address });
    const [playerAta] = await findAssociatedTokenPda({
      owner: userAddress,
      mint: gameBefore.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const joinGameInstruction = await getJoinGameInstructionAsync({
      admin: playerAdmin,
      username: "joiner1",
      gameId: id,
      playerAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, playerAdmin, joinGameInstruction);

    const token = await fetchToken(rpc, playerAta);
    expect(token.data.owner).toBe(userAddress);
    expect(token.data.amount).toBe(0n);

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("rejects a second join by the same player with AlreadyJoinedGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { gameAddress, id } = await createdGame(rpc, rpcSubscriptions, "joinhost2", 102);
    const game = await fetchGame(rpc, gameAddress);

    const playerAdmin = await registeredAdmin(rpc, rpcSubscriptions, "joiner2");
    const { findUserPda } = await import("on-chain-client");
    const [userAddress] = await findUserPda({ username: "joiner2", admin: playerAdmin.address });
    const [playerAta] = await findAssociatedTokenPda({
      owner: userAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const firstJoin = await getJoinGameInstructionAsync({
      admin: playerAdmin,
      username: "joiner2",
      gameId: id,
      playerAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, playerAdmin, firstJoin);

    const secondJoin = await getJoinGameInstructionAsync({
      admin: playerAdmin,
      username: "joiner2",
      gameId: id,
      playerAta,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(playerAdmin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([secondJoin], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the second join to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME,
        ),
      ).toBe(true);
    }

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("rejects the 21st join with GameFull, leaving player_count at 20", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { gameAddress, id } = await createdGame(rpc, rpcSubscriptions, "joinhost3", 103);
    const game = await fetchGame(rpc, gameAddress);

    for (let i = 0; i < 20; i += 1) {
      await joinAsNewUser(rpc, rpcSubscriptions, id, game.data.mint, `capjoiner${i}`);
    }

    const gameAtCapacity = await fetchGame(rpc, gameAddress);
    expect(gameAtCapacity.data.playerCount).toBe(20);

    const overflowAdmin = await registeredAdmin(rpc, rpcSubscriptions, "capjoinerOverflow");
    const { findUserPda } = await import("on-chain-client");
    const [userAddress] = await findUserPda({
      username: "capjoinerOverflow",
      admin: overflowAdmin.address,
    });
    const [playerAta] = await findAssociatedTokenPda({
      owner: userAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const overflowJoin = await getJoinGameInstructionAsync({
      admin: overflowAdmin,
      username: "capjoinerOverflow",
      gameId: id,
      playerAta,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(overflowAdmin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([overflowJoin], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the 21st join to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__GAME_FULL,
        ),
      ).toBe(true);
    }

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(20);
  }, 90_000);
});
```

Note: `buildAndSend` takes a loosely-typed instruction (`{ programAddress, accounts, data }`) rather than each builder's own precise return type, because this file (unlike `create_game.test.ts`) sends several *different* instruction builders' outputs (`create_user`, `create_game`, `join_game`) through one shared helper — confirm this compiles cleanly against the installed `@solana/kit` version in Step 2 below, and adjust the cast if `appendTransactionMessageInstructions` rejects the loosened type.

- [ ] **Step 2: Run the e2e suite**

Run: `just deploy-program-local` (if not already deployed locally against the current build) then `just test-e2e-program`
Expected: PASS — all 3 new `join_game` tests green (the capacity test takes longer, ~20 real transactions — has its own 90s timeout above), plus all existing `create_game`/`registry`/`user` e2e tests still pass.

If Step 1's loosely-typed `buildAndSend` doesn't compile, tighten it to accept a union of the three builders' exact return types instead of the generic object shape, and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/on-chain-program-e2e/tests/game/join_game.test.ts
git commit -m "test(on-chain-program-e2e): cover join_game"
```

---

### Task 5: Add `@solana-program/token` to the frontend

**Files:**
- Modify: `apps/frontend/package.json`

**Interfaces:**
- Produces: `findAssociatedTokenPda`, `TOKEN_PROGRAM_ADDRESS`, `getTokenDecoder` available for import from `@solana-program/token` within `apps/frontend`.

**Flag before running:** this adds a new **production** dependency to `apps/frontend`. It's already a resolved workspace dependency (`apps/on-chain-program-e2e`'s devDependency, `^0.5.1`, added in ticket 005) — this task adds it to a second package at the same pinned version, not a new unvetted library. Confirm with the user before running `pnpm add` here, per this repo's "flag before installing" rule (CLAUDE.md).

- [ ] **Step 1: Add the dependency**

Run (from repo root): `pnpm add @solana-program/token@^0.5.1 --filter frontend`
Expected: `apps/frontend/package.json` gains `"@solana-program/token": "^0.5.1"` under `"dependencies"`; `pnpm-lock.yaml` updates; no version conflict (already resolved at this exact version elsewhere in the workspace).

- [ ] **Step 2: Verify it resolves**

Run: `pnpm --filter frontend exec node -e "require.resolve('@solana-program/token')"`
Expected: no error output (module resolves).

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/package.json pnpm-lock.yaml
git commit -m "chore(frontend): add @solana-program/token dependency"
```

---

### Task 6: `joinGame` Server Action

**Files:**
- Modify: `apps/frontend/src/server/actions/game.ts`
- Modify: `apps/frontend/src/server/actions/game.test.ts`

**Interfaces:**
- Consumes: `getCurrentUsername` (existing `./auth`); `getSolanaContext` (existing `../connection`); `signAndSendTransaction` (existing `../transaction`); `fetchMaybeGame`, `findUserPda`, `getJoinGameInstructionAsync` (`on-chain-client`, Task 3); `findAssociatedTokenPda`, `TOKEN_PROGRAM_ADDRESS` (`@solana-program/token`, Task 5); `fetchEncodedAccount` (`@solana/kit`).
- Produces: `joinGame(gameAddress: string): Promise<{ ok: true } | { ok: false; error: string }>`.

- [ ] **Step 1: Update the shared `gameData()` test helper for the new field**

`apps/frontend/src/server/actions/game.test.ts` already has a `gameData(overrides)` helper (from ticket 005) used across every describe block in this file. Add a `playerCount: 0` default so every existing and new call site gets a realistic value unless it explicitly overrides it:

```ts
function gameData(overrides: Partial<Game> = {}): Game {
  return {
    discriminator: new Uint8Array(8),
    bump: 255,
    mintBump: 254,
    gameId: GAME_ID_BYTES,
    name: "Friday Poker",
    mode: 0,
    admin: USER_ADDRESS,
    mint: "Mint111111111111111111111111111111111111111",
    playerCount: 0,
    ...overrides,
  } as Game;
}
```

Run: `pnpm --filter frontend run test -- server/actions/game`
Expected: PASS — this alone doesn't change behavior (the existing `createGame`/`listMyGames` tests don't read `playerCount`), just confirms nothing broke before adding new tests.

- [ ] **Step 2: Write the failing test**

Add to `apps/frontend/src/server/actions/game.test.ts` (extending the existing mock setup — add these alongside the existing `vi.mock` calls at the top of the file, and extend the `on-chain-client`/`@solana/kit` mocks):

```ts
// Add to the existing `vi.hoisted` block for on-chain-client mocks:
const {
  mockFindUserPda,
  mockFindRegistryPda,
  mockFetchMaybeRegistry,
  mockFetchGame,
  mockFetchMaybeGame,
  mockGetCreateGameInstructionAsync,
  mockGetJoinGameInstructionAsync,
} = vi.hoisted(() => ({
  mockFindUserPda: vi.fn(),
  mockFindRegistryPda: vi.fn(),
  mockFetchMaybeRegistry: vi.fn(),
  mockFetchGame: vi.fn(),
  mockFetchMaybeGame: vi.fn(),
  mockGetCreateGameInstructionAsync: vi.fn(),
  mockGetJoinGameInstructionAsync: vi.fn(),
}));
vi.mock("on-chain-client", () => ({
  findUserPda: mockFindUserPda,
  findRegistryPda: mockFindRegistryPda,
  fetchMaybeRegistry: mockFetchMaybeRegistry,
  fetchGame: mockFetchGame,
  fetchMaybeGame: mockFetchMaybeGame,
  getCreateGameInstructionAsync: mockGetCreateGameInstructionAsync,
  getJoinGameInstructionAsync: mockGetJoinGameInstructionAsync,
}));

const { mockFindAssociatedTokenPda } = vi.hoisted(() => ({
  mockFindAssociatedTokenPda: vi.fn(),
}));
vi.mock("@solana-program/token", () => ({
  findAssociatedTokenPda: mockFindAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
}));

const { mockFetchEncodedAccount } = vi.hoisted(() => ({ mockFetchEncodedAccount: vi.fn() }));
vi.mock("@solana/kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/kit")>();
  return { ...actual, fetchEncodedAccount: mockFetchEncodedAccount };
});

import { joinGame } from "./game";

const GAME_ADDRESS = "Game11111111111111111111111111111111111111";
const MINT_ADDRESS = "Mint111111111111111111111111111111111111111";
const PLAYER_ATA_ADDRESS = "Ata111111111111111111111111111111111111111";

describe("joinGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("bob");
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
      data: gameData({ mint: MINT_ADDRESS, playerCount: 3 }),
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    mockFindAssociatedTokenPda.mockResolvedValue([PLAYER_ATA_ADDRESS, 254]);
    mockFetchEncodedAccount.mockResolvedValue({ exists: false });
    mockGetJoinGameInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignAndSendTransaction.mockResolvedValue(undefined);
  });

  it("rejects when not signed in, without touching the chain", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(joinGame(GAME_ADDRESS)).resolves.toEqual({ ok: false, error: "Not signed in" });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects when the game doesn't exist", async () => {
    mockFetchMaybeGame.mockResolvedValue({ exists: false });
    await expect(joinGame(GAME_ADDRESS)).resolves.toEqual({ ok: false, error: "Game not found" });
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the game is already at the 20-player cap", async () => {
    mockFetchMaybeGame.mockResolvedValue({
      exists: true,
      address: GAME_ADDRESS,
      data: gameData({ mint: MINT_ADDRESS, playerCount: 20 }),
    });
    const result = await joinGame(GAME_ADDRESS);
    expect(result.ok).toBe(false);
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the viewer's ATA for this game already exists", async () => {
    mockFetchEncodedAccount.mockResolvedValue({ exists: true });
    const result = await joinGame(GAME_ADDRESS);
    expect(result.ok).toBe(false);
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("joins and sends the transaction on success", async () => {
    await expect(joinGame(GAME_ADDRESS)).resolves.toEqual({ ok: true });
    expect(mockGetJoinGameInstructionAsync).toHaveBeenCalledWith(
      {
        admin: { address: ADMIN_ADDRESS },
        username: "bob",
        gameId: expect.anything(),
        playerAta: PLAYER_ATA_ADDRESS,
      },
      { programAddress: PROGRAM_ADDRESS },
    );
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(1);
  });
});
```

Run: `pnpm --filter frontend run test -- server/actions/game`
Expected: FAIL — `joinGame is not a function` / `Cannot find module`.

- [ ] **Step 3: Write `joinGame` in `server/actions/game.ts`**

Add to `apps/frontend/src/server/actions/game.ts` (extending the existing imports at the top and adding the new function):

```ts
import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  fetchEncodedAccount,
  type Address,
} from "@solana/kit";
import {
  findUserPda,
  findRegistryPda,
  fetchMaybeRegistry,
  fetchGame,
  fetchMaybeGame,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
} from "on-chain-client";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { signAndSendTransaction } from "../transaction";

// Mirrors the on-chain `MAX_PLAYERS_PER_GAME` constant
// (apps/on-chain-program/programs/game_token_wallet/src/state/game.rs) —
// duplicated here only for a friendly pre-check; the on-chain `GameFull`
// error is still the actual correctness guarantee.
const MAX_PLAYERS_PER_GAME = 20;

export type JoinGameResult = { ok: true } | { ok: false; error: string };

export async function joinGame(gameAddress: string): Promise<JoinGameResult> {
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in" };
  }

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();

  const game = await fetchMaybeGame(rpc, gameAddress as Address);
  if (!game.exists) {
    return { ok: false, error: "Game not found" };
  }
  if (game.data.playerCount >= MAX_PLAYERS_PER_GAME) {
    return { ok: false, error: "This game already has the maximum of 20 players" };
  }

  const [userAddress] = await findUserPda(
    { username, admin: adminSigner.address },
    { programAddress },
  );
  const [playerAta] = await findAssociatedTokenPda({
    owner: userAddress,
    mint: game.data.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const existingAta = await fetchEncodedAccount(rpc, playerAta);
  if (existingAta.exists) {
    return { ok: false, error: "You are already a player in this game" };
  }

  const joinGameInstruction = await getJoinGameInstructionAsync(
    { admin: adminSigner, username, gameId: game.data.gameId, playerAta },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([joinGameInstruction], tx),
  );
  await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });

  return { ok: true };
}
```

(This sits alongside the existing `createGame`/`listMyGames` in the same file — do not duplicate the file's existing imports, merge these into the existing import statements at the top.)

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter frontend run test -- server/actions/game`
Expected: PASS — all `joinGame` cases green, plus the pre-existing `createGame`/`listMyGames` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/server/actions/game.ts apps/frontend/src/server/actions/game.test.ts
git commit -m "feat(frontend): add joinGame server action"
```

---

### Task 7: `listBrowseGames` Server Action

**Files:**
- Modify: `apps/frontend/src/server/actions/game.ts`
- Modify: `apps/frontend/src/server/actions/game.test.ts`

**Interfaces:**
- Consumes: `getCurrentUsername`, `getSolanaContext`, `findRegistryPda`, `fetchMaybeRegistry`, `fetchGame`, `findUserPda` (existing/Task 3); `findAssociatedTokenPda`, `TOKEN_PROGRAM_ADDRESS` (Task 5).
- Produces: `export interface BrowseGame { address: string; name: string; mode: GameMode; playerCount: number; isMember: boolean }`, `listBrowseGames(): Promise<BrowseGame[]>`.

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/server/actions/game.test.ts`:

```ts
import { listBrowseGames } from "./game";

describe("listBrowseGames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: () => ({ send: async () => ({ value: [] }) }) },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFindRegistryPda.mockResolvedValue([REGISTRY_ADDRESS, 255]);
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
  });

  it("returns an empty list when not signed in", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(listBrowseGames()).resolves.toEqual([]);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("returns an empty list when the registry doesn't exist yet", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({ exists: false });
    await expect(listBrowseGames()).resolves.toEqual([]);
  });

  it("marks membership per game from a batched account-existence check", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1", "Game2"] },
    });
    mockFetchGame
      .mockResolvedValueOnce({
        address: "Game1",
        data: gameData({ name: "Mine already", playerCount: 5, mint: "Mint1" }),
      })
      .mockResolvedValueOnce({
        address: "Game2",
        data: gameData({ name: "Not joined", playerCount: 2, mint: "Mint2" }),
      });
    mockFindAssociatedTokenPda
      .mockResolvedValueOnce(["Ata1", 254])
      .mockResolvedValueOnce(["Ata2", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({
      send: async () => ({ value: [{ exists: true }, null] }),
    }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });

    await expect(listBrowseGames()).resolves.toEqual([
      { address: "Game1", name: "Mine already", mode: 0, playerCount: 5, isMember: true },
      { address: "Game2", name: "Not joined", mode: 0, playerCount: 2, isMember: false },
    ]);
    expect(mockGetMultipleAccounts).toHaveBeenCalledWith(["Ata1", "Ata2"]);
  });
});
```

Run: `pnpm --filter frontend run test -- server/actions/game`
Expected: FAIL — `listBrowseGames is not a function`.

- [ ] **Step 2: Write `listBrowseGames`**

Add to `apps/frontend/src/server/actions/game.ts`:

```ts
import type { GameMode } from "on-chain-client";

export interface BrowseGame {
  address: string;
  name: string;
  mode: GameMode;
  playerCount: number;
  isMember: boolean;
}

export async function listBrowseGames(): Promise<BrowseGame[]> {
  const username = await getCurrentUsername();
  if (!username) return [];

  const { rpc, adminSigner, programAddress } = await getSolanaContext();
  const [registryAddress] = await findRegistryPda({ programAddress });
  const registry = await fetchMaybeRegistry(rpc, registryAddress);
  if (!registry.exists) return [];

  const games = await Promise.all(
    registry.data.activeGames.map((gameAddress) => fetchGame(rpc, gameAddress)),
  );

  const [userAddress] = await findUserPda(
    { username, admin: adminSigner.address },
    { programAddress },
  );
  const playerAtas = await Promise.all(
    games.map(({ data }) =>
      findAssociatedTokenPda({
        owner: userAddress,
        mint: data.mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
    ),
  );
  const ataAddresses = playerAtas.map(([address]) => address);
  const { value: ataAccounts } = ataAddresses.length
    ? await rpc.getMultipleAccounts(ataAddresses).send()
    : { value: [] as (unknown | null)[] };

  return games.map((game, index) => ({
    address: game.address,
    name: game.data.name,
    mode: game.data.mode,
    playerCount: game.data.playerCount,
    isMember: ataAccounts[index] !== null,
  }));
}
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `pnpm --filter frontend run test -- server/actions/game`
Expected: PASS. If `rpc.getMultipleAccounts(...).send()`'s actual return shape (from the installed `@solana/kit` version) differs from the `{ value: (unknown | null)[] }` assumed here, adjust the implementation and this test's mock together — this is the one genuinely unverified RPC-shape assumption in this task; confirm it compiles under `pnpm --filter frontend run typecheck` too (folded into Task 12's full verification, but worth a quick manual check now to avoid carrying a wrong assumption into Task 9).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/server/actions/game.ts apps/frontend/src/server/actions/game.test.ts
git commit -m "feat(frontend): add listBrowseGames server action"
```

---

### Task 8: `fetchGameDetail` Server Action

**Files:**
- Modify: `apps/frontend/src/server/actions/game.ts`
- Modify: `apps/frontend/src/server/actions/game.test.ts`

**Interfaces:**
- Consumes: `getCurrentUsername`, `getSolanaContext`, `fetchMaybeGame`, `findUserPda`, `fetchAllUser` (`on-chain-client`); `getTokenDecoder`, `TOKEN_PROGRAM_ADDRESS` (`@solana-program/token`).
- Produces: `export interface GamePlayer { username: string; balance: number; isAdmin: boolean }`, `export interface GameDetail { address: string; name: string; mode: GameMode; isAdmin: boolean; myBalance: number; players: GamePlayer[] }`, `fetchGameDetail(gameAddress: string): Promise<GameDetail | null>`.

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/server/actions/game.test.ts` (extending the `on-chain-client` mock with `fetchAllUser`, and the `@solana-program/token` mock with `getTokenDecoder`):

```ts
// Add `fetchAllUser` to the existing on-chain-client vi.hoisted/vi.mock blocks,
// and add to the @solana-program/token mock:
const { mockGetTokenDecoder } = vi.hoisted(() => ({ mockGetTokenDecoder: vi.fn() }));
// merge into the existing vi.mock("@solana-program/token", ...) factory:
//   getTokenDecoder: mockGetTokenDecoder,

import { fetchGameDetail } from "./game";

describe("fetchGameDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
  });

  it("returns null when not signed in", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(fetchGameDetail(GAME_ADDRESS)).resolves.toBeNull();
  });

  it("returns null when the game doesn't exist", async () => {
    mockGetSolanaContext.mockResolvedValue({
      rpc: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFetchMaybeGame.mockResolvedValue({ exists: false });
    await expect(fetchGameDetail(GAME_ADDRESS)).resolves.toBeNull();
  });

  it("returns the roster with balances and identifies the viewer and the admin", async () => {
    mockFetchMaybeGame.mockResolvedValue({
      exists: true,
      address: GAME_ADDRESS,
      data: gameData({ admin: "AdminUser1111111111111111111111111111111", mint: MINT_ADDRESS }),
    });
    const rawTokenAccountBase64 = "ZmFrZS10b2tlbi1hY2NvdW50LWJ5dGVz";
    mockGetSolanaContext.mockResolvedValue({
      rpc: {
        getProgramAccounts: () => ({
          send: async () => ({
            value: [
              { pubkey: "PlayerAta1", account: { data: [rawTokenAccountBase64, "base64"] } },
              { pubkey: "PlayerAta2", account: { data: [rawTokenAccountBase64, "base64"] } },
            ],
          }),
        }),
      },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockGetTokenDecoder.mockReturnValue({
      decode: vi
        .fn()
        .mockReturnValueOnce({ owner: "AdminUser1111111111111111111111111111111", amount: 400n })
        .mockReturnValueOnce({ owner: USER_ADDRESS, amount: 150n }),
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    const { fetchAllUser } = await import("on-chain-client");
    (fetchAllUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue?.([
      { data: { username: "alice" } },
      { data: { username: "bob" } },
    ]);

    const detail = await fetchGameDetail(GAME_ADDRESS);
    expect(detail).toEqual({
      address: GAME_ADDRESS,
      name: "Friday Poker",
      mode: 0,
      isAdmin: false,
      myBalance: 1.5,
      players: [
        { username: "alice", balance: 4, isAdmin: true },
        { username: "bob", balance: 1.5, isAdmin: false },
      ],
    });
  });
});
```

Run: `pnpm --filter frontend run test -- server/actions/game`
Expected: FAIL — `fetchGameDetail is not a function`.

- [ ] **Step 2: Write `fetchGameDetail`**

Add to `apps/frontend/src/server/actions/game.ts`:

```ts
import { fetchAllUser } from "on-chain-client";
import { getTokenDecoder } from "@solana-program/token";

export interface GamePlayer {
  username: string;
  balance: number;
  isAdmin: boolean;
}

export interface GameDetail {
  address: string;
  name: string;
  mode: GameMode;
  isAdmin: boolean;
  myBalance: number;
  players: GamePlayer[];
}

export async function fetchGameDetail(gameAddress: string): Promise<GameDetail | null> {
  const username = await getCurrentUsername();
  if (!username) return null;

  const { rpc, adminSigner, programAddress } = await getSolanaContext();
  const game = await fetchMaybeGame(rpc, gameAddress as Address);
  if (!game.exists) return null;

  const [userAddress] = await findUserPda(
    { username, admin: adminSigner.address },
    { programAddress },
  );

  const { value: tokenAccounts } = await rpc
    .getProgramAccounts(TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: 165n },
        { memcmp: { offset: 0n, bytes: game.data.mint, encoding: "base58" } },
      ],
    })
    .send();

  const tokenDecoder = getTokenDecoder();
  const holders = tokenAccounts.map(({ account }) => {
    const decoded = tokenDecoder.decode(Buffer.from(account.data[0], "base64"));
    return { owner: decoded.owner, balance: Number(decoded.amount) / 100 };
  });

  const owners = holders.map((holder) => holder.owner);
  const userAccounts = owners.length ? await fetchAllUser(rpc, owners) : [];

  const players: GamePlayer[] = holders.map((holder, index) => ({
    username: userAccounts[index].data.username,
    balance: holder.balance,
    isAdmin: holder.owner === game.data.admin,
  }));

  const myHolderIndex = owners.findIndex((owner) => owner === userAddress);

  return {
    address: game.address,
    name: game.data.name,
    mode: game.data.mode,
    isAdmin: game.data.admin === userAddress,
    myBalance: myHolderIndex === -1 ? 0 : holders[myHolderIndex].balance,
    players,
  };
}
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `pnpm --filter frontend run test -- server/actions/game`
Expected: PASS. As with Task 7, `rpc.getProgramAccounts(...)`'s exact filter/response typing (`dataSize`/`memcmp.offset` as `bigint` vs `number`, `account.data` tuple shape) is the other genuinely unverified RPC-shape assumption in this plan — confirm against the installed `@solana/kit` version's types (via `pnpm --filter frontend run typecheck`) and adjust both the implementation and this test's mock together if the real shape differs.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/server/actions/game.ts apps/frontend/src/server/actions/game.test.ts
git commit -m "feat(frontend): add fetchGameDetail server action"
```

---

### Task 9: Browse page (`/games/all`)

**Files:**
- Create: `apps/frontend/src/app/(app)/games/all/page.tsx`
- Create: `apps/frontend/src/app/(app)/games/all/page.test.tsx`
- Create: `apps/frontend/src/app/(app)/games/all/BrowseGameRow.tsx`
- Create: `apps/frontend/src/app/(app)/games/all/BrowseGameRow.test.tsx`

**Interfaces:**
- Consumes: `getCurrentUsername` (`@/server/actions/auth`); `listBrowseGames`, `joinGame`, `type BrowseGame` (Tasks 6/7, `@/server/actions/game`).
- Produces: default-exported `GamesAllPage` (server component), default-exported `BrowseGameRow` (client component, props `{ game: BrowseGame }`).

- [ ] **Step 1: Write the failing test for `BrowseGameRow`**

Create `apps/frontend/src/app/(app)/games/all/BrowseGameRow.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockJoinGame } = vi.hoisted(() => ({ mockJoinGame: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ joinGame: mockJoinGame }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import BrowseGameRow from "./BrowseGameRow";

describe("BrowseGameRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a Join button and player count when not a member", () => {
    render(
      <BrowseGameRow
        game={{ address: "Game1", name: "Friday Poker", mode: 0, playerCount: 5, isMember: false }}
      />,
    );
    expect(screen.getByText("Friday Poker")).toBeInTheDocument();
    expect(screen.getByText("5/20")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("shows an Open button when already a member", () => {
    render(
      <BrowseGameRow
        game={{ address: "Game1", name: "Friday Poker", mode: 0, playerCount: 5, isMember: true }}
      />,
    );
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("navigates to the game detail page when Open is clicked", () => {
    render(
      <BrowseGameRow
        game={{ address: "Game1", name: "Friday Poker", mode: 0, playerCount: 5, isMember: true }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(mockPush).toHaveBeenCalledWith("/games/Game1");
  });

  it("joins then navigates to the game detail page on success", async () => {
    mockJoinGame.mockResolvedValue({ ok: true });
    render(
      <BrowseGameRow
        game={{ address: "Game1", name: "Friday Poker", mode: 0, playerCount: 5, isMember: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/games/Game1"));
    expect(mockJoinGame).toHaveBeenCalledWith("Game1");
  });

  it("shows an error and does not navigate when joining fails", async () => {
    mockJoinGame.mockResolvedValue({ ok: false, error: "This game already has the maximum of 20 players" });
    render(
      <BrowseGameRow
        game={{ address: "Game1", name: "Friday Poker", mode: 0, playerCount: 20, isMember: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() =>
      expect(screen.getByText("This game already has the maximum of 20 players")).toBeInTheDocument(),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter frontend run test -- games/all/BrowseGameRow`
Expected: FAIL — `Cannot find module './BrowseGameRow'`.

- [ ] **Step 2: Write `BrowseGameRow.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinGame, type BrowseGame } from "@/server/actions/game";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

function gameModeLabel(mode: BrowseGame["mode"]): string {
  return mode === 0 ? "General Mode" : mode === 1 ? "Poker Mode" : "Pool Mode";
}

export default function BrowseGameRow({ game }: { game: BrowseGame }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (game.isMember) {
      router.push(`/games/${game.address}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await joinGame(game.address);
      if (result.ok) {
        router.push(`/games/${game.address}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <li
      data-testid={`browse-game-${game.address}`}
      className="glass-row flex flex-col gap-2 px-4 py-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-text-primary">{game.name}</div>
          <div className="text-xs font-semibold text-text-secondary">
            {gameModeLabel(game.mode)} · {game.playerCount}/20
          </div>
        </div>
        <Button variant="primary" isLoading={isPending} onClick={handleClick}>
          {game.isMember ? "Open" : "Join"}
        </Button>
      </div>
      {error && (
        <Alert data-testid="join-game-error" variant="error" className="break-all">
          {error}
        </Alert>
      )}
    </li>
  );
}
```

- [ ] **Step 3: Run the `BrowseGameRow` test and verify it passes**

Run: `pnpm --filter frontend run test -- games/all/BrowseGameRow`
Expected: PASS — all 5 cases green.

- [ ] **Step 4: Write the failing test for the page**

Create `apps/frontend/src/app/(app)/games/all/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ getCurrentUsername: mockGetCurrentUsername }));

const { mockListBrowseGames } = vi.hoisted(() => ({ mockListBrowseGames: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ listBrowseGames: mockListBrowseGames }));

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import GamesAllPage from "./page";

describe("GamesAllPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await GamesAllPage();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("shows an empty state when no games are active", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockListBrowseGames.mockResolvedValue([]);
    const jsx = await GamesAllPage();
    render(jsx);
    expect(screen.getByTestId("browse-games-empty")).toBeInTheDocument();
  });

  it("lists active games", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockListBrowseGames.mockResolvedValue([
      { address: "Game1", name: "Friday Poker", mode: 0, playerCount: 5, isMember: false },
    ]);
    const jsx = await GamesAllPage();
    render(jsx);
    expect(screen.getByText("Friday Poker")).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter frontend run test -- games/all/page`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 5: Write `page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { listBrowseGames } from "@/server/actions/game";
import BrowseGameRow from "./BrowseGameRow";

export default async function GamesAllPage() {
  const username = await getCurrentUsername();
  if (!username) {
    redirect("/login");
    return;
  }

  const games = await listBrowseGames();

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 className="text-xl font-extrabold text-text-primary">Browse games</h1>
      {games.length === 0 ? (
        <p data-testid="browse-games-empty" className="text-sm font-semibold text-text-secondary">
          No active games right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="browse-games-list">
          {games.map((game) => (
            <BrowseGameRow key={game.address} game={game} />
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Run the page test and verify it passes**

Run: `pnpm --filter frontend run test -- games/all/page`
Expected: PASS — all 3 cases green.

- [ ] **Step 7: Commit**

```bash
git add "apps/frontend/src/app/(app)/games/all"
git commit -m "feat(frontend): add browse games page"
```

---

### Task 10: Game detail page (`/games/[address]`)

**Files:**
- Create: `apps/frontend/src/app/(app)/games/[address]/page.tsx`
- Create: `apps/frontend/src/app/(app)/games/[address]/page.test.tsx`

**Interfaces:**
- Consumes: `getCurrentUsername` (`@/server/actions/auth`); `fetchGameDetail` (Task 8, `@/server/actions/game`).
- Produces: default-exported `GameDetailPage` (server component, props `{ params: Promise<{ address: string }> }` — Next.js App Router's async `params` convention).

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/app/(app)/games/[address]/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ getCurrentUsername: mockGetCurrentUsername }));

const { mockFetchGameDetail } = vi.hoisted(() => ({ mockFetchGameDetail: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ fetchGameDetail: mockFetchGameDetail }));

const { mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
  mockNotFound: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: mockRedirect, notFound: mockNotFound }));

import GameDetailPage from "./page";

describe("GameDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("calls notFound when the game doesn't exist", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFetchGameDetail.mockResolvedValue(null);
    await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("shows the header, your balance, and the players roster", async () => {
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
    expect(screen.getByText("Friday Poker")).toBeInTheDocument();
    expect(screen.getByTestId("my-balance")).toHaveTextContent("1.5");
    expect(screen.getByTestId("players-list")).toHaveTextContent("alice");
    expect(screen.getByTestId("players-list")).toHaveTextContent("bob");
    expect(screen.queryByText("Admin")).toBeInTheDocument();
  });

  it("shows the admin badge in the header when the viewer is the game's admin", async () => {
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
  });
});
```

Run: `pnpm --filter frontend run test -- "games/\[address\]/page"`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 2: Write `page.tsx`**

```tsx
import { redirect, notFound } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { fetchGameDetail, type GameDetail } from "@/server/actions/game";

function gameModeLabel(mode: GameDetail["mode"]): string {
  return mode === 0 ? "General Mode" : mode === 1 ? "Poker Mode" : "Pool Mode";
}

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const username = await getCurrentUsername();
  if (!username) {
    redirect("/login");
    return;
  }

  const { address } = await params;
  const game = await fetchGameDetail(address);
  if (!game) {
    notFound();
    return;
  }

  return (
    <main className="py-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-text-primary">{game.name}</h1>
          <p className="text-xs font-semibold text-cyan-accent">{gameModeLabel(game.mode)}</p>
        </div>
        {game.isAdmin && (
          <span
            data-testid="game-admin-badge"
            className="rounded-full bg-cyan-accent/20 px-3 py-1 text-xs font-bold text-cyan-accent"
          >
            Admin
          </span>
        )}
      </div>

      <div className="glass-row px-4 py-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          Your balance
        </p>
        <p data-testid="my-balance" className="text-2xl font-bold text-text-primary">
          {game.myBalance.toFixed(2)}
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-extrabold text-text-primary">Players</h2>
        <ul className="flex flex-col gap-2" data-testid="players-list">
          {game.players.map((player) => (
            <li
              key={player.username}
              className="glass-row flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm font-bold text-text-primary">{player.username}</span>
              <span className="flex items-center gap-2">
                {player.isAdmin && (
                  <span className="text-xs font-semibold text-cyan-accent">Admin</span>
                )}
                <span className="text-sm font-bold text-text-primary">
                  {player.balance.toFixed(2)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `pnpm --filter frontend run test -- "games/\[address\]/page"`
Expected: PASS — all 4 cases green.

- [ ] **Step 4: Commit**

```bash
git add "apps/frontend/src/app/(app)/games/[address]"
git commit -m "feat(frontend): add game detail page"
```

---

### Task 11: Playwright e2e coverage (`apps/e2e`)

**Files:**
- Create: `apps/e2e/tests/game-joining.spec.ts`

**Interfaces:**
- Consumes: no shared test helper exists yet — `apps/e2e/tests/game-creation.spec.ts` and `apps/e2e/tests/auth.spec.ts` each inline their own registration flow with a locally-defined `uniqueUsername()` function (confirmed by reading both files; there is no `./helpers/*` directory in `apps/e2e/tests`). This task follows the same inline style, not a new abstraction.

- [ ] **Step 1: Write `game-joining.spec.ts`**

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

test("a second user can browse, join, and see themselves in the game's player list", async ({
  page,
  browser,
}) => {
  const hostUsername = uniqueUsername("e2ejoinhost");
  const joinerUsername = uniqueUsername("e2ejoiner");

  // Create the game as the first user.
  await registerAndLogin(page, hostUsername);
  await page.goto("/games/new");
  await page.getByLabel("Game name").fill("E2E Join Test Game");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page).toHaveURL(/\/games$/, { timeout: 30_000 });
  await expect(page.getByTestId("games-list")).toContainText("E2E Join Test Game");

  // Join as a second, independent user (separate browser context so the
  // two sessions' cookies don't clash).
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await registerAndLogin(secondPage, joinerUsername);

  await secondPage.goto("/games/all");
  const row = secondPage.locator("li").filter({ hasText: "E2E Join Test Game" });
  await expect(row).toContainText("0/20");
  await row.getByRole("button", { name: "Join" }).click();

  await expect(secondPage).toHaveURL(/\/games\/.+/, { timeout: 30_000 });
  await expect(secondPage.getByTestId("players-list")).toContainText(joinerUsername);
  await expect(secondPage.getByTestId("my-balance")).toContainText("0.00");

  // Browsing again now shows "Open" instead of "Join" for the same game.
  await secondPage.goto("/games/all");
  const rowAfterJoin = secondPage.locator("li").filter({ hasText: "E2E Join Test Game" });
  await expect(rowAfterJoin).toContainText("1/20");
  await expect(rowAfterJoin.getByRole("button", { name: "Open" })).toBeVisible();

  await secondContext.close();
});
```

- [ ] **Step 2: Run the Playwright suite**

Run: `just up-build` (or `just up` if images are already built) to bring up the local stack, then `just test-e2e`
Expected: PASS — the new spec plus all existing `apps/e2e` specs (`auth.spec.ts`, `game-creation.spec.ts`, `admin-registry.spec.ts`) green.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/game-joining.spec.ts
git commit -m "test(e2e): cover browsing and joining a public game"
```

---

### Task 12: Full verification — lint, typecheck, full test suite, manual run

**Files:** none (verification only).

- [ ] **Step 1: Lint and typecheck**

Run: `just lint && just typecheck`
Expected: PASS with no changes needed. (Per this repo's `CLAUDE.local.md`, if `just lint` fails unexpectedly, re-run via `rtk proxy pnpm lint` to bypass a known local hook rewrite before treating it as a real regression.)

- [ ] **Step 2: Full automated suite**

Run: `just test`
Expected: PASS in full — `cargo test`, frontend vitest, `on-chain-client` vitest, `on-chain-program-e2e` (`anchor test`), and `apps/e2e` Playwright, per this repo's CI gate (`.circleci/config.yml` runs the same set on every PR).

- [ ] **Step 3: Reset local state and manually verify against the running stack**

Per this ticket's Global Constraints (the `Game` account layout change isn't binary-compatible with any pre-existing local/devnet `Game` accounts from testing 005):

```bash
just down-clean
just up-build
```

Then manually, against the freshly-reset local stack:
1. Register/log in as `hostuser`, create a public game ("Verify Join Flow").
2. Log out, register/log in as `playeruser`.
3. Go to `/games/all` — confirm "Verify Join Flow" is listed with `0/20` and a "Join" button.
4. Click Join — confirm redirect to `/games/<address>`, the page shows `playeruser` in the players list with a `0.00` balance, and no admin badge.
5. Go back to `/games/all` — confirm the same game now shows `1/20` and an "Open" button.
6. Click Open — confirm it navigates straight to the same detail page without re-joining or erroring.
7. Log out, log back in as `hostuser`, go to `/games/all`, click "Join" on the same game — confirm it also succeeds (host becomes a player in their own game, distinct from being its admin) and the detail page now shows both `hostuser` (with an "Admin" tag next to their row) and `playeruser` in the players list, `2/20` on the browse page.

Confirm every observed state (HTTP navigation, on-page text, player counts) matches the above — do not mark this ticket done on the strength of automated tests alone, per this repo's Done-Means rule.

- [ ] **Step 4: Update ticket and openspec tracking**

Edit `docs/tickets/006-join-game-public.md`: check off all 4 acceptance criteria and set `**Status:** Done` (mirroring how ticket 005 recorded its own completion note, including a one-paragraph verification summary of what was actually run).

Edit `openspec/changes/join-game-public/tasks.md`: check off all completed tasks to match what was actually done (per this repo's workflow doc — don't leave this out of sync the way `create-game-general-mode`'s was found to be earlier in this same planning session).

- [ ] **Step 5: Commit**

```bash
git add docs/tickets/006-join-game-public.md openspec/changes/join-game-public/tasks.md
git commit -m "docs: mark ticket 006 done"
```

After this, per this repo's workflow: run `openspec-sync-specs` (or `openspec-archive-change` if closing the change out fully) to fold `openspec/changes/join-game-public/specs/*.md` into `openspec/specs/`, keeping the main specs an accurate record of shipped behavior.
