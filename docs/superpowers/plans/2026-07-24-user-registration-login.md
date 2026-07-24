# User Registration & Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new user register with a username/password (creating an on-chain `User` PDA with a hashed password) and log back in, with a stateless signed-cookie session that persists across page loads and gates access to authenticated pages and Server Actions.

**Architecture:** New on-chain `User` account (`state/user.rs`) + `create_user` instruction (`instructions/user/create_user.rs`), plus the repo's first custom error type (`errors.rs`). Off-chain: pure validation helpers in `lib/` (username normalization, password charset rules), a `node:crypto`-scrypt password-hashing module and a Web-Crypto HMAC-signed-cookie session module under `server/` (server-only, never bundled to the client), Server Actions (`register`/`login`/`logout`/`getCurrentUsername`), `middleware.ts` gating all routes except `/`, `/login`, `/register`, and `/admin/*`, and three new pages (`register`, `login`, `home`).

**Tech Stack:** Anchor 1.x (Rust), `@solana/kit`, Codama-generated `on-chain-client`, Next.js Server Actions + Middleware, `node:crypto` (scrypt, timingSafeEqual), Web Crypto (`crypto.subtle` HMAC-SHA256), Vitest, `@testing-library/react`, Playwright.

Full spec/rationale: `docs/superpowers/specs/2026-07-24-user-registration-login-design.md`.

## Global Constraints

- Username: normalized as `input.normalize("NFC").toLowerCase().normalize("NFC")`, validated as 3–32 UTF-8 bytes, charset `/^[\p{L}\p{N} ]+$/u` (Unicode letters, numbers, space only). `MAX_USERNAME_BYTES = 32` is a hard Solana per-seed limit, not a style choice.
- Password: 8–20 characters, charset `/^[A-Za-z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/`. Never reaches the chain — only its hash does.
- Password hashing: `node:crypto`'s `scrypt` with Node's own defaults (`N=16384, r=8, p=1`), 16-byte random salt per user, 64-byte derived key. `User::INIT_SPACE = 117` bytes (`1 + (4 + 32) + 16 + 64`) — verified against a real `anchor build` during planning, not computed by hand.
- Session: HMAC-SHA256-signed cookie (`{ username, exp }`, base64url JSON), cookie name `session`, 7-day fixed TTL, verified via `crypto.subtle` (portable across Edge/Node middleware runtimes) — never `node:crypto` in `session.ts`.
- `/admin/registry` is explicitly NOT gated by this ticket — left exactly as ticket 002 shipped it (see design doc Q13).
- Login failure always throws the exact string `"Invalid username or password"`, regardless of whether the username exists — including a dummy scrypt hash on the not-found path so response timing doesn't leak existence either.
- Commits follow Conventional Commits (enforced by `.hooks/commit-msg`).
- **Before Task 1:** create a new branch `feat/003-user-registration-login` off the current branch (`docs/003-writing-plan`, which already holds the approved spec) — do not implement on the docs branch itself.
- Interfaces marked "verified during planning" below were confirmed by actually building the on-chain program and running Codama codegen while writing this plan (then reverting the source changes) — they are exact, not guesses.

---

### Task 1: `User` on-chain account state

**Files:**
- Create: `apps/on-chain-program/programs/game_token_wallet/src/state/user.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/state/mod.rs`
- Test: inline `#[cfg(test)] mod tests` in `state/user.rs`, run via `cargo test`

**Interfaces:**
- Produces: `pub const MIN_USERNAME_BYTES: usize = 3;`, `pub const MAX_USERNAME_BYTES: usize = 32;`, `pub const SALT_BYTES: usize = 16;`, `pub const PASSWORD_HASH_BYTES: usize = 64;`, `pub struct User { pub bump: u8, pub username: String, pub salt: [u8; 16], pub password_hash: [u8; 64] }` (Anchor `#[account]` + `#[derive(InitSpace)]`), re-exported as `state::User` / `state::MIN_USERNAME_BYTES` / `state::MAX_USERNAME_BYTES`. Task 2 consumes all of these.

- [ ] **Step 1: Create a new branch**

Run: `git checkout -b feat/003-user-registration-login`
Expected: Switched to a new branch, based on the current `docs/003-writing-plan`.

- [ ] **Step 2: Create the module skeleton and a failing test**

Modify `apps/on-chain-program/programs/game_token_wallet/src/state/mod.rs` to:

```rust
pub mod registry;
pub mod user;

pub use registry::*;
pub use user::*;
```

Create `apps/on-chain-program/programs/game_token_wallet/src/state/user.rs` with ONLY the test (the type it references doesn't exist yet, so this won't compile):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_init_space_accounts_for_max_username_salt_and_hash() {
        // 1 byte bump + (4 byte String length prefix + MAX_USERNAME_BYTES) + SALT_BYTES + PASSWORD_HASH_BYTES.
        let expected = 1 + (4 + MAX_USERNAME_BYTES) + SALT_BYTES + PASSWORD_HASH_BYTES;
        assert_eq!(User::INIT_SPACE, expected);
    }
}
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `cd apps/on-chain-program && cargo test user_init_space`
Expected: FAIL to compile — `cannot find type \`User\` in this scope` / `cannot find value \`MAX_USERNAME_BYTES\` in this scope`.

- [ ] **Step 4: Implement the `User` account**

Replace the full contents of `apps/on-chain-program/programs/game_token_wallet/src/state/user.rs` with:

```rust
use anchor_lang::prelude::*;

pub const MIN_USERNAME_BYTES: usize = 3;
pub const MAX_USERNAME_BYTES: usize = 32;
pub const SALT_BYTES: usize = 16;
pub const PASSWORD_HASH_BYTES: usize = 64;

#[account]
#[derive(InitSpace)]
pub struct User {
    pub bump: u8,
    #[max_len(MAX_USERNAME_BYTES)]
    pub username: String,
    pub salt: [u8; SALT_BYTES],
    pub password_hash: [u8; PASSWORD_HASH_BYTES],
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_init_space_accounts_for_max_username_salt_and_hash() {
        // 1 byte bump + (4 byte String length prefix + MAX_USERNAME_BYTES) + SALT_BYTES + PASSWORD_HASH_BYTES.
        let expected = 1 + (4 + MAX_USERNAME_BYTES) + SALT_BYTES + PASSWORD_HASH_BYTES;
        assert_eq!(User::INIT_SPACE, expected);
    }
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd apps/on-chain-program && cargo test user_init_space`
Expected: PASS — `test state::user::tests::user_init_space_accounts_for_max_username_salt_and_hash ... ok`. (Verified during planning: `User::INIT_SPACE` evaluates to 117.)

- [ ] **Step 6: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/state/mod.rs \
        apps/on-chain-program/programs/game_token_wallet/src/state/user.rs
git commit -m "feat(program): add User account state"
```

---

### Task 2: `create_user` instruction and the repo's first custom error type

**Files:**
- Create: `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/user/mod.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/user/create_user.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/mod.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`

**Interfaces:**
- Consumes: `state::User`, `state::MIN_USERNAME_BYTES`, `state::MAX_USERNAME_BYTES` (Task 1).
- Produces: `instructions::CreateUser` (Anchor `Accounts` struct), `instructions::user::create_user::handler(ctx, username, salt, password_hash) -> Result<()>`, wired into the `#[program]` module as `create_user`; `errors::ErrorCode::InvalidUsernameLength`. Task 3's codegen depends on this instruction and error existing in the built IDL.

This task has no pure-logic unit test to drive red/green — the length check runs inside an Anchor `Context<CreateUser>`, which isn't practical to construct outside a real transaction. Real behavioral coverage (happy path, duplicate rejection, and the length-bound rejection) arrives in Task 4's integration test against a running validator, same reasoning as ticket 002's `initialize_registry` instruction task.

- [ ] **Step 1: Create the error type**

