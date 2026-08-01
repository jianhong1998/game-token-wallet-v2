# Remove no-op scaffolding; relocate dashboard to `/` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete ticket 001's leftover no-op connectivity demo (on-chain instruction, e2e coverage, frontend page/action) and relocate the authenticated placeholder dashboard from `/home` to `/`, gating `/` behind the session middleware like every other authenticated route.

**Architecture:** Six independent-ish slices, ordered so nothing is left in a broken intermediate state if execution stops between tasks: (1) on-chain removal, (2) codegen + e2e cleanup, (3) a new shared `signAndSendTransaction` helper extracted from the sign→assert→send boilerplate duplicated across `noop.ts`/`auth.ts`/`registry.ts`/`game.ts`, (4) three call sites migrated onto it, (5) `noop.ts` + the demo page deleted, (6) the dashboard physically moved to `/` with `middleware.ts` and the login/register redirect targets updated to match.

**Tech Stack:** Anchor/Rust (on-chain program), Codama codegen (`on-chain-client`), Next.js App Router + `@solana/kit` (frontend), Vitest (unit), Playwright (e2e), Anchor's mocha-based test runner (`on-chain-program-e2e`).

## Global Constraints

- No redirect from the deleted `/home` route — it 404s outright (ticket 019 Q3). Do not add a `redirect()` or rewrite.
- `/` moves into the `(app)` route group and comes out of `middleware.ts`'s `PUBLIC_PATHS` — this must land atomically with the page-content move, not as a follow-up (ticket 019 Q4).
- The shared transaction helper only covers the sign → assert-blockhash-lifetime → send-and-confirm sequence; it does not touch blockhash fetching or transaction-message construction, which stay call-site-specific (ticket 019 Q2).
- Behavior-preserving refactor for `auth.ts`, `registry.ts`, `game.ts` — their existing test *assertions* about outcomes (return values, cookie calls, error messages) must not change, only how the sign/send step is mocked.
- Ticket 018's ticket file and design doc already reference `/` (not `/home`) throughout and already list `019` in `Blocked by` — confirmed by reading both files during planning. **No task in this plan touches them; there is nothing left to amend.**
- Scope addition confirmed with the user during planning (not in the original ticket/design/openspec docs): `login/page.tsx` and `register/page.tsx` hardcode `router.push("/home")`, and `apps/e2e/tests/auth.spec.ts` / `game-creation.spec.ts` assert `toHaveURL(/\/home$/)`. Both must be updated to `/` or login/register would send real users to a deleted 404 route. Task 11 covers this.

---

## Task 1: On-chain — remove the `noop` instruction

**Files:**
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs:19-21` (handler), `apps/on-chain-program/programs/game_token_wallet/src/lib.rs:45-47` (accounts struct)
- Test: `cargo test --manifest-path apps/on-chain-program/Cargo.toml` (existing suite; no new Rust test needed — this is a pure deletion)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: an IDL with no `noop` instruction — Task 2's codegen run depends on this.

- [ ] **Step 1: Confirm current state**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: PASS (baseline, before any edit)

- [ ] **Step 2: Delete the `noop` handler and `Noop` accounts struct**

In `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`, remove:

```rust
    pub fn noop(_ctx: Context<Noop>) -> Result<()> {
        Ok(())
    }

```
(the handler, lines 19-22 including the trailing blank line) and:

```rust
#[derive(Accounts)]
pub struct Noop {}
```
(the struct at the end of the file, including its preceding blank line). The file should read:

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

    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: [u8; 16],
        name: String,
        username: String,
    ) -> Result<()> {
        instructions::game::create_game::handler(ctx, game_id, name, username)
    }
}
```

- [ ] **Step 3: Run the Rust test suite**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: PASS (no test referenced `noop`, so nothing new fails)

