# Create Game (General Mode, Public) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in user can create a General Mode, public game from the frontend; the on-chain program creates the `Game` PDA and its own 2-decimal SPL mint, registers the creator as admin, and appends the game to the `Registry`.

**Architecture:** New `Game` on-chain account + `create_game` Anchor instruction (creates `Game`, an SPL mint owned by the `Game` PDA, and pushes into the existing `Registry`). Off-chain: a hand-rolled UUID v7 generator and shared name-validation module in the Next.js app, a `createGame`/`listMyGames` Server Action pair, and two new pages (`/games/new` creation form, `/games` "My Games" list).

**Tech Stack:** Rust + Anchor 1.x + `anchor-spl` (new dependency) on-chain; TypeScript + Next.js Server Actions + `@solana/kit` + Codama-generated `on-chain-client` on the frontend; `@solana-program/token` (new devDependency, test-only) in `on-chain-program-e2e`.

**Spec:** [docs/superpowers/specs/2026-07-25-create-game-general-mode-design.md](../specs/2026-07-25-create-game-general-mode-design.md). Ticket: [docs/tickets/005-create-game-general-mode.md](../../tickets/005-create-game-general-mode.md).

## Global Constraints

- Game name: 3–32 UTF-8 bytes, charset Unicode letter/number/space only (no other symbols), NFC-normalized, **no case-folding** (unlike username). Enforced in the frontend form, the Next.js Server Action, and the on-chain program (length **and** charset all three places — the on-chain program adds a charset check that `create_user` never needed).
- `Game` PDA seed: `[b"game", game_id.as_ref()]`, `game_id: [u8; 16]` = raw UUID v7 bytes. No admin pubkey in the seed (UUID is already globally unique).
- `Game.admin: Pubkey` stores the creator's **`User` PDA address** (there is no per-user wallet in this custodial model) — passed into `create_game` as a read-only `Account<'info, User>`, not a bare `Pubkey` arg, so Anchor's own deserialization enforces it's a real registered user.
- `Game.mode: GameMode` (enum `General`/`Poker`/`Pool`) is stored now; `create_game` always sets `GameMode::General`. No mode argument is accepted from the client; the creation form shows no mode selector (hidden, not disabled).
- **No** `is_private`/`password_hash` field on `Game` yet (ticket 007 adds it later via `realloc`). **No** `players` field yet (ticket 006 adds it later via `realloc`).
- Mint: legacy SPL Token program (not Token-2022), 2 decimals, `mint::authority = game` (the `Game` PDA), no freeze authority.
- `MAX_ACTIVE_GAMES = 128` already exists (`state/registry.rs`, ticket 002). `create_game` must reject with a new `RegistryFull` error before mutating anything once the registry is at capacity.
- New dependencies: `anchor-spl = "1"` in `apps/on-chain-program/programs/game_token_wallet/Cargo.toml` (production); `@solana-program/token` devDependency in `apps/on-chain-program-e2e` (test-only, for reading raw SPL `Mint` account data — not part of our program's own IDL). **No new frontend dependency** — UUID v7 generation is hand-rolled.
- New frontend pages: `/games/new` (creation form) and `/games` ("My Games" list, filters the registry's games to `admin === current user's User PDA`). Both sit inside the existing `(app)` route group and are already covered by `middleware.ts`'s default auth-required matcher — no middleware changes needed.

---

### Task 1: On-chain `Game` account (`state/game.rs`)

**Files:**
- Create: `apps/on-chain-program/programs/game_token_wallet/src/state/game.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/state/mod.rs`

**Interfaces:**
- Produces: `pub const MIN_GAME_NAME_BYTES: usize`, `pub const MAX_GAME_NAME_BYTES: usize`, `pub const GAME_ID_BYTES: usize`, `pub enum GameMode { General, Poker, Pool }`, `pub struct Game { bump: u8, mint_bump: u8, game_id: [u8; GAME_ID_BYTES], name: String, mode: GameMode, admin: Pubkey, mint: Pubkey }` — all re-exported from `crate::state`.

- [ ] **Step 1: Wire the (not-yet-existing) module into `state/mod.rs` and watch it fail**

Edit `apps/on-chain-program/programs/game_token_wallet/src/state/mod.rs`:

```rust
pub mod game;
pub mod registry;
pub mod user;

pub use game::*;
pub use registry::*;
pub use user::*;
```

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: FAIL — `error[E0583]: file not found for module 'game'`.

- [ ] **Step 2: Write `state/game.rs`**

```rust
use anchor_lang::prelude::*;

pub const MIN_GAME_NAME_BYTES: usize = 3;
pub const MAX_GAME_NAME_BYTES: usize = 32;
pub const GAME_ID_BYTES: usize = 16;

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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_init_space_accounts_for_all_fixed_and_bounded_fields() {
        // 1 (bump) + 1 (mint_bump) + GAME_ID_BYTES (game_id)
        // + (4 byte String length prefix + MAX_GAME_NAME_BYTES) (name)
        // + 1 (mode discriminant, fieldless enum) + 32 (admin) + 32 (mint).
        let expected = 1 + 1 + GAME_ID_BYTES + (4 + MAX_GAME_NAME_BYTES) + 1 + 32 + 32;
        assert_eq!(Game::INIT_SPACE, expected);
    }
}
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: PASS — `game_init_space_accounts_for_all_fixed_and_bounded_fields ... ok`, plus the pre-existing `registry`/`user` sizing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/state/game.rs apps/on-chain-program/programs/game_token_wallet/src/state/mod.rs
git commit -m "feat(on-chain): add Game account and GameMode enum"
```