Create `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`:

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Username must be between 3 and 32 bytes")]
    InvalidUsernameLength,
}
```

- [ ] **Step 2: Create the instruction**

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/user/mod.rs`:

```rust
pub mod create_user;

pub use create_user::*;
```

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/user/create_user.rs`:

```rust
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::state::{User, MAX_USERNAME_BYTES, MIN_USERNAME_BYTES};

#[derive(Accounts)]
#[instruction(username: String)]
pub struct CreateUser<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + User::INIT_SPACE,
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateUser>,
    username: String,
    salt: [u8; 16],
    password_hash: [u8; 64],
) -> Result<()> {
    let byte_len = username.as_bytes().len();
    require!(
        byte_len >= MIN_USERNAME_BYTES && byte_len <= MAX_USERNAME_BYTES,
        ErrorCode::InvalidUsernameLength
    );

    ctx.accounts.user.bump = ctx.bumps.user;
    ctx.accounts.user.username = username;
    ctx.accounts.user.salt = salt;
    ctx.accounts.user.password_hash = password_hash;
    Ok(())
}
```

Modify `apps/on-chain-program/programs/game_token_wallet/src/instructions/mod.rs` to:

```rust
pub mod registry;
pub mod user;

pub use registry::*;
pub use user::*;
```

- [ ] **Step 3: Wire it into the program module**

Replace the full contents of `apps/on-chain-program/programs/game_token_wallet/src/lib.rs` with:

```rust
use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

// Wildcard import (not just `InitializeRegistry`) is required: the
// `#[derive(Accounts)]` macro also generates a hidden `__client_accounts_*`
// module that `#[program]`'s expansion looks up at the crate root — a named
// import wouldn't bring that hidden module into scope.
use instructions::*;

declare_id!("FHRNx4KK4WzMxXx7X6sK84RvKTKuDVtTGduW3eH9QN9t");

#[program]
pub mod game_token_wallet {
    use super::*;

    pub fn noop(_ctx: Context<Noop>) -> Result<()> {
        Ok(())
    }

    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        instructions::registry::initialize::handler(ctx)
    }

    pub fn create_user(
        ctx: Context<CreateUser>,
        username: String,
        salt: [u8; 16],
        password_hash: [u8; 64],
    ) -> Result<()> {
        instructions::user::create_user::handler(ctx, username, salt, password_hash)
    }
}

#[derive(Accounts)]
pub struct Noop {}
```

- [ ] **Step 4: Build and verify the IDL**

Run: `cd apps/on-chain-program && anchor build`
Expected: Build succeeds (warnings about `unexpected cfg condition` are pre-existing and harmless — same warnings the `registry` instruction already produces).

Run: `grep -c '"name": "create_user"' apps/on-chain-program/target/idl/game_token_wallet.json`
Expected: A non-zero count.

Run: `grep -c '"InvalidUsernameLength"' apps/on-chain-program/target/idl/game_token_wallet.json`
Expected: A non-zero count.

- [ ] **Step 5: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/errors.rs \
        apps/on-chain-program/programs/game_token_wallet/src/instructions \
        apps/on-chain-program/programs/game_token_wallet/src/lib.rs
git commit -m "feat(program): add create_user instruction"
```

---

### Task 3: Regenerate `on-chain-client` and extend the sanity test

**Files:**
- Modify (autogenerated, do not hand-edit): `apps/on-chain-client/src/generated/**`
- Modify: `apps/on-chain-client/src/index.test.ts`

**Interfaces:**
- Consumes: the built IDL from Task 2.
- Produces (verified during planning against a real preview build):
  - `findUserPda(seeds: { username: string; admin: Address }, config?: { programAddress?: Address }): Promise<ProgramDerivedAddress>`
  - `fetchMaybeUser(rpc, address, config?): Promise<MaybeAccount<User>>`, `fetchUser(rpc, address, config?): Promise<Account<User>>`
  - `getCreateUserInstructionAsync(input: { admin: TransactionSigner; user?: Address; systemProgram?: Address; username: string; salt: ReadonlyUint8Array; passwordHash: ReadonlyUint8Array }, config?): Promise<Instruction>` (auto-derives the `user` PDA from `admin` + `username` if not given, same convenience pattern as `getInitializeRegistryInstructionAsync`)
  - `User` type: `{ discriminator: ReadonlyUint8Array; bump: number; username: string; salt: ReadonlyUint8Array; passwordHash: ReadonlyUint8Array }` (note camelCase `passwordHash`)
  - `GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH: number` (value `0x1770` / 6000), `isGameTokenWalletError(error, transactionMessage, code?): boolean`

  Tasks 4, 8, and 9 consume these directly from `"on-chain-client"`.

- [ ] **Step 1: Regenerate the client**

Run (from repo root): `pnpm codegen`
Expected: Succeeds. `apps/on-chain-client/src/generated/` now additionally contains `accounts/user.ts`, `pdas/user.ts`, `instructions/createUser.ts`, and a new `errors/` directory (`gameTokenWallet.ts` + `index.ts`) — this is the first ticket to introduce a custom on-chain error, so this is also the first time `errors/` appears. `apps/on-chain-client/src/generated/index.ts` now reads:

```ts
export * from "./accounts";
export * from "./errors";
export * from "./instructions";
export * from "./pdas";
export * from "./programs";
```

- [ ] **Step 2: Extend the sanity test**

Replace the full contents of `apps/on-chain-client/src/index.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
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
  isGameTokenWalletError,
} from "./index";

describe("generated on-chain-client", () => {
  it("exports a noop instruction builder", () => {
    expect(typeof getNoopInstruction).toBe("function");
  });

  it("exports the program address as a non-empty string", () => {
    expect(typeof GAME_TOKEN_WALLET_PROGRAM_ADDRESS).toBe("string");
    expect(GAME_TOKEN_WALLET_PROGRAM_ADDRESS.length).toBeGreaterThan(0);
  });

  it("exports a registry PDA finder, account fetcher, and initialize instruction builder", () => {
    expect(typeof findRegistryPda).toBe("function");
    expect(typeof fetchMaybeRegistry).toBe("function");
    expect(typeof getInitializeRegistryInstructionAsync).toBe("function");
  });

  it("exports a user PDA finder, account fetcher, create instruction builder, and error helpers", () => {
    expect(typeof findUserPda).toBe("function");
    expect(typeof fetchMaybeUser).toBe("function");
    expect(typeof getCreateUserInstructionAsync).toBe("function");
    expect(typeof GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH).toBe("number");
    expect(typeof isGameTokenWalletError).toBe("function");
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter on-chain-client run test`
Expected: PASS — all 4 tests in `generated on-chain-client` green.

- [ ] **Step 4: Commit**

```bash
git add apps/on-chain-client/src/generated apps/on-chain-client/src/index.test.ts
git commit -m "feat(client): regenerate on-chain-client with User account, create_user, and error type"
```

---

### Task 4: `on-chain-program-e2e` integration tests

**Files:**
- Create: `apps/on-chain-program-e2e/tests/user/create_user.test.ts`

**Interfaces:**
- Consumes: `getCreateUserInstructionAsync`, `findUserPda`, `fetchUser`, `GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH`, `isGameTokenWalletError` from `"on-chain-client"` (Task 3).

- [ ] **Step 1: Write the test**

Create `apps/on-chain-program-e2e/tests/user/create_user.test.ts`:

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
  type KeyPairSigner,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import {
  getCreateUserInstructionAsync,
  findUserPda,
  fetchUser,
  GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH,
  isGameTokenWalletError,
} from "on-chain-client";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS_URL = process.env.SOLANA_RPC_WS_URL ?? "ws://127.0.0.1:8900";

interface CreateUserArgs {
  username: string;
  salt: Uint8Array;
  passwordHash: Uint8Array;
}

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