- [ ] **Step 4: Build the program to regenerate the local IDL** (needed before Task 2's codegen can pick up the change)

Run: `just program-build` (or, if that recipe requires Docker context you don't have locally, `cd apps/on-chain-program && anchor build`)
Expected: builds successfully; `apps/on-chain-program/target/idl/game_token_wallet.json` no longer contains a `noop` instruction.

- [ ] **Step 5: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/lib.rs
git commit -m "feat(019): remove noop instruction from on-chain program"
```

---

## Task 2: Regenerate `on-chain-client`; drop the noop-builder assertion

**Files:**
- Modify: `apps/on-chain-client/src/index.test.ts:21-24` (remove the noop assertion)
- Regenerate: `apps/on-chain-client/src/generated/**` (via codegen — `getNoopInstruction` and its source file disappear)

**Interfaces:**
- Consumes: Task 1's rebuilt IDL (no `noop` instruction).
- Produces: `on-chain-client`'s public exports with no `getNoopInstruction` — Task 8 depends on this (deleting `noop.ts`, the only frontend consumer of that export).

- [ ] **Step 1: Confirm current state**

Run: `pnpm --filter on-chain-client run test`
Expected: PASS, including the "exports a noop instruction builder" test.

- [ ] **Step 2: Regenerate the client from the updated IDL**

Run: `pnpm codegen`
Expected: succeeds; `apps/on-chain-client/src/generated/instructions/noop.ts` no longer exists; `apps/on-chain-client/src/generated/instructions/index.ts` (or equivalent barrel) no longer re-exports `getNoopInstruction`.

- [ ] **Step 3: Remove the now-failing assertion from `index.test.ts`**

In `apps/on-chain-client/src/index.test.ts`, remove the `getNoopInstruction` import (line 3) and this block (lines 21-24):

```ts
  it("exports a noop instruction builder", () => {
    expect(typeof getNoopInstruction).toBe("function");
  });

```

- [ ] **Step 4: Run the client test suite**

Run: `pnpm --filter on-chain-client run test`
Expected: PASS, no reference to `getNoopInstruction` anywhere.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter on-chain-client run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/on-chain-client/src/generated apps/on-chain-client/src/index.test.ts
git commit -m "feat(019): regenerate on-chain-client without noop instruction"
```

---

## Task 3: Delete obsolete noop e2e test files

**Files:**
- Delete: `apps/on-chain-program-e2e/tests/noop.test.ts`
- Delete: `apps/e2e/tests/noop.spec.ts`

**Interfaces:**
- Consumes: nothing (pure deletion; both suites are picked up by glob, not an index file, per `[scripts] test = "pnpm --filter on-chain-program-e2e run test"` in `apps/on-chain-program/Anchor.toml` and Playwright's default `apps/e2e/tests/*.spec.ts` glob).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Delete both files**

```bash
git rm apps/on-chain-program-e2e/tests/noop.test.ts apps/e2e/tests/noop.spec.ts
```

- [ ] **Step 2: Confirm nothing else references them**

Run: `grep -rn "noop" apps/on-chain-program-e2e apps/e2e`
Expected: no output.

- [ ] **Step 3: Verify the remaining suites still typecheck** (these two full e2e suites need a live validator/Docker stack to actually execute — see Task 12's full verification; this step only confirms the deletion didn't break anything statically)

Run: `pnpm --filter on-chain-program-e2e run typecheck 2>/dev/null || true; pnpm --filter e2e exec tsc --noEmit`
Expected: no errors referencing the deleted files.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(019): delete obsolete noop e2e coverage"
```

---

## Task 4: New shared helper — `signAndSendTransaction`

**Files:**
- Create: `apps/frontend/src/server/transaction.ts`
- Test: `apps/frontend/src/server/transaction.test.ts`

**Interfaces:**
- Consumes: `SolanaContext` type from `apps/frontend/src/server/connection.ts` (only its `rpc`/`rpcSubscriptions` fields).
- Produces: `signAndSendTransaction(transactionMessage, context): Promise<void>` — Tasks 5, 6, 7 import this from `../transaction`.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/server/transaction.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSignTransactionMessageWithSigners,
  mockAssertIsTransactionWithBlockhashLifetime,
  mockSendAndConfirmTransaction,
} = vi.hoisted(() => ({
  mockSignTransactionMessageWithSigners: vi.fn(),
  mockAssertIsTransactionWithBlockhashLifetime: vi.fn(),
  mockSendAndConfirmTransaction: vi.fn(),
}));
vi.mock("@solana/kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/kit")>();
  return {
    ...actual,
    signTransactionMessageWithSigners: mockSignTransactionMessageWithSigners,
    assertIsTransactionWithBlockhashLifetime: mockAssertIsTransactionWithBlockhashLifetime,
    sendAndConfirmTransactionFactory: () => mockSendAndConfirmTransaction,
  };
});

import { signAndSendTransaction } from "./transaction";

const FAKE_TRANSACTION_MESSAGE = { instructions: [] } as never;
const RPC = {} as never;
const RPC_SUBSCRIPTIONS = {} as never;

describe("signAndSendTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs, asserts the blockhash lifetime, and sends-and-confirms in order", async () => {
    const signedTransaction = { signatures: {} };
    mockSignTransactionMessageWithSigners.mockResolvedValue(signedTransaction);
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);

    await signAndSendTransaction(FAKE_TRANSACTION_MESSAGE, {
      rpc: RPC,
      rpcSubscriptions: RPC_SUBSCRIPTIONS,
    });

    expect(mockSignTransactionMessageWithSigners).toHaveBeenCalledWith(FAKE_TRANSACTION_MESSAGE);
    expect(mockAssertIsTransactionWithBlockhashLifetime).toHaveBeenCalledWith(signedTransaction);
    expect(mockSendAndConfirmTransaction).toHaveBeenCalledWith(signedTransaction, {
      commitment: "confirmed",
    });
  });

  it("propagates rejection when the transaction's blockhash has expired", async () => {
    mockSignTransactionMessageWithSigners.mockResolvedValue({ signatures: {} });
    mockSendAndConfirmTransaction.mockRejectedValue(new Error("block height exceeded"));

    await expect(
      signAndSendTransaction(FAKE_TRANSACTION_MESSAGE, {
        rpc: RPC,
        rpcSubscriptions: RPC_SUBSCRIPTIONS,
      }),
    ).rejects.toThrow("block height exceeded");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- transaction.test.ts`
Expected: FAIL — `Cannot find module './transaction'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/server/transaction.ts`:

```ts
import {
  signTransactionMessageWithSigners,
  assertIsTransactionWithBlockhashLifetime,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import type { SolanaContext } from "./connection";

// `signTransactionMessageWithSigners` returns the non-generic `TransactionWithLifetime`
// (blockhash-or-nonce union) rather than preserving the blockhash-specific lifetime the
// caller set on the message, so narrow it back with the library's own assertion before
// handing it to `sendAndConfirmTransaction`, which requires a blockhash-lifetime
// transaction.
export async function signAndSendTransaction(
  transactionMessage: Parameters<typeof signTransactionMessageWithSigners>[0],
  context: Pick<SolanaContext, "rpc" | "rpcSubscriptions">,
): Promise<void> {
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
    rpc: context.rpc,
    rpcSubscriptions: context.rpcSubscriptions,
  });
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend run test -- transaction.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter frontend run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/server/transaction.ts apps/frontend/src/server/transaction.test.ts
git commit -m "feat(019): add shared signAndSendTransaction helper"
```

---

## Task 5: Migrate `auth.ts` (`registerUser`) to the shared helper

**Files:**
- Modify: `apps/frontend/src/server/actions/auth.ts:1-25,90-104`
- Modify: `apps/frontend/src/server/actions/auth.test.ts:19-31,80-81`

**Interfaces:**
- Consumes: `signAndSendTransaction` from `../transaction` (Task 4).
- Produces: nothing new consumed elsewhere — `registerUser`'s public signature is unchanged.

- [ ] **Step 1: Update the test to mock the helper instead of `@solana/kit` internals**

In `apps/frontend/src/server/actions/auth.test.ts`, replace lines 19-31:

```ts
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
```

with:

```ts
const { mockSignAndSendTransaction } = vi.hoisted(() => ({
  mockSignAndSendTransaction: vi.fn(),
}));
vi.mock("../transaction", () => ({ signAndSendTransaction: mockSignAndSendTransaction }));
```

Then in the `registerUser` describe block's `beforeEach` (around line 80-81), replace:

```ts
    mockSignTransactionMessageWithSigners.mockResolvedValue({});
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);
```

with:

```ts
    mockSignAndSendTransaction.mockResolvedValue(undefined);
```

And in the "surfaces a friendly error when the username is already taken" test, replace:

```ts
    mockSendAndConfirmTransaction.mockRejectedValue(new Error("already in use"));
```

with:

```ts
    mockSignAndSendTransaction.mockRejectedValue(new Error("already in use"));
```

And in the "creates the on-chain account..." test, replace:

```ts
    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
```

with:

```ts
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- auth.test.ts`
Expected: FAIL — `registerUser` still imports the old kit functions directly, so `mockSignAndSendTransaction` is never called and assertions like `toHaveBeenCalledTimes(1)` fail; the "already taken" test's rejection is never triggered either.

- [ ] **Step 3: Update `auth.ts` to call the helper**

In `apps/frontend/src/server/actions/auth.ts`, change the import block (lines 4-13) from:

```ts
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
```

to:

```ts
import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
} from "@solana/kit";
```

and add, alongside the other local imports:

```ts
import { signAndSendTransaction } from "../transaction";
```

Then replace (lines 99-104):

```ts
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  try {
    await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
  } catch (error) {
```

with:

```ts
  try {
    await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });
  } catch (error) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend run test -- auth.test.ts`
Expected: PASS, all `registerUser`/`loginUser`/`logoutUser`/`getCurrentUsername` tests unchanged in outcome.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter frontend run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/server/actions/auth.ts apps/frontend/src/server/actions/auth.test.ts
git commit -m "refactor(019): migrate auth.ts to signAndSendTransaction helper"
```

---

## Task 6: Migrate `registry.ts` (`initializeRegistry`) to the shared helper

**Files:**
- Modify: `apps/frontend/src/server/actions/registry.ts:1-14,40-46`
- Modify: `apps/frontend/src/server/actions/registry.test.ts:25-37,70-71,85-89`

**Interfaces:**
- Consumes: `signAndSendTransaction` from `../transaction` (Task 4).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Update the test to mock the helper instead of `@solana/kit` internals**

In `apps/frontend/src/server/actions/registry.test.ts`, replace lines 25-37:

```ts
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
```

with:

```ts
const { mockSignAndSendTransaction } = vi.hoisted(() => ({
  mockSignAndSendTransaction: vi.fn(),
}));
vi.mock("../transaction", () => ({ signAndSendTransaction: mockSignAndSendTransaction }));
```

In the `beforeEach` (lines 70-71), replace:

```ts
    mockSignTransactionMessageWithSigners.mockResolvedValue({});
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);
```

with:

```ts
    mockSignAndSendTransaction.mockResolvedValue(undefined);
```

In "returns the existing active game count..." test (line 84), replace:

```ts
    expect(mockSendAndConfirmTransaction).not.toHaveBeenCalled();
```

with:

```ts
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
```

and drop the dangling `noop.ts` pointer — replace the comment above the `mockFindRegistryPda` assertion (lines 85-87):

```ts
    // Regression guard: the registry PDA must be derived against the
    // env-configured program address (getSolanaContext), never the
    // codegen-baked default — see apps/frontend/src/server/actions/noop.ts.
```

with:

```ts
    // Regression guard: the registry PDA must be derived against the
    // env-configured program address (getSolanaContext), never the
    // codegen-baked default.
```

In "sends the init transaction and returns zero active games..." test (line 99), replace:

```ts
    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
```

with:

```ts
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(1);
```

(The regression-guard comment immediately after this line, about `initializeRegistry.ts`'s codegen-baked default, is unrelated to `noop.ts` — leave it untouched.)

In "recovers by re-fetching when the init transaction races..." test, replace:

```ts
    mockSendAndConfirmTransaction.mockRejectedValueOnce(new Error("already in use"));
```

with:

```ts
    mockSignAndSendTransaction.mockRejectedValueOnce(new Error("already in use"));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- registry.test.ts`
Expected: FAIL — `initializeRegistry` still calls the real (unmocked, since `@solana/kit` mock is gone) `signTransactionMessageWithSigners`/`sendAndConfirmTransactionFactory`, which will throw or hang against fake RPC objects.

- [ ] **Step 3: Update `registry.ts` to call the helper**

In `apps/frontend/src/server/actions/registry.ts`, change the import block (lines 3-12) from:

```ts
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
```

to:

```ts
import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
} from "@solana/kit";
```

and add:

```ts
import { signAndSendTransaction } from "../transaction";
```

Then replace (lines 40-46):

```ts
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  // See apps/frontend/src/server/actions/noop.ts for why this assertion is needed.
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  try {
    await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
  } catch (error) {
```

with:

```ts
  try {
    await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });
  } catch (error) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend run test -- registry.test.ts`
Expected: PASS, all three `initializeRegistry` tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter frontend run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/server/actions/registry.ts apps/frontend/src/server/actions/registry.test.ts
git commit -m "refactor(019): migrate registry.ts to signAndSendTransaction helper"
```

---

## Task 7: Migrate `game.ts` (`createGame`) to the shared helper

**Files:**
- Modify: `apps/frontend/src/server/actions/game.ts:1-19,59-63`
- Modify: `apps/frontend/src/server/actions/game.test.ts:35-47,91-92,119`

**Interfaces:**
- Consumes: `signAndSendTransaction` from `../transaction` (Task 4).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Update the test to mock the helper instead of `@solana/kit` internals**

In `apps/frontend/src/server/actions/game.test.ts`, replace lines 35-47:

```ts
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
```

with:

```ts
const { mockSignAndSendTransaction } = vi.hoisted(() => ({
  mockSignAndSendTransaction: vi.fn(),
}));
vi.mock("../transaction", () => ({ signAndSendTransaction: mockSignAndSendTransaction }));
```

In the `createGame` describe block's `beforeEach` (lines 91-92), replace:

```ts
    mockSignTransactionMessageWithSigners.mockResolvedValue({});
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);
```

with:

```ts
    mockSignAndSendTransaction.mockResolvedValue(undefined);
```

In "creates the game and sends the transaction on success" (line 119), replace:

```ts
    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
```

with:

```ts
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- game.test.ts`
Expected: FAIL — same reason as Task 6 Step 2.

- [ ] **Step 3: Update `game.ts` to call the helper**

In `apps/frontend/src/server/actions/game.ts`, change the import block (lines 3-12) from:

```ts
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
```

to:

```ts
import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
} from "@solana/kit";
```

and add:

```ts
import { signAndSendTransaction } from "../transaction";
```

Then replace (lines 59-64):

```ts
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });

  return { ok: true };
```

with:

```ts
  await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });

  return { ok: true };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend run test -- game.test.ts`
Expected: PASS, both `createGame` and `listMyGames` describe blocks.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter frontend run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/server/actions/game.ts apps/frontend/src/server/actions/game.test.ts
git commit -m "refactor(019): migrate game.ts to signAndSendTransaction helper"
```

---

## Task 8: Delete `noop.ts` and the root no-op demo page

**Files:**
- Delete: `apps/frontend/src/server/actions/noop.ts`
- Delete: `apps/frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: Task 2 (on-chain-client no longer exports `getNoopInstruction`, so nothing needs `noop.ts` to keep compiling).
- Produces: nothing — `/` is bare (no `page.tsx`) until Task 9 puts the relocated dashboard there.

- [ ] **Step 1: Confirm nothing still imports either file**

Run: `grep -rn "actions/noop\|from \"@/server/actions/noop\"" apps/frontend/src`
Expected: only `apps/frontend/src/app/page.tsx` itself (its `import { sendNoopTransaction } from "@/server/actions/noop";`), which is being deleted in the same step.

- [ ] **Step 2: Delete both files**

```bash
git rm apps/frontend/src/server/actions/noop.ts apps/frontend/src/app/page.tsx
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter frontend run typecheck && pnpm --filter frontend run lint`
Expected: PASS. (`/` will 404 until Task 9 — expected, intermediate state.)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(019): delete noop server action and demo page"
```

---

## Task 9: Relocate the dashboard from `/home` to `/`

**Files:**
- Move: `apps/frontend/src/app/(app)/home/page.tsx` → `apps/frontend/src/app/(app)/page.tsx`
- Move: `apps/frontend/src/app/(app)/home/page.test.tsx` → `apps/frontend/src/app/(app)/page.test.tsx`
- Move: `apps/frontend/src/app/(app)/home/LogoutButton.tsx` → `apps/frontend/src/app/(app)/LogoutButton.tsx`
- Move: `apps/frontend/src/app/(app)/home/LogoutButton.test.tsx` → `apps/frontend/src/app/(app)/LogoutButton.test.tsx`
- Delete: `apps/frontend/src/app/(app)/home/` (directory, once empty)

**Interfaces:**
- Consumes: nothing new — the moved `page.tsx` already imports `LogoutButton` via the relative path `"./LogoutButton"`, which stays correct since both files move into the same directory together.
- Produces: `apps/frontend/src/app/(app)/page.tsx` renders at `/` (route groups don't affect the URL) — Task 10 relies on this existing before flipping `middleware.ts`.

- [ ] **Step 1: Move the four files**

```bash
git mv apps/frontend/src/app/\(app\)/home/page.tsx apps/frontend/src/app/\(app\)/page.tsx
git mv apps/frontend/src/app/\(app\)/home/page.test.tsx apps/frontend/src/app/\(app\)/page.test.tsx
git mv apps/frontend/src/app/\(app\)/home/LogoutButton.tsx apps/frontend/src/app/\(app\)/LogoutButton.tsx
git mv apps/frontend/src/app/\(app\)/home/LogoutButton.test.tsx apps/frontend/src/app/\(app\)/LogoutButton.test.tsx
```

- [ ] **Step 2: Confirm the `home` directory is empty and remove it**

Run: `ls apps/frontend/src/app/\(app\)/home/ 2>&1`
Expected: `No such file or directory` — `git mv` on the last file in a directory removes the now-empty directory automatically. If it still exists and is empty, `rmdir "apps/frontend/src/app/(app)/home"`.

- [ ] **Step 3: Run the moved tests in place**

Run: `pnpm --filter frontend run test -- LogoutButton.test.tsx`
Expected: PASS, unchanged (no content edits, pure relocation).

Run: `pnpm --filter frontend run test -- "app/(app)/page.test.tsx"`
Expected: PASS — the test imports `HomePage` from `./page` (still correct) and checks `data-testid="home-welcome"`/redirect-to-`/login` behavior, unaffected by the move.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter frontend run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/frontend/src/app/\(app\)
git commit -m "feat(019): relocate dashboard from /home to /"
```

---

## Task 10: Gate `/` behind the session middleware

**Files:**
- Modify: `apps/frontend/src/middleware.ts:8`
- Modify: `apps/frontend/src/middleware.test.ts:14-18,44-66`

**Interfaces:**
- Consumes: Task 9 (there must be real dashboard content at `/` before removing it from `PUBLIC_PATHS`, or an authenticated visit to `/` would 404 instead of showing the dashboard).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the test first**

In `apps/frontend/src/middleware.test.ts`, replace the first test (lines 14-18):

```ts
  it("allows the root noop demo page through without a session", async () => {
    const request = new NextRequest("http://localhost/");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });
```

with:

```ts
  it("redirects to /login for an unauthenticated visitor to the root dashboard", async () => {
    const request = new NextRequest("http://localhost/");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows the root dashboard through with a valid session cookie", async () => {
    mockVerifySessionCookie.mockResolvedValue({ username: "alice" });
    const request = new NextRequest("http://localhost/", {
      headers: { cookie: "session=good-value" },
    });
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });
```

(The existing `/home`-pathed tests at lines 44-66 — "redirects to /login when there is no session cookie on a protected route", "redirects to /login when the session cookie is invalid", "allows a protected route through with a valid session cookie" — already exercise the generic protected-route branch via the `/home` path string; leave them as-is, since `/home` no longer resolving to a page doesn't matter to `middleware.ts`, which only inspects the path string, not routing.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- middleware.test.ts`
Expected: FAIL — `/` is still in `PUBLIC_PATHS`, so the unauthenticated-visitor test gets `location: null` instead of a redirect.

- [ ] **Step 3: Update `middleware.ts`**

In `apps/frontend/src/middleware.ts`, change line 8 from:

```ts
const PUBLIC_PATHS = new Set(["/", "/login", "/register"]);
```

to:

```ts
const PUBLIC_PATHS = new Set(["/login", "/register"]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend run test -- middleware.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter frontend run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/middleware.ts apps/frontend/src/middleware.test.ts
git commit -m "feat(019): gate / behind session middleware"
```

---

## Task 11: Fix post-auth redirect target (`/home` → `/`)

**Files:**
- Modify: `apps/frontend/src/app/(auth)/login/page.tsx:25`
- Modify: `apps/frontend/src/app/(auth)/login/page.test.tsx:18,26`
- Modify: `apps/frontend/src/app/(auth)/register/page.tsx:32`
- Modify: `apps/frontend/src/app/(auth)/register/page.test.tsx:34,43`
- Modify: `apps/e2e/tests/auth.spec.ts:8,18,24,25,31,44`
- Modify: `apps/e2e/tests/game-creation.spec.ts:17,42`

**Interfaces:**
- Consumes: Task 10 (`/` must already be the session-gated dashboard for these redirects/assertions to be correct).
- Produces: nothing consumed by later tasks — this is the last frontend behavior change.

- [ ] **Step 1: Update the login test first**

In `apps/frontend/src/app/(auth)/login/page.test.tsx`, rename the test at line 18 from `"submits and redirects to /home on success"` to `"submits and redirects to / on success"`, and change line 26 from:

```ts
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/home"));
```

to:

```ts
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- "app/(auth)/login/page.test.tsx"`
Expected: FAIL — `LoginPage` still calls `router.push("/home")`.

- [ ] **Step 3: Update `login/page.tsx`**

In `apps/frontend/src/app/(auth)/login/page.tsx`, change line 25 from:

```ts
          router.push("/home");
```

to:

```ts
          router.push("/");
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend run test -- "app/(auth)/login/page.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Repeat Steps 1-4 for register**

In `apps/frontend/src/app/(auth)/register/page.test.tsx`, rename the test at line 34 from `"submits and redirects to /home on success"` to `"submits and redirects to / on success"`, and change line 43 from:

```ts
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/home"));
```

to:

```ts
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
```

Run: `pnpm --filter frontend run test -- "app/(auth)/register/page.test.tsx"` → expect FAIL.

In `apps/frontend/src/app/(auth)/register/page.tsx`, change line 32 from:

```ts
          router.push("/home");
```

to:

```ts
          router.push("/");
```

Run: `pnpm --filter frontend run test -- "app/(auth)/register/page.test.tsx"` → expect PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter frontend run typecheck`
Expected: PASS.

- [ ] **Step 7: Update the e2e specs**

In `apps/e2e/tests/auth.spec.ts`:
- Line 8: rename the test to `"a new user can register, land on /, log out, and log back in"`.
- Line 18: `await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });` → `await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });`
- Line 24: `await page.goto("/home");` → `await page.goto("/");` (visiting the dashboard root while logged out; line 25's `await expect(page).toHaveURL(/\/login$/);` stays unchanged — it already asserts the redirect-to-login outcome)
- Line 31: `await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });` → `await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });`
- Line 44: `await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });` → `await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });`

In `apps/e2e/tests/game-creation.spec.ts`:
- Line 17: `await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });` → `await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });`
- Line 42: `await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });` → `await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });`

- [ ] **Step 8: Typecheck the e2e package**

Run: `pnpm --filter e2e exec tsc --noEmit`
Expected: PASS. (Full Playwright execution needs the Docker stack — covered in Task 12.)

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/app/\(auth\)/login/page.tsx apps/frontend/src/app/\(auth\)/login/page.test.tsx \
        apps/frontend/src/app/\(auth\)/register/page.tsx apps/frontend/src/app/\(auth\)/register/page.test.tsx \
        apps/e2e/tests/auth.spec.ts apps/e2e/tests/game-creation.spec.ts
git commit -m "fix(019): redirect login/register to / instead of deleted /home"
```

---

## Task 12: Full verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-11.
- Produces: the "Done Means" evidence required by `CLAUDE.md` before this ticket can be marked complete.

- [ ] **Step 1: Lint and typecheck everything**

Run: `just lint` (if this rewrites unexpectedly per `CLAUDE.local.md`'s rtk note, cross-check with `rtk proxy pnpm lint`) `&& just typecheck`
Expected: PASS with no changes needed.

- [ ] **Step 2: Run every locally-runnable test suite**

Run: `just test-program-unit && just test-ui && just test-on-chain-client`
Expected: PASS. This covers Tasks 1, 2, 4-11's unit-level changes.

- [ ] **Step 3: Run the full e2e suite (needs Docker)**

Run: `just test`
Expected: PASS — this exercises `test-e2e-program` (Anchor/mocha against the on-chain program, confirming `noop`'s removal didn't break anything and the remaining instructions still work) and `test-e2e` (Playwright against the full stack, confirming `auth.spec.ts`'s and `game-creation.spec.ts`'s updated `/` assertions pass for real, and that no leftover `noop.spec.ts` exists to fail).

- [ ] **Step 4: Boot the stack and manually exercise the acceptance criteria**

Run: `just up-build` (or `just up` if already built)

Then, in a browser:
1. Visit `/` while logged out → confirm redirect to `/login`.
2. Register a new user → confirm landing on `/` showing `Welcome, <username>` and a "Log out" button (not a 404, not the old noop demo).
3. Visit `/home` directly → confirm a 404 (no redirect).
4. Click "Log out" → confirm redirect to `/login`.
5. Log back in with the same credentials → confirm landing on `/` again.

Expected: all five observations match. Record the observed HTTP status/page content per `CLAUDE.md`'s "Done Means" #3 — do not claim done from test output alone.

- [ ] **Step 5: Tear down**

Run: `just down-clean` (only if you want a clean slate afterward — not required to close out the ticket).

---

## Self-review

- **Spec coverage:** every bullet in `docs/tickets/019-remove-noop-relocate-dashboard.md` maps to a task — on-chain removal (Task 1), e2e/client cleanup (Tasks 2-3), `noop.ts` deletion + shared helper (Tasks 4-8), page relocation (Task 9), old-route deletion (implicit in Task 9's `git mv`, verified in Task 12 Step 4.3), middleware gating (Task 10), ticket 018 amendment (confirmed already done during planning — see Global Constraints). The one item not in the original ticket/design/openspec docs — the `/home` redirect hardcoded in `login.tsx`/`register.tsx` and asserted in two e2e specs — was confirmed in-scope with the user and covered by Task 11.
- **Placeholder scan:** no TBD/"add error handling"/"similar to Task N" — every step has literal file paths, line numbers, and full code blocks.
- **Type consistency:** `signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions }): Promise<void>` is defined once in Task 4 and called identically (same parameter shape) in Tasks 5, 6, 7. Mock name `mockSignAndSendTransaction` is consistent across Tasks 4-7's test files.
- **Ordering rationale:** on-chain → codegen → helper → call-site migrations → deletions → relocation → middleware → redirect fix, so that at every commit boundary the app is in a working (if not yet complete) state: Task 8 leaves `/` 404ing only until Task 9 immediately follows; Task 10 (removing `/` from `PUBLIC_PATHS`) only lands after Task 9 has put real content there.