---

### Task 2: On-chain `create_game` instruction

**Files:**
- Modify: `apps/on-chain-program/programs/game_token_wallet/Cargo.toml`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/mod.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`

**Interfaces:**
- Consumes: `Game`, `GameMode`, `MIN_GAME_NAME_BYTES`, `MAX_GAME_NAME_BYTES`, `GAME_ID_BYTES` (Task 1); `Registry`, `MAX_ACTIVE_GAMES` (existing `state/registry.rs`); `User` (existing `state/user.rs`).
- Produces: `pub fn ensure_registry_has_capacity(active_games_len: usize) -> Result<()>` (pure, unit-tested boundary check — reused by nothing else in this ticket, but kept as a standalone function specifically so it's unit-testable without a live validator); `pub fn handler(ctx: Context<CreateGame>, game_id: [u8; 16], name: String, username: String) -> Result<()>`; the `create_game` instruction dispatched from `lib.rs`.

**Note on testing the registry-full boundary:** `MAX_ACTIVE_GAMES` is 128, and `Registry` is a single global singleton PDA shared by the *entire* e2e test suite (all test files run against one validator in one `anchor test` invocation, per this repo's `just test-e2e-program`). Actually sending 128 real `create_game` transactions in an e2e test would be slow **and** would permanently fill the shared registry for every other test file in the same run (including future tickets 006+). Instead, the capacity check is extracted into the pure `ensure_registry_has_capacity` function below and covered by a fast `cargo test` at the exact boundary (`MAX_ACTIVE_GAMES - 1` succeeds, `MAX_ACTIVE_GAMES` fails) — Task 4's e2e suite does not attempt to fill the registry.

- [ ] **Step 1: Add the `anchor-spl` dependency**

Edit `apps/on-chain-program/programs/game_token_wallet/Cargo.toml`:

```toml
[dependencies]
anchor-lang = "1"
anchor-spl = "1"
```

- [ ] **Step 2: Add new error variants**

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
}
```

- [ ] **Step 3: Write a failing unit test for the capacity boundary**

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs` with **only** the test module and a `todo!()` stub first, to see it fail before implementing:

```rust
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::state::MAX_ACTIVE_GAMES;

pub fn ensure_registry_has_capacity(_active_games_len: usize) -> Result<()> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_when_registry_has_room() {
        assert!(ensure_registry_has_capacity(MAX_ACTIVE_GAMES - 1).is_ok());
    }

    #[test]
    fn rejects_when_registry_is_at_capacity() {
        assert!(ensure_registry_has_capacity(MAX_ACTIVE_GAMES).is_err());
    }
}
```

Also create `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`:

```rust
pub mod create_game;

pub use create_game::*;
```

And wire it into `apps/on-chain-program/programs/game_token_wallet/src/instructions/mod.rs`:

```rust
pub mod game;
pub mod registry;
pub mod user;

pub use game::*;
pub use registry::*;
pub use user::*;
```

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml ensure_registry_has_capacity`
Expected: FAIL — panics with `not yet implemented` on both tests.

- [ ] **Step 4: Implement `ensure_registry_has_capacity` and verify the tests pass**

Replace the `todo!()` body:

```rust
pub fn ensure_registry_has_capacity(active_games_len: usize) -> Result<()> {
    require!(active_games_len < MAX_ACTIVE_GAMES, ErrorCode::RegistryFull);
    Ok(())
}
```

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml ensure_registry_has_capacity`
Expected: PASS — both tests green.

- [ ] **Step 5: Write the full `CreateGame` accounts struct and handler**

Replace the contents of `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs` with:

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::errors::ErrorCode;
use crate::state::{Game, GameMode, MAX_ACTIVE_GAMES, MAX_GAME_NAME_BYTES, MIN_GAME_NAME_BYTES, Registry, User};

#[derive(Accounts)]
#[instruction(game_id: [u8; 16], name: String, username: String)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub creator_user: Account<'info, User>,

    #[account(mut, seeds = [b"registry"], bump)]
    pub registry: Account<'info, Registry>,

    #[account(
        init,
        payer = admin,
        space = 8 + Game::INIT_SPACE,
        seeds = [b"game", game_id.as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,

    #[account(
        init,
        payer = admin,
        mint::decimals = 2,
        mint::authority = game,
        seeds = [b"mint", game.key().as_ref()],
        bump,
    )]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn ensure_registry_has_capacity(active_games_len: usize) -> Result<()> {
    require!(active_games_len < MAX_ACTIVE_GAMES, ErrorCode::RegistryFull);
    Ok(())
}

fn is_valid_game_name_char(c: char) -> bool {
    c.is_alphabetic() || c.is_numeric() || c == ' '
}

pub fn handler(
    ctx: Context<CreateGame>,
    game_id: [u8; 16],
    name: String,
    _username: String,
) -> Result<()> {
    let byte_len = name.as_bytes().len();
    require!(
        byte_len >= MIN_GAME_NAME_BYTES && byte_len <= MAX_GAME_NAME_BYTES,
        ErrorCode::InvalidGameNameLength
    );
    require!(
        name.chars().all(is_valid_game_name_char),
        ErrorCode::InvalidGameNameCharacters
    );
    ensure_registry_has_capacity(ctx.accounts.registry.active_games.len())?;

    let game = &mut ctx.accounts.game;
    game.bump = ctx.bumps.game;
    game.mint_bump = ctx.bumps.mint;
    game.game_id = game_id;
    game.name = name;
    game.mode = GameMode::General;
    game.admin = ctx.accounts.creator_user.key();
    game.mint = ctx.accounts.mint.key();
    let game_key = game.key();

    ctx.accounts.registry.active_games.push(game_key);

    Ok(())
}
```