async function sendCreateUser(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  args: CreateUserArgs,
): Promise<void> {
  const instruction = await getCreateUserInstructionAsync({ admin, ...args });
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

describe("create_user instruction", () => {
  it("creates the User account with the given username, salt, and password hash", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const salt = new Uint8Array(16).fill(1);
    const passwordHash = new Uint8Array(64).fill(2);

    await sendCreateUser(rpc, rpcSubscriptions, admin, { username: "alice", salt, passwordHash });

    const [userAddress] = await findUserPda({ username: "alice", admin: admin.address });
    const userAccount = await fetchUser(rpc, userAddress);
    expect(userAccount.data.username).toBe("alice");
    expect(new Uint8Array(userAccount.data.salt)).toEqual(salt);
    expect(new Uint8Array(userAccount.data.passwordHash)).toEqual(passwordHash);
  }, 30_000);

  it("rejects a duplicate username for the same admin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const salt = new Uint8Array(16).fill(1);
    const passwordHash = new Uint8Array(64).fill(2);

    await sendCreateUser(rpc, rpcSubscriptions, admin, { username: "bob", salt, passwordHash });

    await expect(
      sendCreateUser(rpc, rpcSubscriptions, admin, { username: "bob", salt, passwordHash }),
    ).rejects.toThrow();
  }, 30_000);

  it("rejects a username shorter than 3 bytes with InvalidUsernameLength", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const salt = new Uint8Array(16);
    const passwordHash = new Uint8Array(64);

    const instruction = await getCreateUserInstructionAsync({ admin, username: "ab", salt, passwordHash });
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
        isGameTokenWalletError(error, transactionMessage, GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH),
      ).toBe(true);
    }
  }, 30_000);

  it("rejects a username longer than 32 bytes with InvalidUsernameLength", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const salt = new Uint8Array(16);
    const passwordHash = new Uint8Array(64);
    const tooLong = "a".repeat(33);

    const instruction = await getCreateUserInstructionAsync({ admin, username: tooLong, salt, passwordHash });
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
        isGameTokenWalletError(error, transactionMessage, GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH),
      ).toBe(true);
    }
  }, 30_000);
});
```

- [ ] **Step 2: Run it against a local validator**

Run: `cd apps/on-chain-program && anchor test`
Expected: PASS. Spins up a fresh local validator, deploys the program, then runs the full `on-chain-program-e2e` suite (`noop.test.ts`, `registry/initialize.test.ts`, and the new `user/create_user.test.ts`) — all green.

- [ ] **Step 3: Commit**

```bash
git add apps/on-chain-program-e2e/tests/user/create_user.test.ts
git commit -m "test(program-e2e): cover create_user happy path, duplicate rejection, and length bounds"
```

---

### Task 5: Shared validation utilities (`lib/username.ts`, `lib/password-rules.ts`)

**Files:**
- Create: `apps/frontend/src/lib/username.ts`
- Test: `apps/frontend/src/lib/username.test.ts`
- Create: `apps/frontend/src/lib/password-rules.ts`
- Test: `apps/frontend/src/lib/password-rules.test.ts`

**Interfaces:**
- Produces: `normalizeUsername(input: string): string`, `validateUsername(normalized: string): { valid: true } | { valid: false; reason: string }`, `MIN_USERNAME_BYTES = 3`, `MAX_USERNAME_BYTES = 32` from `lib/username.ts`; `validatePassword(password: string): { valid: true } | { valid: false; reason: string }` from `lib/password-rules.ts`. Consumed by Task 8 (`registerUser`), Task 11 (register page), and Task 12 (login page — normalization only).

These are pure, non-Solana utilities (no chain access, no secrets) — placed in `lib/` rather than `server/` per this repo's own codebase-structure convention (`server/` is reserved for the connection/signer/Server-Action concern; `lib/` is generic utilities usable from both client and server code). This also lets the register page import them directly for live client-side validation feedback.

- [ ] **Step 1: Write the failing tests for `username.ts`**

Create `apps/frontend/src/lib/username.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeUsername, validateUsername } from "./username";

describe("normalizeUsername", () => {
  it("lowercases ASCII letters", () => {
    expect(normalizeUsername("Alice")).toBe("alice");
  });

  it("leaves CJK characters unchanged (no case concept)", () => {
    expect(normalizeUsername("火锅")).toBe("火锅");
  });

  it("NFC-normalizes decomposed accented Latin input to its precomposed form", () => {
    const decomposed = "é"; // "e" + combining acute accent
    expect(normalizeUsername(decomposed)).toBe("é");
  });
});