(The `#[cfg(test)] mod tests` block from Step 3 stays at the bottom of the file unchanged — it still tests `ensure_registry_has_capacity` directly, not through `Context`.)

- [ ] **Step 6: Wire `create_game` into `lib.rs`**

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
```

Add this as a new method inside the `#[program] pub mod game_token_wallet { ... }` block, alongside `create_user`.

- [ ] **Step 7: Build the program and confirm it compiles for the BPF target**

Run: `just program-build`
Expected: succeeds, and regenerates `apps/on-chain-program/target/idl/game_token_wallet.json` including the new `create_game` instruction, `Game` account, `GameMode` type, and the three new error codes.

- [ ] **Step 8: Run the full unit test suite once more**

Run: `just test-program-unit`
Expected: PASS — all of `game`, `registry`, `user` sizing/logic tests green.

- [ ] **Step 9: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/Cargo.toml \
  apps/on-chain-program/programs/game_token_wallet/src/errors.rs \
  apps/on-chain-program/programs/game_token_wallet/src/instructions/game \
  apps/on-chain-program/programs/game_token_wallet/src/instructions/mod.rs \
  apps/on-chain-program/programs/game_token_wallet/src/lib.rs \
  apps/on-chain-program/Cargo.lock
git commit -m "feat(on-chain): add create_game instruction"
```

---

### Task 3: Regenerate `on-chain-client` and verify the new bindings

**Files:**
- Modify (generated, not hand-edited): `apps/on-chain-client/src/generated/**`
- Modify: `apps/on-chain-client/src/index.test.ts`

**Interfaces:**
- Consumes: `apps/on-chain-program/target/idl/game_token_wallet.json` (produced by Task 2, Step 7).
- Produces (exact names to verify below): `findGamePda`, `fetchGame`, `fetchMaybeGame`, `getCreateGameInstructionAsync`, `GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH`, `GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS`, `GAME_TOKEN_WALLET_ERROR__REGISTRY_FULL`, and a `GameMode` export — re-exported from `on-chain-client`.

- [ ] **Step 1: Run codegen**

Run (from repo root): `pnpm codegen`
Expected: runs `anchor build` again then `codama generate`, logs `Generated on-chain-client from .../game_token_wallet.json`.

- [ ] **Step 2: Inspect the generated `GameMode` shape**

Codama renders a Rust enum with **no data on any variant** as a plain TypeScript `enum` (a "scalar enum"), not a `{ __kind: "..." }` discriminated union — that shape is only used when at least one variant carries fields. Confirm this by opening the generated file (path will be something like `apps/on-chain-client/src/generated/types/gameMode.ts`) and checking it exports `export enum GameMode { General, Poker, Pool }` (or equivalent). This determines how Task 4's e2e test asserts on `game.data.mode` — use `GameMode.General` (imported from `on-chain-client`) if it's a scalar enum as expected; if Codama instead rendered a discriminated union, use `{ __kind: "General" }` there instead. Note which form it actually is before writing Task 4.

- [ ] **Step 3: Add a regression test to `apps/on-chain-client/src/index.test.ts`**

Add to the existing `describe("generated on-chain-client", ...)` block:

```ts
  it("exports a game PDA finder, account fetcher, create instruction builder, and error helpers", () => {
    expect(typeof findGamePda).toBe("function");
    expect(typeof fetchGame).toBe("function");
    expect(typeof getCreateGameInstructionAsync).toBe("function");
    expect(typeof GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH).toBe("number");
    expect(typeof GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS).toBe("number");
    expect(typeof GAME_TOKEN_WALLET_ERROR__REGISTRY_FULL).toBe("number");
  });
```

And extend the top-of-file import list:

```ts
import {
  getNoopInstruction,
  GAME_TOKEN_WALLET_PROGRAM_ADDRESS,
  getInitializeRegistryInstructionAsync,
  findRegistryPda,
  fetchMaybeRegistry,
  getCreateUserInstructionAsync,
  findUserPda,
  fetchMaybeUser,
  GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH,
  findGamePda,
  fetchGame,
  getCreateGameInstructionAsync,
  GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH,
  GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS,
  GAME_TOKEN_WALLET_ERROR__REGISTRY_FULL,
  isGameTokenWalletError,
} from "./index";
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `just test-on-chain-client`
Expected: PASS, including the new `create_game` bindings test.

- [ ] **Step 5: Commit**

```bash
git add apps/on-chain-client/src/generated apps/on-chain-client/src/index.test.ts
git commit -m "chore(on-chain-client): regenerate client for create_game"
```

---

### Task 4: On-chain e2e tests for `create_game`

**Files:**
- Modify: `apps/on-chain-program-e2e/package.json`
- Create: `apps/on-chain-program-e2e/tests/game/create_game.test.ts`

**Interfaces:**
- Consumes: `getCreateUserInstructionAsync`, `getCreateGameInstructionAsync`, `findGamePda`, `fetchGame`, `findRegistryPda`, `fetchRegistry`, `GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH`, `GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS`, `isGameTokenWalletError` (all from `on-chain-client`, Task 3); `fetchMint` (from the new `@solana-program/token` devDependency).

- [ ] **Step 1: Add the `@solana-program/token` devDependency**

Edit `apps/on-chain-program-e2e/package.json`, add to `"devDependencies"`:

```json
    "@solana-program/token": "^0.5.1"
```

Run: `pnpm install`
Expected: lockfile updates, no other changes.

- [ ] **Step 2: Write `tests/game/create_game.test.ts`**

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
import { fetchMint } from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  findGamePda,
  fetchGame,
  findRegistryPda,
  fetchRegistry,
  GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH,
  GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS,
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

// Typed against each instruction builder's own return type (rather than one
// shared `Instruction`-typed helper) to match this file's neighbors
// (create_user.test.ts, registry/initialize.test.ts), which don't share a
// generic send helper across different instruction builders either.
async function sendCreateUserInstruction(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  instruction: Awaited<ReturnType<typeof getCreateUserInstructionAsync>>,
): Promise<void> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(admin, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([instruction], tx),
  );
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
}

async function sendCreateGameInstruction(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  instruction: Awaited<ReturnType<typeof getCreateGameInstructionAsync>>,
): Promise<void> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(admin, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([instruction], tx),
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
  await sendCreateUserInstruction(rpc, rpcSubscriptions, admin, createUserInstruction);
  return admin;
}

function gameId(fill: number): Uint8Array {
  return new Uint8Array(16).fill(fill);
}

describe("create_game instruction", () => {
  it("creates the Game account, its mint, and appends it to the registry", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await registeredAdmin(rpc, rpcSubscriptions, "gamehost1");
    const id = gameId(1);

    const instruction = await getCreateGameInstructionAsync({
      admin,
      username: "gamehost1",
      gameId: id,
      name: "Friday Poker",
    });
    await sendCreateGameInstruction(rpc, rpcSubscriptions, admin, instruction);

    const [gameAddress] = await findGamePda({ gameId: id });
    const game = await fetchGame(rpc, gameAddress);
    expect(game.data.name).toBe("Friday Poker");
    expect(new Uint8Array(game.data.gameId)).toEqual(id);

    const [registryAddress] = await findRegistryPda();
    const registry = await fetchRegistry(rpc, registryAddress);
    expect(registry.data.activeGames).toContain(gameAddress);

    const mint = await fetchMint(rpc, game.data.mint);
    expect(mint.data.decimals).toBe(2);
    expect(mint.data.mintAuthority).toEqual({ __option: "Some", value: gameAddress });
  }, 30_000);

  it("rejects a game name shorter than 3 bytes with InvalidGameNameLength", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await registeredAdmin(rpc, rpcSubscriptions, "gamehost2");

    const instruction = await getCreateGameInstructionAsync({
      admin,
      username: "gamehost2",
      gameId: gameId(2),
      name: "ab",
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([instruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected transaction to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH,
        ),
      ).toBe(true);
    }
  }, 30_000);

  it("rejects a game name over 32 bytes with InvalidGameNameLength", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await registeredAdmin(rpc, rpcSubscriptions, "gamehost3");

    const instruction = await getCreateGameInstructionAsync({
      admin,
      username: "gamehost3",
      gameId: gameId(3),
      name: "a".repeat(33),
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([instruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected transaction to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH,
        ),
      ).toBe(true);
    }
  }, 30_000);

  it("rejects a game name containing a disallowed character with InvalidGameNameCharacters", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await registeredAdmin(rpc, rpcSubscriptions, "gamehost4");

    const instruction = await getCreateGameInstructionAsync({
      admin,
      username: "gamehost4",
      gameId: gameId(4),
      name: "Friday!",
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([instruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected transaction to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS,
        ),
      ).toBe(true);
    }
  }, 30_000);
});
```

Note: `game.data.mode` is deliberately not asserted here — Task 3 Step 2 determined its exact generated shape; if you want to assert it, add one line using whichever form (`GameMode.General` or `{ __kind: "General" }`) Task 3 confirmed, importing `GameMode` from `on-chain-client` if needed.

- [ ] **Step 3: Run the e2e suite**

Run: `just deploy-program-local` (once, if not already deployed locally) then `just test-e2e-program`
Expected: PASS — all 4 new tests green, plus the existing `noop`/`registry`/`user` e2e tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/on-chain-program-e2e/package.json pnpm-lock.yaml apps/on-chain-program-e2e/tests/game
git commit -m "test(on-chain-program-e2e): cover create_game"
```

---

### Task 5: Frontend game-name validation (`lib/game-name.ts`)

**Files:**
- Create: `apps/frontend/src/lib/game-name.ts`
- Create: `apps/frontend/src/lib/game-name.test.ts`

**Interfaces:**
- Produces: `MIN_GAME_NAME_BYTES: number`, `MAX_GAME_NAME_BYTES: number`, `normalizeGameName(input: string): string`, `validateGameName(normalized: string): { valid: true } | { valid: false; reason: string }`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/lib/game-name.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeGameName, validateGameName } from "./game-name";

describe("normalizeGameName", () => {
  it("NFC-normalizes decomposed accented Latin input to its precomposed form", () => {
    const decomposed = "Café Night"; // "e" + combining acute accent
    expect(normalizeGameName(decomposed)).toBe("Café Night");
  });

  it("does not case-fold, unlike normalizeUsername", () => {
    expect(normalizeGameName("Friday Poker")).toBe("Friday Poker");
  });
});

describe("validateGameName", () => {
  it("accepts a normal ASCII name", () => {
    expect(validateGameName("Friday Poker")).toEqual({ valid: true });
  });

  it("accepts a single 3-byte CJK character at the minimum byte length", () => {
    expect(validateGameName("火")).toEqual({ valid: true });
  });

  it("accepts a name containing a space", () => {
    expect(validateGameName("Poker Night")).toEqual({ valid: true });
  });

  it("rejects a name below the 3-byte minimum", () => {
    expect(validateGameName("ab").valid).toBe(false);
  });

  it("accepts a name at exactly the 32-byte maximum", () => {
    expect(validateGameName("a".repeat(32))).toEqual({ valid: true });
  });

  it("rejects a name over the 32-byte maximum", () => {
    expect(validateGameName("a".repeat(33)).valid).toBe(false);
  });

  it("rejects a name containing a disallowed symbol", () => {
    expect(validateGameName("Friday!").valid).toBe(false);
  });
});
```

Run: `pnpm --filter frontend run test -- game-name`
Expected: FAIL — `Cannot find module './game-name'`.

- [ ] **Step 2: Write `lib/game-name.ts`**

```ts
export const MIN_GAME_NAME_BYTES = 3;
export const MAX_GAME_NAME_BYTES = 32;

const GAME_NAME_CHARSET = /^[\p{L}\p{N} ]+$/u;

export function normalizeGameName(input: string): string {
  return input.normalize("NFC");
}

export function validateGameName(
  normalized: string,
): { valid: true } | { valid: false; reason: string } {
  const byteLength = new TextEncoder().encode(normalized).length;
  if (byteLength < MIN_GAME_NAME_BYTES || byteLength > MAX_GAME_NAME_BYTES) {
    return {
      valid: false,
      reason: `Game name must be between ${MIN_GAME_NAME_BYTES} and ${MAX_GAME_NAME_BYTES} bytes`,
    };
  }
  if (!GAME_NAME_CHARSET.test(normalized)) {
    return { valid: false, reason: "Game name can only contain letters, numbers, and spaces" };
  }
  return { valid: true };
}
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `pnpm --filter frontend run test -- game-name`
Expected: PASS — all 9 cases green.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/lib/game-name.ts apps/frontend/src/lib/game-name.test.ts
git commit -m "feat(frontend): add game name validation"
```

---

### Task 6: Frontend UUID v7 generator (`server/game-id.ts`)

**Files:**
- Create: `apps/frontend/src/server/game-id.ts`
- Create: `apps/frontend/src/server/game-id.test.ts`

**Interfaces:**
- Produces: `generateGameId(): Uint8Array` (16 bytes, RFC 9562 UUID v7 layout).

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/server/game-id.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateGameId } from "./game-id";

describe("generateGameId", () => {
  it("returns 16 bytes", () => {
    expect(generateGameId().length).toBe(16);
  });

  it("sets the version nibble to 7 (byte 6, high nibble)", () => {
    const id = generateGameId();
    expect(id[6] >> 4).toBe(0x7);
  });

  it("sets the variant bits to 0b10 (byte 8, top 2 bits)", () => {
    const id = generateGameId();
    expect(id[8] >> 6).toBe(0b10);
  });

  it("encodes a timestamp within 1 second of Date.now()", () => {
    const before = Date.now();
    const id = generateGameId();
    const after = Date.now();

    let ts = 0n;
    for (let i = 0; i < 6; i++) {
      ts = (ts << 8n) | BigInt(id[i]);
    }
    const timestamp = Number(ts);

    expect(timestamp).toBeGreaterThanOrEqual(before - 1000);
    expect(timestamp).toBeLessThanOrEqual(after + 1000);
  });

  it("generates unique ids across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => Buffer.from(generateGameId()).toString("hex")));
    expect(ids.size).toBe(1000);
  });
});
```

Run: `pnpm --filter frontend run test -- game-id`
Expected: FAIL — `Cannot find module './game-id'`.

- [ ] **Step 2: Write `server/game-id.ts`**

```ts
const VERSION_NIBBLE = 0x70; // 0b0111 in the high nibble of byte 6
const VARIANT_BITS = 0x80; // 0b10 in the high 2 bits of byte 8

// Hand-rolled RFC 9562 UUID v7: 48-bit ms timestamp + random bits.
// Node's built-in crypto.randomUUID() only produces v4, so this repo
// hand-rolls v7 rather than adding a new dependency (matches the
// session-cookie HMAC signing precedent in ticket 003).
export function generateGameId(): Uint8Array {
  const bytes = new Uint8Array(16);
  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  const random = new Uint8Array(10);
  globalThis.crypto.getRandomValues(random);

  bytes[6] = VERSION_NIBBLE | (random[0] & 0x0f);
  bytes[7] = random[1];
  bytes[8] = VARIANT_BITS | (random[2] & 0x3f);
  bytes.set(random.subarray(3), 9);

  return bytes;
}
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `pnpm --filter frontend run test -- game-id`
Expected: PASS — all 5 cases green.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/server/game-id.ts apps/frontend/src/server/game-id.test.ts
git commit -m "feat(frontend): hand-roll UUID v7 generation for game ids"
```

---

### Task 7: `createGame`/`listMyGames` Server Actions

**Files:**
- Create: `apps/frontend/src/server/actions/game.ts`
- Create: `apps/frontend/src/server/actions/game.test.ts`

**Interfaces:**
- Consumes: `normalizeGameName`, `validateGameName` (Task 5); `generateGameId` (Task 6); `getSolanaContext` (existing `../connection`); `getCurrentUsername` (existing `./auth`); `findUserPda`, `findRegistryPda`, `fetchMaybeRegistry`, `fetchGame`, `getCreateGameInstructionAsync` (`on-chain-client`, Task 3).
- Produces: `createGame(input: { name: string }): Promise<{ ok: true } | { ok: false; error: string }>`, `listMyGames(): Promise<Array<{ address: string; name: string }>>`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/server/actions/game.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MaybeAccount, Account } from "@solana/kit";
import type { Registry, Game } from "on-chain-client";

const { mockGetSolanaContext } = vi.hoisted(() => ({ mockGetSolanaContext: vi.fn() }));
vi.mock("../connection", () => ({ getSolanaContext: mockGetSolanaContext }));

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("./auth", () => ({ getCurrentUsername: mockGetCurrentUsername }));

const { mockGenerateGameId } = vi.hoisted(() => ({ mockGenerateGameId: vi.fn() }));
vi.mock("../game-id", () => ({ generateGameId: mockGenerateGameId }));

const {
  mockFindUserPda,
  mockFindRegistryPda,
  mockFetchMaybeRegistry,
  mockFetchGame,
  mockGetCreateGameInstructionAsync,
} = vi.hoisted(() => ({
  mockFindUserPda: vi.fn(),
  mockFindRegistryPda: vi.fn(),
  mockFetchMaybeRegistry: vi.fn(),
  mockFetchGame: vi.fn(),
  mockGetCreateGameInstructionAsync: vi.fn(),
}));
vi.mock("on-chain-client", () => ({
  findUserPda: mockFindUserPda,
  findRegistryPda: mockFindRegistryPda,
  fetchMaybeRegistry: mockFetchMaybeRegistry,
  fetchGame: mockFetchGame,
  getCreateGameInstructionAsync: mockGetCreateGameInstructionAsync,
}));

const { mockSignTransactionMessageWithSigners, mockSendAndConfirmTransaction } = vi.hoisted(() => ({
  mockSignTransactionMessageWithSigners: vi.fn(),
  mockSendAndConfirmTransaction: vi.fn(),
}));
vi.mock("@solana/kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/kit")>();
  return {
    ...actual,
    signTransactionMessageWithSigners: mockSignTransactionMessageWithSigners,
    assertIsTransactionWithBlockhashLifetime: vi.fn(),
    sendAndConfirmTransactionFactory: () => mockSendAndConfirmTransaction,
  };
});

import { createGame, listMyGames } from "./game";

const ADMIN_ADDRESS = "Admin111111111111111111111111111111111111";
const USER_ADDRESS = "User1111111111111111111111111111111111111";
const REGISTRY_ADDRESS = "Regi11111111111111111111111111111111111111";
const PROGRAM_ADDRESS = "Prog1111111111111111111111111111111111111";
const GAME_ID_BYTES = new Uint8Array(16).fill(7);

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
    ...overrides,
  } as Game;
}

describe("createGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockGenerateGameId.mockReturnValue(GAME_ID_BYTES);
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
    mockGetCreateGameInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignTransactionMessageWithSigners.mockResolvedValue({});
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);
  });

  it("rejects when not signed in, without touching the chain", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    const result = await createGame({ name: "Friday Poker" });
    expect(result).toEqual({ ok: false, error: "Not signed in" });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects an invalid name before touching the chain", async () => {
    const result = await createGame({ name: "ab" });
    expect(result.ok).toBe(false);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("creates the game and sends the transaction on success", async () => {
    await expect(createGame({ name: "Friday Poker" })).resolves.toEqual({ ok: true });
    expect(mockGetCreateGameInstructionAsync).toHaveBeenCalledWith(
      { admin: { address: ADMIN_ADDRESS }, username: "alice", gameId: GAME_ID_BYTES, name: "Friday Poker" },
      { programAddress: PROGRAM_ADDRESS },
    );
    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("listMyGames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockGetSolanaContext.mockResolvedValue({
      rpc: {},
      rpcSubscriptions: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    mockFindRegistryPda.mockResolvedValue([REGISTRY_ADDRESS, 255]);
  });

  it("returns an empty list when not signed in", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(listMyGames()).resolves.toEqual([]);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("returns an empty list when the registry doesn't exist yet", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({ exists: false } as MaybeAccount<Registry>);
    await expect(listMyGames()).resolves.toEqual([]);
  });

  it("returns only games admined by the current user", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1", "Game2"] },
    } as MaybeAccount<Registry>);
    mockFetchGame
      .mockResolvedValueOnce({
        address: "Game1",
        data: gameData({ admin: USER_ADDRESS, name: "Mine" }),
      } as Account<Game>)
      .mockResolvedValueOnce({
        address: "Game2",
        data: gameData({ admin: "SomeoneElse11111111111111111111111111111", name: "Not mine" }),
      } as Account<Game>);

    await expect(listMyGames()).resolves.toEqual([{ address: "Game1", name: "Mine" }]);
  });
});
```

Run: `pnpm --filter frontend run test -- server/actions/game`
Expected: FAIL — `Cannot find module './game'`.

- [ ] **Step 2: Write `server/actions/game.ts`**

```ts
"use server";

import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import {
  findUserPda,
  findRegistryPda,
  fetchMaybeRegistry,
  fetchGame,
  getCreateGameInstructionAsync,
} from "on-chain-client";
import { normalizeGameName, validateGameName } from "@/lib/game-name";
import { getSolanaContext } from "../connection";
import { generateGameId } from "../game-id";
import { getCurrentUsername } from "./auth";

export interface CreateGameInput {
  name: string;
}

export type CreateGameResult = { ok: true } | { ok: false; error: string };

export async function createGame(input: CreateGameInput): Promise<CreateGameResult> {
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in" };
  }

  const normalizedName = normalizeGameName(input.name);
  const nameCheck = validateGameName(normalizedName);
  if (!nameCheck.valid) {
    return { ok: false, error: nameCheck.reason };
  }

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();
  const gameId = generateGameId();

  const createGameInstruction = await getCreateGameInstructionAsync(
    { admin: adminSigner, username, gameId, name: normalizedName },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([createGameInstruction], tx),
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });

  return { ok: true };
}

export interface MyGame {
  address: string;
  name: string;
}

export async function listMyGames(): Promise<MyGame[]> {
  const username = await getCurrentUsername();
  if (!username) return [];

  const { rpc, adminSigner, programAddress } = await getSolanaContext();
  const [userAddress] = await findUserPda({ username, admin: adminSigner.address }, { programAddress });
  const [registryAddress] = await findRegistryPda({ programAddress });
  const registry = await fetchMaybeRegistry(rpc, registryAddress);
  if (!registry.exists) return [];

  const games = await Promise.all(
    registry.data.activeGames.map((gameAddress) => fetchGame(rpc, gameAddress)),
  );

  return games
    .filter((game) => game.data.admin === userAddress)
    .map((game) => ({ address: game.address, name: game.data.name }));
}
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `pnpm --filter frontend run test -- server/actions/game`
Expected: PASS — all 6 cases green.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/server/actions/game.ts apps/frontend/src/server/actions/game.test.ts
git commit -m "feat(frontend): add createGame and listMyGames server actions"
```

---

### Task 8: Creation form page (`/games/new`)

**Files:**
- Create: `apps/frontend/src/app/(app)/games/new/page.tsx`
- Create: `apps/frontend/src/app/(app)/games/new/page.test.tsx`

**Interfaces:**
- Consumes: `createGame` (Task 7); `normalizeGameName`, `validateGameName` (Task 5); `Button`, `Input`, `Alert` (existing `components/ui`).

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/app/(app)/games/new/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockCreateGame } = vi.hoisted(() => ({ mockCreateGame: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ createGame: mockCreateGame }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import NewGamePage from "./page";

describe("NewGamePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a live hint for an invalid name without submitting", async () => {
    const user = userEvent.setup();
    render(<NewGamePage />);
    await user.type(screen.getByLabelText("Game name"), "ab");
    expect(await screen.findByTestId("game-name-hint")).toBeInTheDocument();
    expect(mockCreateGame).not.toHaveBeenCalled();
  });

  it("submits and redirects to /games on success", async () => {
    mockCreateGame.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<NewGamePage />);
    await user.type(screen.getByLabelText("Game name"), "Friday Poker");
    await user.click(screen.getByRole("button", { name: "Create game" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/games"));
    expect(mockCreateGame).toHaveBeenCalledWith({ name: "Friday Poker" });
  });

  it("shows the error alert when creation fails", async () => {
    mockCreateGame.mockResolvedValue({ ok: false, error: "Registry is full" });
    const user = userEvent.setup();
    render(<NewGamePage />);
    await user.type(screen.getByLabelText("Game name"), "Friday Poker");
    await user.click(screen.getByRole("button", { name: "Create game" }));

    expect(await screen.findByTestId("create-game-error")).toHaveTextContent("Registry is full");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows a fallback error alert when createGame throws an unexpected error", async () => {
    mockCreateGame.mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();
    render(<NewGamePage />);
    await user.type(screen.getByLabelText("Game name"), "Friday Poker");
    await user.click(screen.getByRole("button", { name: "Create game" }));

    expect(await screen.findByTestId("create-game-error")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter frontend run test -- games/new`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 2: Write `app/(app)/games/new/page.tsx`**

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createGame } from "@/server/actions/game";
import { normalizeGameName, validateGameName } from "@/lib/game-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function NewGamePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const nameCheck = name ? validateGameName(normalizeGameName(name)) : null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await createGame({ name });
        if (result.ok) {
          router.push("/games");
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 className="text-3xl font-extrabold text-text-primary">Create game</h1>
      <p className="text-sm font-semibold text-text-secondary">General Mode</p>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3.5">
        <div>
          <label htmlFor="game-name" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Game name
          </label>
          <Input
            id="game-name"
            type="text"
            placeholder="Friday Poker"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          {nameCheck && !nameCheck.valid && (
            <p data-testid="game-name-hint" className="mt-1 text-xs text-danger">
              {nameCheck.reason}
            </p>
          )}
        </div>
        {error && (
          <Alert data-testid="create-game-error" variant="error" className="break-all">
            {error}
          </Alert>
        )}
        <Button type="submit" variant="primary" isLoading={isPending} className="mt-1.5">
          Create game
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `pnpm --filter frontend run test -- games/new`
Expected: PASS — all 4 cases green.

- [ ] **Step 4: Commit**

```bash
git add "apps/frontend/src/app/(app)/games/new"
git commit -m "feat(frontend): add game creation form page"
```

---

### Task 9: "My Games" list page (`/games`)

**Files:**
- Create: `apps/frontend/src/app/(app)/games/page.tsx`
- Create: `apps/frontend/src/app/(app)/games/page.test.tsx`

**Interfaces:**
- Consumes: `getCurrentUsername` (existing `@/server/actions/auth`); `listMyGames` (Task 7); `Button` (existing `components/ui`).

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/app/(app)/games/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ getCurrentUsername: mockGetCurrentUsername }));

const { mockListMyGames } = vi.hoisted(() => ({ mockListMyGames: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ listMyGames: mockListMyGames }));

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import GamesPage from "./page";

describe("GamesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await GamesPage();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("shows an empty state when the user has no games", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyGames.mockResolvedValue([]);
    const jsx = await GamesPage();
    render(jsx);
    expect(screen.getByTestId("games-empty")).toBeInTheDocument();
  });

  it("lists the user's games with an admin badge", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyGames.mockResolvedValue([{ address: "Game1", name: "Friday Poker" }]);
    const jsx = await GamesPage();
    render(jsx);
    expect(screen.getByTestId("games-list")).toHaveTextContent("Friday Poker");
    expect(screen.getByTestId("games-list")).toHaveTextContent("Admin");
  });

  it("links to the creation form", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyGames.mockResolvedValue([]);
    const jsx = await GamesPage();
    render(jsx);
    expect(screen.getByRole("link", { name: "New game" })).toHaveAttribute("href", "/games/new");
  });
});
```

Run: `pnpm --filter frontend run test -- games/page`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 2: Write `app/(app)/games/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { listMyGames } from "@/server/actions/game";
import { Button } from "@/components/ui/button";

export default async function GamesPage() {
  const username = await getCurrentUsername();
  if (!username) {
    redirect("/login");
  }

  const games = await listMyGames();

  return (
    <main className="py-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-text-primary">My games</h1>
        <Button asChild variant="primary">
          <Link href="/games/new">New game</Link>
        </Button>
      </div>
      {games.length === 0 ? (
        <p data-testid="games-empty" className="text-sm font-semibold text-text-secondary">
          You haven&apos;t created a game yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="games-list">
          {games.map((game) => (
            <li key={game.address} className="glass-row flex items-center justify-between px-4 py-3">
              <span className="text-sm font-bold text-text-primary">{game.name}</span>
              <span className="text-xs font-semibold text-cyan-accent">Admin</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `pnpm --filter frontend run test -- games/page`
Expected: PASS — all 4 cases green.

- [ ] **Step 4: Commit**

```bash
git add "apps/frontend/src/app/(app)/games/page.tsx" "apps/frontend/src/app/(app)/games/page.test.tsx"
git commit -m "feat(frontend): add My Games list page"
```

---

### Task 10: Playwright e2e coverage (`apps/e2e`)

**Files:**
- Create: `apps/e2e/tests/game-creation.spec.ts`

**Interfaces:**
- Consumes: the live `/register`, `/games`, `/games/new` pages (Tasks 8, 9), driven against the prod-built Docker stack per `docker-compose.e2e.yml`.

- [ ] **Step 1: Write `apps/e2e/tests/game-creation.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

function uniqueUsername(): string {
  return `e2egamehost${Date.now()}`;
}

test.describe("game creation", () => {
  test("a logged-in user creates a game and sees it in their games list", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });

    await page.goto("/games");
    await expect(page.getByTestId("games-empty")).toBeVisible();

    await page.getByRole("link", { name: "New game" }).click();
    await expect(page).toHaveURL(/\/games\/new$/);

    await page.getByLabel("Game name").fill("Friday Poker");
    await page.getByRole("button", { name: "Create game" }).click();

    await expect(page).toHaveURL(/\/games$/, { timeout: 30_000 });
    await expect(page.getByTestId("games-list")).toContainText("Friday Poker");
    await expect(page.getByTestId("games-list")).toContainText("Admin");
  });

  test("an invalid game name blocks submission with a live hint", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });

    await page.goto("/games/new");
    await page.getByLabel("Game name").fill("ab");
    await expect(page.getByTestId("game-name-hint")).toBeVisible();
    await expect(page).toHaveURL(/\/games\/new$/);
  });
});
```

- [ ] **Step 2: Run the e2e Playwright suite against the prod-built Docker stack**

Run:
```bash
docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e surfpool program-deploy frontend e2e
docker compose -f docker-compose.e2e.yml down
```
Expected: PASS — both new `game-creation.spec.ts` tests green, plus the existing `noop`/`auth`/`admin-registry` specs still pass.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/game-creation.spec.ts
git commit -m "test(e2e): cover game creation flow"
```

---

### Task 11: Full verification — lint, typecheck, and manual run against the local stack

**Files:** none (verification only).

- [ ] **Step 1: Lint and typecheck everything**

Run: `just lint && just typecheck`
Expected: PASS, no changes needed. (Per `CLAUDE.local.md`, if `pnpm lint` behaves unexpectedly, cross-check with `rtk proxy pnpm lint`.)

- [ ] **Step 2: Run the full test matrix**

Run: `just test`
Expected: PASS — `cargo test`, frontend vitest, `on-chain-client` vitest, `on-chain-program-e2e` (`anchor test`), and `apps/e2e` (Playwright, prod-built Docker stack) all green.

- [ ] **Step 3: Manual verification against the local docker-compose/Surfpool stack**

Run: `just up-build` (first run) or `just up` (subsequent runs), then `just deploy-program-local`.

In the browser:
1. Register a new user (or log in with an existing one) at `/register` / `/login`.
2. Navigate to `/games`. Confirm the empty state ("You haven't created a game yet.") renders.
3. Click "New game", enter a valid name (e.g. "Friday Poker"), submit.
4. Confirm redirect to `/games` and the new game appears in the list with an "Admin" badge.
5. Try `/games/new` again with an invalid name (e.g. "ab" or "Friday!") — confirm the live hint blocks submission.
6. Refresh `/games` — confirm the game is still listed (proves it's read from chain state, not local-only UI state).

Record the observed HTTP status/UI state here before marking this task done, per this repo's Done-Means rule — do not claim "done" without this evidence.

- [ ] **Step 4: Tear down**

Run: `just down-clean`