describe("validateUsername", () => {
  it("accepts a normal ASCII username", () => {
    expect(validateUsername("alice")).toEqual({ valid: true });
  });

  it("accepts a single 3-byte CJK character at the minimum byte length", () => {
    expect(validateUsername("火")).toEqual({ valid: true });
  });

  it("accepts a username containing a space", () => {
    expect(validateUsername("poker night")).toEqual({ valid: true });
  });

  it("rejects a username below the 3-byte minimum", () => {
    const result = validateUsername("ab");
    expect(result.valid).toBe(false);
  });

  it("accepts a username at exactly the 32-byte maximum", () => {
    expect(validateUsername("a".repeat(32))).toEqual({ valid: true });
  });

  it("rejects a username over the 32-byte maximum", () => {
    const result = validateUsername("a".repeat(33));
    expect(result.valid).toBe(false);
  });

  it("rejects a username containing a disallowed symbol", () => {
    const result = validateUsername("alice!");
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter frontend run test -- username.test.ts`
Expected: FAIL — `Cannot find module './username'`.

- [ ] **Step 3: Implement `username.ts`**

Create `apps/frontend/src/lib/username.ts`:

```ts
export const MIN_USERNAME_BYTES = 3;
export const MAX_USERNAME_BYTES = 32;

const USERNAME_CHARSET = /^[\p{L}\p{N} ]+$/u;

export function normalizeUsername(input: string): string {
  return input.normalize("NFC").toLowerCase().normalize("NFC");
}

export function validateUsername(
  normalized: string,
): { valid: true } | { valid: false; reason: string } {
  const byteLength = new TextEncoder().encode(normalized).length;
  if (byteLength < MIN_USERNAME_BYTES || byteLength > MAX_USERNAME_BYTES) {
    return {
      valid: false,
      reason: `Username must be between ${MIN_USERNAME_BYTES} and ${MAX_USERNAME_BYTES} bytes`,
    };
  }
  if (!USERNAME_CHARSET.test(normalized)) {
    return { valid: false, reason: "Username can only contain letters, numbers, and spaces" };
  }
  return { valid: true };
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm --filter frontend run test -- username.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Write the failing tests for `password-rules.ts`**

Create `apps/frontend/src/lib/password-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validatePassword } from "./password-rules";

describe("validatePassword", () => {
  it("accepts a password within bounds using only allowed characters", () => {
    expect(validatePassword("Abcdef12")).toEqual({ valid: true });
  });

  it("accepts a password containing allowed symbols", () => {
    expect(validatePassword("Abcdef1@#!")).toEqual({ valid: true });
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = validatePassword("Ab1");
    expect(result.valid).toBe(false);
  });

  it("rejects a password longer than 20 characters", () => {
    const result = validatePassword("A".repeat(21));
    expect(result.valid).toBe(false);
  });

  it("rejects a password containing a disallowed character (whitespace)", () => {
    const result = validatePassword("Abcdef 12");
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 6: Run and verify it fails**

Run: `pnpm --filter frontend run test -- password-rules.test.ts`
Expected: FAIL — `Cannot find module './password-rules'`.

- [ ] **Step 7: Implement `password-rules.ts`**

Create `apps/frontend/src/lib/password-rules.ts`:

```ts
const PASSWORD_CHARSET = /^[A-Za-z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/;

export function validatePassword(
  password: string,
): { valid: true } | { valid: false; reason: string } {
  if (password.length < 8 || password.length > 20) {
    return { valid: false, reason: "Password must be between 8 and 20 characters" };
  }
  if (!PASSWORD_CHARSET.test(password)) {
    return { valid: false, reason: "Password contains a disallowed character" };
  }
  return { valid: true };
}
```

- [ ] **Step 8: Run and verify it passes**

Run: `pnpm --filter frontend run test -- password-rules.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/lib/username.ts apps/frontend/src/lib/username.test.ts \
        apps/frontend/src/lib/password-rules.ts apps/frontend/src/lib/password-rules.test.ts
git commit -m "feat(frontend): add username and password validation utilities"
```

---

### Task 6: Password hashing utility (`server/password.ts`)

**Files:**
- Create: `apps/frontend/src/server/password.ts`
- Test: `apps/frontend/src/server/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<{ salt: Uint8Array; hash: Uint8Array }>`, `verifyPassword(password: string, salt: Uint8Array, expectedHash: Uint8Array): Promise<boolean>`, `runDummyHash(password: string): Promise<void>`. Consumed by Task 8 and Task 9's Server Actions.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/server/password.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, runDummyHash } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("produces a 16-byte salt and 64-byte hash", async () => {
    const { salt, hash } = await hashPassword("correct horse battery staple");
    expect(salt).toHaveLength(16);
    expect(hash).toHaveLength(64);
  });

  it("verifies the correct password against its own salt and hash", async () => {
    const { salt, hash } = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", salt, hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password against an existing salt and hash", async () => {
    const { salt, hash } = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password", salt, hash)).resolves.toBe(false);
  });

  it("produces different hashes for the same password with different (random) salts", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    expect(Buffer.from(first.hash).equals(Buffer.from(second.hash))).toBe(false);
  });
});

describe("runDummyHash", () => {
  it("resolves without throwing regardless of input", async () => {
    await expect(runDummyHash("anything")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter frontend run test -- password.test.ts`
Expected: FAIL — `Cannot find module './password'`.

- [ ] **Step 3: Implement `password.ts`**

Create `apps/frontend/src/server/password.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// Must match the on-chain `SALT_BYTES` / `PASSWORD_HASH_BYTES` constants in
// apps/on-chain-program/programs/game_token_wallet/src/state/user.rs.
const SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 64;

// Fixed, non-secret salt used only to burn equivalent scrypt time when no
// real account exists — see runDummyHash.
const DUMMY_SALT = new Uint8Array(SALT_BYTES);

export async function hashPassword(
  password: string,
): Promise<{ salt: Uint8Array; hash: Uint8Array }> {
  const salt = randomBytes(SALT_BYTES);
  const hash = (await scryptAsync(password, salt, PASSWORD_HASH_BYTES)) as Buffer;
  return { salt: new Uint8Array(salt), hash: new Uint8Array(hash) };
}

export async function verifyPassword(
  password: string,
  salt: Uint8Array,
  expectedHash: Uint8Array,
): Promise<boolean> {
  const computed = (await scryptAsync(password, Buffer.from(salt), PASSWORD_HASH_BYTES)) as Buffer;
  const expected = Buffer.from(expectedHash);
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

// Runs the same-cost scrypt computation as a real login when no account was
// found, so response timing doesn't reveal whether a username exists.
export async function runDummyHash(password: string): Promise<void> {
  await scryptAsync(password, Buffer.from(DUMMY_SALT), PASSWORD_HASH_BYTES);
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm --filter frontend run test -- password.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/server/password.ts apps/frontend/src/server/password.test.ts
git commit -m "feat(frontend): add scrypt password hashing utility"
```

---

### Task 7: Session utility (`server/session.ts`) and `SESSION_SECRET` env var

**Files:**
- Create: `apps/frontend/src/server/session.ts`
- Test: `apps/frontend/src/server/session.test.ts`
- Modify: `apps/frontend/src/server/env.ts`
- Modify: `apps/frontend/src/server/env.test.ts`
- Modify: `apps/frontend/.env.template`
- Modify: `docker/deployment/.env.template`
- Modify: `docker-compose.e2e.yml`

**Interfaces:**
- Consumes: `readRequiredEnvVar` (existing, in `env.ts`).
- Produces: `loadSessionEnv(): { sessionSecret: string }` from `env.ts`; `SESSION_COOKIE_NAME = "session"`, `SESSION_COOKIE_MAX_AGE_SECONDS`, `createSessionCookie(username: string): Promise<string>`, `verifySessionCookie(cookie: string): Promise<{ username: string } | null>` from `session.ts`. Consumed by Task 9's Server Actions and Task 10's middleware.

- [ ] **Step 1: Write the failing test for `loadSessionEnv`**

Modify `apps/frontend/src/server/env.test.ts` — append to the existing file (after the closing brace of the `loadSolanaEnv` describe block):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadSolanaEnv, loadSessionEnv } from "./env";

const REQUIRED_VARS = ["SOLANA_CLUSTER", "SOLANA_RPC_URL", "PROGRAM_ID", "SYSTEM_ADMIN_SECRET_KEY"];

function setValidEnv() {
  process.env.SOLANA_CLUSTER = "localnet";
  process.env.SOLANA_RPC_URL = "http://127.0.0.1:8899";
  process.env.PROGRAM_ID = "11111111111111111111111111111111";
  process.env.SYSTEM_ADMIN_SECRET_KEY =
    "PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis";
}

describe("loadSolanaEnv", () => {
  beforeEach(() => {
    for (const key of REQUIRED_VARS) delete process.env[key];
  });

  it("returns parsed config when all vars are set", () => {
    setValidEnv();
    expect(loadSolanaEnv()).toEqual({
      cluster: "localnet",
      rpcUrl: "http://127.0.0.1:8899",
      programId: "11111111111111111111111111111111",
      adminSecretKeyBase58:
        "PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis",
    });
  });

  it("throws when a required var is missing", () => {
    setValidEnv();
    delete process.env.PROGRAM_ID;
    expect(() => loadSolanaEnv()).toThrow(
      "Missing required environment variable: PROGRAM_ID",
    );
  });

  it("throws when SOLANA_CLUSTER is not a recognized value", () => {
    setValidEnv();
    process.env.SOLANA_CLUSTER = "testnet";
    expect(() => loadSolanaEnv()).toThrow(/Invalid SOLANA_CLUSTER/);
  });
});

describe("loadSessionEnv", () => {
  beforeEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it("returns the session secret when set", () => {
    process.env.SESSION_SECRET = "a-long-random-test-secret";
    expect(loadSessionEnv()).toEqual({ sessionSecret: "a-long-random-test-secret" });
  });

  it("throws when SESSION_SECRET is missing", () => {
    expect(() => loadSessionEnv()).toThrow(
      "Missing required environment variable: SESSION_SECRET",
    );
  });
});
```

(This replaces the whole file — the existing `import` and first `describe` block are unchanged, only the import line gains `loadSessionEnv` and a new `describe("loadSessionEnv", ...)` block is appended.)

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter frontend run test -- env.test.ts`
Expected: FAIL — `loadSessionEnv is not a function` (or a TypeScript error if type-checked first).

- [ ] **Step 3: Implement `loadSessionEnv`**

Modify `apps/frontend/src/server/env.ts` — add after the existing `loadSolanaEnv` function:

```ts
export interface SessionEnv {
  sessionSecret: string;
}

export function loadSessionEnv(): SessionEnv {
  return {
    sessionSecret: readRequiredEnvVar("SESSION_SECRET"),
  };
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm --filter frontend run test -- env.test.ts`
Expected: PASS — all 5 tests green (3 existing `loadSolanaEnv` + 2 new `loadSessionEnv`).

- [ ] **Step 5: Write the failing tests for `session.ts`**

Create `apps/frontend/src/server/session.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

function setValidEnv() {
  process.env.SESSION_SECRET = "test-session-secret-value-not-used-in-prod";
}

describe("createSessionCookie / verifySessionCookie", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SESSION_SECRET;
  });

  it("round-trips a valid session", async () => {
    setValidEnv();
    const { createSessionCookie, verifySessionCookie } = await import("./session");
    const cookie = await createSessionCookie("alice");
    const result = await verifySessionCookie(cookie);
    expect(result).toEqual({ username: "alice" });
  });

  it("rejects a tampered payload", async () => {
    setValidEnv();
    const { createSessionCookie, verifySessionCookie } = await import("./session");
    const cookie = await createSessionCookie("alice");
    const [payload, signature] = cookie.split(".");
    const result = await verifySessionCookie(`${payload}x.${signature}`);
    expect(result).toBeNull();
  });

  it("rejects an expired session", async () => {
    setValidEnv();
    vi.useFakeTimers();
    const { createSessionCookie, verifySessionCookie } = await import("./session");
    const cookie = await createSessionCookie("alice");
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000); // 8 days, past the 7-day TTL
    const result = await verifySessionCookie(cookie);
    vi.useRealTimers();
    expect(result).toBeNull();
  });

  it("rejects a malformed cookie value", async () => {
    setValidEnv();
    const { verifySessionCookie } = await import("./session");
    const result = await verifySessionCookie("not-a-valid-cookie");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 6: Run and verify it fails**

Run: `pnpm --filter frontend run test -- session.test.ts`
Expected: FAIL — `Cannot find module './session'`.

- [ ] **Step 7: Implement `session.ts`**

Create `apps/frontend/src/server/session.ts`:

```ts
import { loadSessionEnv } from "./env";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

interface SessionPayload {
  username: string;
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized.padEnd(normalized.length + padLength, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Uses Web Crypto (crypto.subtle), not node:crypto, so this module works
// identically whether middleware.ts runs on the Edge or Node.js runtime.
async function getHmacKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionCookie(username: string): Promise<string> {
  const { sessionSecret } = loadSessionEnv();
  const payload: SessionPayload = { username, exp: Date.now() + SESSION_TTL_MS };
  const payloadB64 = base64UrlEncode(ENCODER.encode(JSON.stringify(payload)));
  const key = await getHmacKey(sessionSecret);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, ENCODER.encode(payloadB64));
  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${payloadB64}.${signatureB64}`;
}

export async function verifySessionCookie(cookie: string): Promise<{ username: string } | null> {
  const parts = cookie.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts;

  try {
    const { sessionSecret } = loadSessionEnv();
    const key = await getHmacKey(sessionSecret);
    const isValid = await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signatureB64),
      ENCODER.encode(payloadB64),
    );
    if (!isValid) return null;

    const payload = JSON.parse(DECODER.decode(base64UrlDecode(payloadB64))) as SessionPayload;
    if (typeof payload.username !== "string" || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;

    return { username: payload.username };
  } catch {
    return null;
  }
}
```

- [ ] **Step 8: Run and verify it passes**

Run: `pnpm --filter frontend run test -- session.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 9: Add `SESSION_SECRET` to the env templates and e2e compose file**

Modify `apps/frontend/.env.template` — add after `SYSTEM_ADMIN_SECRET_KEY`:

```
# HMAC signing secret for session cookies. NEVER commit a real value here.
SESSION_SECRET="a-long-random-development-only-secret-value"
```

Modify `docker/deployment/.env.template` — add after `SYSTEM_ADMIN_SECRET_KEY=`:

```
SESSION_SECRET=
```

Modify `docker-compose.e2e.yml` — in the `frontend` service's `environment:` block, add a line after `SYSTEM_ADMIN_SECRET_KEY`:

```yaml
      SESSION_SECRET: "e2e-test-session-secret-do-not-use-elsewhere"
```

- [ ] **Step 10: Commit**

```bash
git add apps/frontend/src/server/env.ts apps/frontend/src/server/env.test.ts \
        apps/frontend/src/server/session.ts apps/frontend/src/server/session.test.ts \
        apps/frontend/.env.template docker/deployment/.env.template docker-compose.e2e.yml
git commit -m "feat(frontend): add signed-cookie session utility and SESSION_SECRET env var"
```

---

### Task 8: `registerUser` Server Action

**Files:**
- Create: `apps/frontend/src/server/actions/auth.ts`
- Test: `apps/frontend/src/server/actions/auth.test.ts`

**Interfaces:**
- Consumes: `getSolanaContext()` from `../connection` (existing); `findUserPda`, `fetchMaybeUser`, `getCreateUserInstructionAsync` from `"on-chain-client"` (Task 3); `normalizeUsername`, `validateUsername` from `@/lib/username` (Task 5); `validatePassword` from `@/lib/password-rules` (Task 5); `hashPassword` from `../password` (Task 6); `createSessionCookie`, `SESSION_COOKIE_NAME`, `SESSION_COOKIE_MAX_AGE_SECONDS` from `../session` (Task 7).
- Produces: `registerUser(input: { username: string; password: string; confirmPassword: string }): Promise<void>`. Consumed by Task 11's register page.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/server/actions/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MaybeAccount } from "@solana/kit";
import type { User } from "on-chain-client";

const { mockGetSolanaContext } = vi.hoisted(() => ({ mockGetSolanaContext: vi.fn() }));
vi.mock("../connection", () => ({ getSolanaContext: mockGetSolanaContext }));

const { mockFindUserPda, mockFetchMaybeUser, mockGetCreateUserInstructionAsync } = vi.hoisted(() => ({
  mockFindUserPda: vi.fn(),
  mockFetchMaybeUser: vi.fn(),
  mockGetCreateUserInstructionAsync: vi.fn(),
}));
vi.mock("on-chain-client", () => ({
  findUserPda: mockFindUserPda,
  fetchMaybeUser: mockFetchMaybeUser,
  getCreateUserInstructionAsync: mockGetCreateUserInstructionAsync,
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

const { mockCookieStore } = vi.hoisted(() => ({
  mockCookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
}));
vi.mock("next/headers", () => ({ cookies: async () => mockCookieStore }));

import { registerUser } from "./auth";

const USER_ADDRESS = "User1111111111111111111111111111111111111";
const ADMIN_ADDRESS = "Admin111111111111111111111111111111111111";

function userData(overrides: Partial<User> = {}): User {
  return {
    discriminator: new Uint8Array(8),
    bump: 255,
    username: "alice",
    salt: new Uint8Array(16),
    passwordHash: new Uint8Array(64),
    ...overrides,
  };
}

describe("registerUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret-value-not-used-in-prod";
    mockGetSolanaContext.mockResolvedValue({
      rpc: {
        getLatestBlockhash: () => ({
          send: async () => ({ value: { blockhash: "fake", lastValidBlockHeight: 1n } }),
        }),
      },
      rpcSubscriptions: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: "Prog1111111111111111111111111111111111111",
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    mockGetCreateUserInstructionAsync.mockResolvedValue({
      programAddress: "Prog1111111111111111111111111111111111111",
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignTransactionMessageWithSigners.mockResolvedValue({});
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);
  });

  it("rejects an invalid username before touching the chain", async () => {
    await expect(
      registerUser({ username: "a!", password: "Abcdef12", confirmPassword: "Abcdef12" }),
    ).rejects.toThrow();
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects an invalid password before touching the chain", async () => {
    await expect(
      registerUser({ username: "alice", password: "short", confirmPassword: "short" }),
    ).rejects.toThrow();
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirm-password before touching the chain", async () => {
    await expect(
      registerUser({ username: "alice", password: "Abcdef12", confirmPassword: "Abcdef13" }),
    ).rejects.toThrow("Passwords do not match");
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("creates the on-chain account and sets a session cookie on success", async () => {
    mockFetchMaybeUser.mockResolvedValue({ exists: false } as MaybeAccount<User>);

    await registerUser({ username: "alice", password: "Abcdef12", confirmPassword: "Abcdef12" });

    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("surfaces a friendly error when the username is already taken", async () => {
    mockSendAndConfirmTransaction.mockRejectedValue(new Error("already in use"));
    mockFetchMaybeUser.mockResolvedValue({
      exists: true,
      address: USER_ADDRESS,
      data: userData(),
    } as MaybeAccount<User>);

    await expect(
      registerUser({ username: "alice", password: "Abcdef12", confirmPassword: "Abcdef12" }),
    ).rejects.toThrow("Username already taken");
    expect(mockCookieStore.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter frontend run test -- auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Implement `registerUser`**

Create `apps/frontend/src/server/actions/auth.ts`:

```ts
"use server";

import { cookies } from "next/headers";
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
import { findUserPda, fetchMaybeUser, getCreateUserInstructionAsync } from "on-chain-client";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { validatePassword } from "@/lib/password-rules";
import { getSolanaContext } from "../connection";
import { hashPassword } from "../password";
import {
  createSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "../session";

export interface RegisterUserInput {
  username: string;
  password: string;
  confirmPassword: string;
}

async function setSessionCookie(username: string): Promise<void> {
  const sessionCookie = await createSessionCookie(username);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function registerUser(input: RegisterUserInput): Promise<void> {
  const normalizedUsername = normalizeUsername(input.username);

  const usernameCheck = validateUsername(normalizedUsername);
  if (!usernameCheck.valid) {
    throw new Error(usernameCheck.reason);
  }

  const passwordCheck = validatePassword(input.password);
  if (!passwordCheck.valid) {
    throw new Error(passwordCheck.reason);
  }

  if (input.password !== input.confirmPassword) {
    throw new Error("Passwords do not match");
  }

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();
  const { salt, hash } = await hashPassword(input.password);

  const createUserInstruction = await getCreateUserInstructionAsync(
    { admin: adminSigner, username: normalizedUsername, salt, passwordHash: hash },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([createUserInstruction], tx),
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  try {
    await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
  } catch (error) {
    // The duplicate-username case fails Anchor's `init` constraint — rather
    // than string-matching the error, re-check whether the account now
    // exists (same idempotency-check pattern as registry.ts's initializeRegistry).
    const [userAddress] = await findUserPda(
      { username: normalizedUsername, admin: adminSigner.address },
      { programAddress },
    );
    const existing = await fetchMaybeUser(rpc, userAddress);
    if (existing.exists) {
      throw new Error("Username already taken");
    }
    throw error;
  }

  await setSessionCookie(normalizedUsername);
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm --filter frontend run test -- auth.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/server/actions/auth.ts apps/frontend/src/server/actions/auth.test.ts
git commit -m "feat(frontend): add registerUser server action"
```

---

### Task 9: `loginUser`, `logoutUser`, `getCurrentUsername` Server Actions

**Files:**
- Modify: `apps/frontend/src/server/actions/auth.ts`
- Modify: `apps/frontend/src/server/actions/auth.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `runDummyHash` from `../password` (Task 6); `verifySessionCookie` from `../session` (Task 7); all interfaces from Task 8.
- Produces: `loginUser(input: { username: string; password: string }): Promise<void>`, `logoutUser(): Promise<void>`, `getCurrentUsername(): Promise<string | null>`. Consumed by Task 12 (login page), Task 13 (home page), and Task 10 (middleware doesn't call these directly — it calls `verifySessionCookie` itself — but the home page/logout button do).

- [ ] **Step 1: Write the failing tests**

Modify `apps/frontend/src/server/actions/auth.test.ts` — add these imports to the top-level import line and append the new `describe` blocks at the end of the file:

Change:
```ts
import { registerUser } from "./auth";
```
to:
```ts
import { registerUser, loginUser, logoutUser, getCurrentUsername } from "./auth";
```

Append at the end of the file:

```ts
describe("loginUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret-value-not-used-in-prod";
    mockGetSolanaContext.mockResolvedValue({
      rpc: {},
      rpcSubscriptions: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: "Prog1111111111111111111111111111111111111",
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
  });

  it("sets a session cookie when the password is correct", async () => {
    const { hashPassword } = await import("../password");
    const { salt, hash } = await hashPassword("Abcdef12");
    mockFetchMaybeUser.mockResolvedValue({
      exists: true,
      address: USER_ADDRESS,
      data: userData({ salt, passwordHash: hash }),
    } as MaybeAccount<User>);

    await loginUser({ username: "alice", password: "Abcdef12" });

    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("throws a generic error when the password is wrong", async () => {
    const { hashPassword } = await import("../password");
    const { salt, hash } = await hashPassword("Abcdef12");
    mockFetchMaybeUser.mockResolvedValue({
      exists: true,
      address: USER_ADDRESS,
      data: userData({ salt, passwordHash: hash }),
    } as MaybeAccount<User>);

    await expect(loginUser({ username: "alice", password: "wrong-password" })).rejects.toThrow(
      "Invalid username or password",
    );
    expect(mockCookieStore.set).not.toHaveBeenCalled();
  });

  it("throws the identical generic error when the username doesn't exist", async () => {
    mockFetchMaybeUser.mockResolvedValue({ exists: false } as MaybeAccount<User>);

    await expect(loginUser({ username: "nobody", password: "Abcdef12" })).rejects.toThrow(
      "Invalid username or password",
    );
    expect(mockCookieStore.set).not.toHaveBeenCalled();
  });
});

describe("logoutUser", () => {
  it("clears the session cookie", async () => {
    vi.clearAllMocks();
    await logoutUser();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("session");
  });
});

describe("getCurrentUsername", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret-value-not-used-in-prod";
  });

  it("returns null when there is no session cookie", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    await expect(getCurrentUsername()).resolves.toBeNull();
  });

  it("returns the username from a valid session cookie", async () => {
    const { createSessionCookie } = await import("../session");
    const cookie = await createSessionCookie("alice");
    mockCookieStore.get.mockReturnValue({ value: cookie });

    await expect(getCurrentUsername()).resolves.toBe("alice");
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter frontend run test -- auth.test.ts`
Expected: FAIL — `loginUser is not a function` (and similarly for `logoutUser`, `getCurrentUsername`).

- [ ] **Step 3: Implement the remaining actions**

Modify `apps/frontend/src/server/actions/auth.ts` — update the import line for `../password` and add the three new exported functions at the end of the file.

Change:
```ts
import { hashPassword } from "../password";
```
to:
```ts
import { hashPassword, verifyPassword, runDummyHash } from "../password";
```

Append at the end of the file:

```ts
export interface LoginUserInput {
  username: string;
  password: string;
}

const INVALID_CREDENTIALS_MESSAGE = "Invalid username or password";

export async function loginUser(input: LoginUserInput): Promise<void> {
  const normalizedUsername = normalizeUsername(input.username);
  const { rpc, adminSigner, programAddress } = await getSolanaContext();

  const [userAddress] = await findUserPda(
    { username: normalizedUsername, admin: adminSigner.address },
    { programAddress },
  );
  const maybeUser = await fetchMaybeUser(rpc, userAddress);

  if (!maybeUser.exists) {
    // Still pay the scrypt cost even though there's no account, so response
    // timing doesn't reveal that this username doesn't exist.
    await runDummyHash(input.password);
    throw new Error(INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await verifyPassword(
    input.password,
    new Uint8Array(maybeUser.data.salt),
    new Uint8Array(maybeUser.data.passwordHash),
  );

  if (!passwordMatches) {
    throw new Error(INVALID_CREDENTIALS_MESSAGE);
  }

  await setSessionCookie(normalizedUsername);
}

export async function logoutUser(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUsername(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;
  const session = await verifySessionCookie(sessionCookie);
  return session?.username ?? null;
}
```

Also add `verifySessionCookie` to the existing `../session` import line:

Change:
```ts
import {
  createSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "../session";
```
to:
```ts
import {
  createSessionCookie,
  verifySessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "../session";
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm --filter frontend run test -- auth.test.ts`
Expected: PASS — all 10 tests green (5 from Task 8 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/server/actions/auth.ts apps/frontend/src/server/actions/auth.test.ts
git commit -m "feat(frontend): add loginUser, logoutUser, getCurrentUsername server actions"
```

---

### Task 10: `middleware.ts`

**Files:**
- Create: `apps/frontend/src/middleware.ts`
- Test: `apps/frontend/src/middleware.test.ts`

**Interfaces:**
- Consumes: `verifySessionCookie` from `./server/session` (Task 7).
- Produces: the default-exported `middleware` function and `config.matcher`, applied automatically by Next.js to every request.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/middleware.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionCookie } = vi.hoisted(() => ({ mockVerifySessionCookie: vi.fn() }));
vi.mock("./server/session", () => ({ verifySessionCookie: mockVerifySessionCookie }));

import { middleware } from "./middleware";

describe("middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the root noop demo page through without a session", async () => {
    const request = new NextRequest("http://localhost/");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /login through without a session", async () => {
    const request = new NextRequest("http://localhost/login");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /register through without a session", async () => {
    const request = new NextRequest("http://localhost/register");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /admin/registry through without a session", async () => {
    const request = new NextRequest("http://localhost/admin/registry");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects to /login when there is no session cookie on a protected route", async () => {
    const request = new NextRequest("http://localhost/home");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects to /login when the session cookie is invalid", async () => {
    mockVerifySessionCookie.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/home", {
      headers: { cookie: "session=bad-value" },
    });
    const response = await middleware(request);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows a protected route through with a valid session cookie", async () => {
    mockVerifySessionCookie.mockResolvedValue({ username: "alice" });
    const request = new NextRequest("http://localhost/home", {
      headers: { cookie: "session=good-value" },
    });
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter frontend run test -- middleware.test.ts`
Expected: FAIL — `Cannot find module './middleware'`.

- [ ] **Step 3: Implement `middleware.ts`**

Create `apps/frontend/src/middleware.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie } from "./server/session";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const PUBLIC_PATHS = new Set(["/", "/login", "/register"]);

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get("session")?.value;
  const session = cookie ? await verifySessionCookie(cookie) : null;

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm --filter frontend run test -- middleware.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/middleware.ts apps/frontend/src/middleware.test.ts
git commit -m "feat(frontend): add session-gating middleware"
```

---

### Task 11: Register page

**Files:**
- Create: `apps/frontend/src/app/(auth)/register/page.tsx`
- Test: `apps/frontend/src/app/(auth)/register/page.test.tsx`

**Interfaces:**
- Consumes: `registerUser` from `@/server/actions/auth` (Task 8); `normalizeUsername`, `validateUsername` from `@/lib/username`, `validatePassword` from `@/lib/password-rules` (Task 5); `Button`, `Input`, `Alert` from `@/components/ui/*` (existing, ticket 017).
- Produces: the page rendered at `/register`, with fields identified by placeholder text (`Username`, `Password`, `Confirm password`), live validation hints (`data-testid="username-hint"`, `data-testid="password-hint"`, `data-testid="confirm-password-hint"`), and on failure a `data-testid="register-error"` `Alert`. Task 14's Playwright spec drives this exact markup.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/app/(auth)/register/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockRegisterUser } = vi.hoisted(() => ({ mockRegisterUser: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ registerUser: mockRegisterUser }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import RegisterPage from "./page";

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a live hint for an invalid username without submitting", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText("Username"), "a!");
    expect(await screen.findByTestId("username-hint")).toBeInTheDocument();
    expect(mockRegisterUser).not.toHaveBeenCalled();
  });

  it("shows a live hint when confirm password doesn't match", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText("Password"), "Abcdef12");
    await user.type(screen.getByPlaceholderText("Confirm password"), "Abcdef13");
    expect(await screen.findByTestId("confirm-password-hint")).toBeInTheDocument();
  });

  it("submits and redirects to /home on success", async () => {
    mockRegisterUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText("Username"), "alice");
    await user.type(screen.getByPlaceholderText("Password"), "Abcdef12");
    await user.type(screen.getByPlaceholderText("Confirm password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/home"));
    expect(mockRegisterUser).toHaveBeenCalledWith({
      username: "alice",
      password: "Abcdef12",
      confirmPassword: "Abcdef12",
    });
  });

  it("shows the error alert when registration fails", async () => {
    mockRegisterUser.mockRejectedValue(new Error("Username already taken"));
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText("Username"), "alice");
    await user.type(screen.getByPlaceholderText("Password"), "Abcdef12");
    await user.type(screen.getByPlaceholderText("Confirm password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByTestId("register-error")).toHaveTextContent("Username already taken");
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter frontend run test -- register/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 3: Implement the page**

Create `apps/frontend/src/app/(auth)/register/page.tsx`:

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { registerUser } from "@/server/actions/auth";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { validatePassword } from "@/lib/password-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const usernameCheck = username ? validateUsername(normalizeUsername(username)) : null;
  const passwordCheck = password ? validatePassword(password) : null;
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await registerUser({ username, password, confirmPassword });
        router.push("/home");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 className="text-xl font-extrabold text-text-primary">Register</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          {usernameCheck && !usernameCheck.valid && (
            <p data-testid="username-hint" className="text-xs text-danger">
              {usernameCheck.reason}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {passwordCheck && !passwordCheck.valid && (
            <p data-testid="password-hint" className="text-xs text-danger">
              {passwordCheck.reason}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
          {confirmMismatch && (
            <p data-testid="confirm-password-hint" className="text-xs text-danger">
              Passwords do not match
            </p>
          )}
        </div>
        <Button type="submit" variant="primary" isLoading={isPending}>
          Register
        </Button>
      </form>
      {error && (
        <Alert data-testid="register-error" variant="error" className="break-all">
          {error}
        </Alert>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm --filter frontend run test -- register/page.test.tsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Verify it compiles cleanly**

Run: `pnpm --filter frontend run typecheck && pnpm --filter frontend run lint`
Expected: Both PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/frontend/src/app/(auth)/register/page.tsx" "apps/frontend/src/app/(auth)/register/page.test.tsx"
git commit -m "feat(frontend): add registration page"
```

---

### Task 12: Login page

**Files:**
- Create: `apps/frontend/src/app/(auth)/login/page.tsx`
- Test: `apps/frontend/src/app/(auth)/login/page.test.tsx`

**Interfaces:**
- Consumes: `loginUser` from `@/server/actions/auth` (Task 9); `Button`, `Input`, `Alert` from `@/components/ui/*` (existing).
- Produces: the page rendered at `/login`, fields by placeholder text (`Username`, `Password`), on failure a `data-testid="login-error"` `Alert`. Task 14's Playwright spec drives this exact markup.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/app/(auth)/login/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockLoginUser } = vi.hoisted(() => ({ mockLoginUser: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ loginUser: mockLoginUser }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import LoginPage from "./page";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits and redirects to /home on success", async () => {
    mockLoginUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText("Username"), "alice");
    await user.type(screen.getByPlaceholderText("Password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/home"));
    expect(mockLoginUser).toHaveBeenCalledWith({ username: "alice", password: "Abcdef12" });
  });

  it("shows the generic error alert when login fails", async () => {
    mockLoginUser.mockRejectedValue(new Error("Invalid username or password"));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText("Username"), "alice");
    await user.type(screen.getByPlaceholderText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByTestId("login-error")).toHaveTextContent("Invalid username or password");
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter frontend run test -- login/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 3: Implement the page**

Create `apps/frontend/src/app/(auth)/login/page.tsx`:

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { loginUser } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await loginUser({ username, password });
        router.push("/home");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 className="text-xl font-extrabold text-text-primary">Log in</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <Button type="submit" variant="primary" isLoading={isPending}>
          Log in
        </Button>
      </form>
      {error && (
        <Alert data-testid="login-error" variant="error" className="break-all">
          {error}
        </Alert>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm --filter frontend run test -- login/page.test.tsx`
Expected: PASS — both tests green.

- [ ] **Step 5: Verify it compiles cleanly**

Run: `pnpm --filter frontend run typecheck && pnpm --filter frontend run lint`
Expected: Both PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/frontend/src/app/(auth)/login/page.tsx" "apps/frontend/src/app/(auth)/login/page.test.tsx"
git commit -m "feat(frontend): add login page"
```

---

### Task 13: Home page (authenticated landing + logout)

**Files:**
- Create: `apps/frontend/src/app/(app)/home/page.tsx`
- Create: `apps/frontend/src/app/(app)/home/LogoutButton.tsx`
- Test: `apps/frontend/src/app/(app)/home/page.test.tsx`
- Test: `apps/frontend/src/app/(app)/home/LogoutButton.test.tsx`

**Interfaces:**
- Consumes: `getCurrentUsername`, `logoutUser` from `@/server/actions/auth` (Task 9); `Button` from `@/components/ui/button`; `redirect` from `next/navigation`.
- Produces: the page rendered at `/home`, with `data-testid="home-welcome"` showing "Welcome, {username}" and a "Log out" button. This is this ticket's proof surface for session gating, the same role `/admin/registry` played for ticket 002. Task 14's Playwright spec drives this exact markup.

- [ ] **Step 1: Write the failing test for `LogoutButton`**

Create `apps/frontend/src/app/(app)/home/LogoutButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockLogoutUser } = vi.hoisted(() => ({ mockLogoutUser: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ logoutUser: mockLogoutUser }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import { LogoutButton } from "./LogoutButton";

describe("LogoutButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls logoutUser and redirects to /login on click", async () => {
    mockLogoutUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(mockLogoutUser).toHaveBeenCalled());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter frontend run test -- LogoutButton.test.tsx`
Expected: FAIL — `Cannot find module './LogoutButton'`.

- [ ] **Step 3: Implement `LogoutButton`**

Create `apps/frontend/src/app/(app)/home/LogoutButton.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logoutUser } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await logoutUser();
      router.push("/login");
    });
  }

  return (
    <Button type="button" variant="secondary" onClick={handleClick} isLoading={isPending}>
      Log out
    </Button>
  );
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm --filter frontend run test -- LogoutButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `HomePage`**

Create `apps/frontend/src/app/(app)/home/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({
  getCurrentUsername: mockGetCurrentUsername,
  logoutUser: vi.fn(),
}));

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  useRouter: () => ({ push: vi.fn() }),
}));

import HomePage from "./page";

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a welcome message with the current username", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    const jsx = await HomePage();
    render(jsx);
    expect(screen.getByTestId("home-welcome")).toHaveTextContent("Welcome, alice");
  });

  it("redirects to /login when there is no session", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await HomePage();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});
```

- [ ] **Step 6: Run and verify it fails**

Run: `pnpm --filter frontend run test -- "app/(app)/home/page.test.tsx"`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 7: Implement `HomePage`**

Create `apps/frontend/src/app/(app)/home/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { LogoutButton } from "./LogoutButton";

export default async function HomePage() {
  const username = await getCurrentUsername();

  if (!username) {
    redirect("/login");
  }

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 data-testid="home-welcome" className="text-xl font-extrabold text-text-primary">
        Welcome, {username}
      </h1>
      <LogoutButton />
    </main>
  );
}
```

- [ ] **Step 8: Run and verify it passes**

Run: `pnpm --filter frontend run test -- "app/(app)/home/page.test.tsx"`
Expected: PASS — both tests green.

- [ ] **Step 9: Verify it compiles cleanly**

Run: `pnpm --filter frontend run typecheck && pnpm --filter frontend run lint`
Expected: Both PASS.

- [ ] **Step 10: Commit**

```bash
git add "apps/frontend/src/app/(app)/home"
git commit -m "feat(frontend): add authenticated home page with logout"
```

---

### Task 14: Playwright end-to-end spec

**Files:**
- Create: `apps/e2e/tests/auth.spec.ts`

**Interfaces:**
- Consumes: the running Docker Compose e2e stack (`docker-compose.e2e.yml`, prod-built frontend + Surfpool + program deploy), specifically `/register`, `/login`, `/home` and their markup from Tasks 11–13.

- [ ] **Step 1: Write the spec**

Create `apps/e2e/tests/auth.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

function uniqueUsername(): string {
  return `e2euser${Date.now()}`;
}

test.describe("registration and login", () => {
  test("a new user can register, land on /home, log out, and log back in", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByPlaceholder("Confirm password").fill(password);
    await page.getByRole("button", { name: "Register" }).click();

    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-welcome")).toContainText(username);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-welcome")).toContainText(username);
  });

  test("login with the wrong password shows a generic error", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByPlaceholder("Confirm password").fill(password);
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByTestId("login-error")).toHaveText("Invalid username or password");
  });
});
```

- [ ] **Step 2: Run it against the real stack**

Run: `docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e`
Expected: The compose run exits 0; the Playwright report shows `auth.spec.ts`'s 2 tests passing alongside the existing `noop.spec.ts` and `admin-registry.spec.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/auth.spec.ts
git commit -m "test(e2e): cover registration, login, logout, and session gating"
```

---

### Task 15: Manual verification and final Done-Means checklist

No new files — this task confirms the whole feature works end to end on the local dev stack and that repo-wide gates pass, per this repo's Done-Means rule.

- [ ] **Step 1: Add `SESSION_SECRET` to the local `.env` file**

The local `apps/frontend/.env` file is gitignored and personal — it is not touched by any commit in this plan. Manually append a line to it:

```
SESSION_SECRET="local-dev-only-session-secret-change-me"
```

- [ ] **Step 2: Boot the local dev stack**

Run: `just up-build`
Expected: `surfpool`, `program-deploy`, and `frontend` containers come up; `program-deploy` exits 0 (program deployed + client regenerated, now including `create_user`); `frontend` stays up on `http://localhost:3000`.

- [ ] **Step 3: Exercise the real registration → login → logout flow in a browser**

Using a browser automation tool (e.g. chrome-devtools MCP or Playwright), navigate to `http://localhost:3000/register`, register a new user, confirm landing on `/home` with "Welcome, {username}" visible, click "Log out", confirm redirect to `/login`, navigate directly to `http://localhost:3000/home` and confirm redirect back to `/login` (proving the session is actually gone, not just navigated away from), then log back in with the same credentials and confirm landing on `/home` again.

Expected: Every step matches — no unhandled errors in the browser console.

- [ ] **Step 4: Confirm the generic invalid-credentials message**

In the same browser session, log out, then attempt to log in with the same username and a wrong password.
Expected: The page shows exactly `Invalid username or password` — not a different message, and not one that reveals the username exists.

- [ ] **Step 5: Confirm `/admin/registry` is unaffected**

Navigate to `http://localhost:3000/admin/registry` without being logged in.
Expected: The page loads normally (no redirect to `/login`), same as before this ticket.

- [ ] **Step 6: Tear down the dev stack**

Run: `just down-clean`
Expected: Containers and volumes removed cleanly.

- [ ] **Step 7: Run the full repo-wide test suite**

Run: `just test`
Expected: All of `cargo test`, `pnpm --filter frontend run test`, `pnpm --filter on-chain-client run test`, `anchor test`, and both `docker-compose.e2e.yml` runs (`on-chain-program-e2e` and `e2e`) pass.

- [ ] **Step 8: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: Both PASS. (Per `CLAUDE.local.md`: if `pnpm lint` fails unexpectedly, re-run with `rtk proxy pnpm lint` to bypass a local hook rewrite before treating it as a real regression.)

- [ ] **Step 9: Final status check**

Run: `git log --oneline feat/003-user-registration-login` and `git status --short`
Expected: One commit per task above, working tree clean. Ready to hand off per `superpowers:finishing-a-development-branch`.
