# Registry Account + Init Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `Registry` PDA to the on-chain program (bounded list of active game IDs) plus an `initialize_registry` instruction, and a Next.js Server Action + admin page that triggers it and confirms success.

**Architecture:** New `state/registry.rs` (Anchor account, `Vec<Pubkey>` capped at `MAX_ACTIVE_GAMES`) and `instructions/registry/initialize.rs` (plain Anchor `init`, so a raw second on-chain call fails cleanly). The Next.js Server Action makes this idempotent from the caller's perspective by reading the account first and only sending a transaction when it doesn't yet exist. Admin page at `/admin/registry` triggers the action and renders the result.

**Tech Stack:** Anchor 1.x (Rust), `@solana/kit`, Codama-generated `on-chain-client`, Next.js Server Actions, Vitest, Playwright.

## Global Constraints

- `MAX_ACTIVE_GAMES = 128` (Rust `usize` constant in `state/registry.rs`).
- Registry PDA seed is exactly `[b"registry"]` (architecture Q4 — already fixed, do not change).
- On-chain `initialize_registry` instruction uses a plain Anchor `init` constraint — no `init_if_needed`, no custom error type. A second raw on-chain call must fail with Anchor's ordinary `Err`, never panic.
- Idempotent "always succeeds" behavior lives ONLY in the frontend Server Action (read-before-write), not on-chain.
- Admin page lives at `apps/frontend/src/app/admin/registry/page.tsx` (route `/admin/registry`), with no access gating.
- Display text on success must read exactly: `registry initialized, {n} active games` (matches the ticket's example verbatim — no singular/plural grammar handling, no extra punctuation).
- Commits follow Conventional Commits (enforced by `.hooks/commit-msg`). Work happens on the already-checked-out branch `feat/002-registry-account-init` — do not create a new branch.
- Full spec/rationale: `docs/superpowers/specs/2026-07-23-registry-account-init-design.md`.

---

### Task 1: `Registry` on-chain account state

**Files:**
- Create: `apps/on-chain-program/programs/game_token_wallet/src/state/mod.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/state/registry.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`
- Test: inline `#[cfg(test)] mod tests` in `state/registry.rs`, run via `cargo test`

**Interfaces:**
- Produces: `pub const MAX_ACTIVE_GAMES: usize = 128;` and `pub struct Registry { pub bump: u8, pub active_games: Vec<Pubkey> }` (Anchor `#[account]` + `#[derive(InitSpace)]`), re-exported as `state::Registry` / `state::MAX_ACTIVE_GAMES`. Task 2 consumes both.

- [ ] **Step 1: Create the module skeleton and a failing test**

Create `apps/on-chain-program/programs/game_token_wallet/src/state/mod.rs`:

```rust
pub mod registry;

pub use registry::*;
```

Create `apps/on-chain-program/programs/game_token_wallet/src/state/registry.rs` with ONLY the test (the type it references doesn't exist yet, so this won't compile):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_init_space_accounts_for_max_active_games_pubkeys() {
        // 1 byte bump + 4 byte Vec length prefix + MAX_ACTIVE_GAMES * 32-byte Pubkey.
        let expected = 1 + 4 + MAX_ACTIVE_GAMES * 32;
        assert_eq!(Registry::INIT_SPACE, expected);
    }
}
```

Modify `apps/on-chain-program/programs/game_token_wallet/src/lib.rs` to add the module declaration (only change: insert `mod state;` after the `use anchor_lang::prelude::*;` line):

```rust
use anchor_lang::prelude::*;

mod state;

declare_id!("FHRNx4KK4WzMxXx7X6sK84RvKTKuDVtTGduW3eH9QN9t");

#[program]
pub mod game_token_wallet {
    use super::*;

    pub fn noop(_ctx: Context<Noop>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Noop {}
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd apps/on-chain-program && cargo test`
Expected: FAIL to compile — `cannot find type \`Registry\` in this scope` / `cannot find value \`MAX_ACTIVE_GAMES\` in this scope`.

- [ ] **Step 3: Implement the `Registry` account**

Replace the full contents of `apps/on-chain-program/programs/game_token_wallet/src/state/registry.rs` with:

```rust
use anchor_lang::prelude::*;

/// Bound chosen for a self-hosted, friend-group deployment (see
/// docs/superpowers/specs/2026-07-23-registry-account-init-design.md, Q2) —
/// generous headroom while keeping the singleton account small and cheap.
/// This is a one-time size decision: the account is never resized after init.
pub const MAX_ACTIVE_GAMES: usize = 128;

#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub bump: u8,
    #[max_len(MAX_ACTIVE_GAMES)]
    pub active_games: Vec<Pubkey>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_init_space_accounts_for_max_active_games_pubkeys() {
        // 1 byte bump + 4 byte Vec length prefix + MAX_ACTIVE_GAMES * 32-byte Pubkey.
        let expected = 1 + 4 + MAX_ACTIVE_GAMES * 32;
        assert_eq!(Registry::INIT_SPACE, expected);
    }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd apps/on-chain-program && cargo test`
Expected: PASS — `test state::registry::tests::registry_init_space_accounts_for_max_active_games_pubkeys ... ok`.

- [ ] **Step 5: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/state/mod.rs \
        apps/on-chain-program/programs/game_token_wallet/src/state/registry.rs \
        apps/on-chain-program/programs/game_token_wallet/src/lib.rs
git commit -m "feat(program): add Registry account state"
```

---

### Task 2: `initialize_registry` instruction

**Files:**
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/mod.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/registry/mod.rs`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/registry/initialize.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`

**Interfaces:**
- Consumes: `state::Registry`, `state::MAX_ACTIVE_GAMES` (Task 1).
- Produces: `instructions::InitializeRegistry` (Anchor `Accounts` struct) and `instructions::registry::initialize::handler(ctx: Context<InitializeRegistry>) -> Result<()>`, wired into the `#[program]` module as the `initialize_registry` instruction. Task 3's codegen (and everything downstream) depends on this instruction existing in the built IDL.

This task has no pure-logic unit test to drive red/green — the handler is one line of Anchor account wiring with no branching logic of its own (the "second call is rejected cleanly" guarantee comes from Anchor's `init` constraint itself, not from code we write). Real behavioral coverage arrives in Task 4's integration test against a running validator. This task's own gate is: it compiles and the instruction shows up correctly in the built IDL.

- [ ] **Step 1: Create the instruction**

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/mod.rs`:

```rust
pub mod registry;

pub use registry::*;
```

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/registry/mod.rs`:

```rust
pub mod initialize;

pub use initialize::*;
```

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/registry/initialize.rs`:

```rust
use anchor_lang::prelude::*;

use crate::state::Registry;

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Registry::INIT_SPACE,
        seeds = [b"registry"],
        bump,
    )]
    pub registry: Account<'info, Registry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeRegistry>) -> Result<()> {
    ctx.accounts.registry.bump = ctx.bumps.registry;
    Ok(())
}
```

- [ ] **Step 2: Wire it into the program module**

Replace the full contents of `apps/on-chain-program/programs/game_token_wallet/src/lib.rs` with:

```rust
use anchor_lang::prelude::*;

mod instructions;
mod state;

use instructions::InitializeRegistry;

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
}

#[derive(Accounts)]
pub struct Noop {}
```

- [ ] **Step 3: Build and verify the IDL**

Run: `cd apps/on-chain-program && anchor build`
Expected: Build succeeds with no errors. Then check the IDL:

Run: `grep -c "initialize_registry" apps/on-chain-program/target/idl/game_token_wallet.json`
Expected: A non-zero count (the instruction name appears in the generated IDL).

Run: `grep -c '"name": "Registry"' apps/on-chain-program/target/idl/game_token_wallet.json`
Expected: A non-zero count (the account type appears in the generated IDL).

- [ ] **Step 4: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/instructions \
        apps/on-chain-program/programs/game_token_wallet/src/lib.rs
git commit -m "feat(program): add initialize_registry instruction"
```

---

### Task 3: Regenerate `on-chain-client` and extend the sanity test

**Files:**
- Modify (autogenerated, do not hand-edit): `apps/on-chain-client/src/generated/**`
- Modify: `apps/on-chain-client/src/index.test.ts`

**Interfaces:**
- Consumes: the built IDL from Task 2 (`apps/on-chain-program/target/idl/game_token_wallet.json`).
- Produces (via codegen, verified against a real preview build during planning): `findRegistryPda(config?: { programAddress?: Address }): Promise<ProgramDerivedAddress>`, `fetchMaybeRegistry(rpc, address, config?): Promise<MaybeAccount<Registry>>`, `fetchRegistry(rpc, address, config?): Promise<Account<Registry>>`, `getInitializeRegistryInstructionAsync(input: { admin: TransactionSigner }, config?): Promise<Instruction>`, and the `Registry` type (`{ discriminator, bump: number, activeGames: Array<Address> }` — note camelCase `activeGames`). Tasks 4 and 5 consume these directly from `"on-chain-client"`.

- [ ] **Step 1: Regenerate the client**

Run (from repo root): `pnpm codegen`
Expected: Succeeds. `apps/on-chain-client/src/generated/` now contains new `accounts/` and `pdas/` directories (alongside the existing `instructions/`, `programs/`, `shared/`), and `apps/on-chain-client/src/generated/index.ts` now reads:

```ts
export * from "./accounts";
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
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter on-chain-client run test`
Expected: PASS — all 3 tests in `generated on-chain-client` green.

- [ ] **Step 4: Commit**

```bash
git add apps/on-chain-client/src/generated apps/on-chain-client/src/index.test.ts
git commit -m "feat(client): regenerate on-chain-client with registry account and instruction"
```

---

### Task 4: `on-chain-program-e2e` integration test

**Files:**
- Create: `apps/on-chain-program-e2e/tests/registry/initialize.test.ts`

**Interfaces:**
- Consumes: `getInitializeRegistryInstructionAsync`, `findRegistryPda`, `fetchRegistry` from `"on-chain-client"` (Task 3).

- [ ] **Step 1: Write the test**

Create `apps/on-chain-program-e2e/tests/registry/initialize.test.ts`:

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
import { getInitializeRegistryInstructionAsync, findRegistryPda, fetchRegistry } from "on-chain-client";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS_URL = process.env.SOLANA_RPC_WS_URL ?? "ws://127.0.0.1:8900";

async function sendInitializeRegistry(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
): Promise<void> {
  const instruction = await getInitializeRegistryInstructionAsync({ admin });
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

describe("initialize_registry instruction", () => {
  it("creates the Registry account with an empty active-games list, and rejects a second call cleanly", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await generateKeyPairSigner();

    const airdrop = airdropFactory({ rpc, rpcSubscriptions });
    await airdrop({
      commitment: "confirmed",
      recipientAddress: admin.address,
      lamports: lamports(1_000_000_000n),
    });

    await sendInitializeRegistry(rpc, rpcSubscriptions, admin);

    const [registryAddress] = await findRegistryPda();
    const registryAccount = await fetchRegistry(rpc, registryAddress);
    expect(registryAccount.data.activeGames).toEqual([]);

    await expect(sendInitializeRegistry(rpc, rpcSubscriptions, admin)).rejects.toThrow();
  }, 30_000);
});
```

- [ ] **Step 2: Run it against a local validator**

Run: `cd apps/on-chain-program && anchor test`
Expected: PASS. This spins up a fresh local validator, deploys the program, then runs the full `on-chain-program-e2e` suite (`noop.test.ts` and the new `registry/initialize.test.ts`) — both green.

- [ ] **Step 3: Commit**

```bash
git add apps/on-chain-program-e2e/tests/registry/initialize.test.ts
git commit -m "test(program-e2e): cover initialize_registry happy path and clean re-init rejection"
```

---

### Task 5: Frontend Server Action

**Files:**
- Create: `apps/frontend/src/server/actions/registry.ts`
- Test: `apps/frontend/src/server/actions/registry.test.ts`

**Interfaces:**
- Consumes: `getSolanaContext()` from `apps/frontend/src/server/connection.ts` (returns `{ rpc, rpcSubscriptions, adminSigner, programAddress }`, existing); `fetchMaybeRegistry`, `findRegistryPda`, `getInitializeRegistryInstructionAsync` from `"on-chain-client"` (Task 3).
- Produces: `initializeRegistry(): Promise<{ activeGameCount: number }>`, consumed by Task 6's page.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/server/actions/registry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MaybeAccount } from "@solana/kit";
import type { Registry } from "on-chain-client";

const { mockGetSolanaContext } = vi.hoisted(() => ({
  mockGetSolanaContext: vi.fn(),
}));
vi.mock("../connection", () => ({
  getSolanaContext: mockGetSolanaContext,
}));

const { mockFindRegistryPda, mockFetchMaybeRegistry, mockGetInitializeRegistryInstructionAsync } = vi.hoisted(
  () => ({
    mockFindRegistryPda: vi.fn(),
    mockFetchMaybeRegistry: vi.fn(),
    mockGetInitializeRegistryInstructionAsync: vi.fn(),
  }),
);
vi.mock("on-chain-client", () => ({
  findRegistryPda: mockFindRegistryPda,
  fetchMaybeRegistry: mockFetchMaybeRegistry,
  getInitializeRegistryInstructionAsync: mockGetInitializeRegistryInstructionAsync,
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

import { initializeRegistry } from "./registry";

const REGISTRY_ADDRESS = "Regi11111111111111111111111111111111111111";

function registryData(activeGames: string[]): Registry {
  return {
    discriminator: new Uint8Array(8),
    bump: 255,
    activeGames: activeGames as Registry["activeGames"],
  };
}

describe("initializeRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSolanaContext.mockResolvedValue({
      rpc: {
        getLatestBlockhash: () => ({
          send: async () => ({ value: { blockhash: "fake", lastValidBlockHeight: 1n } }),
        }),
      },
      rpcSubscriptions: {},
      adminSigner: { address: "Admin111111111111111111111111111111111111" },
      programAddress: "Prog1111111111111111111111111111111111111",
    });
    mockFindRegistryPda.mockResolvedValue([REGISTRY_ADDRESS, 255]);
    mockGetInitializeRegistryInstructionAsync.mockResolvedValue({
      programAddress: "Prog1111111111111111111111111111111111111",
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignTransactionMessageWithSigners.mockResolvedValue({});
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);
  });

  it("returns the existing active game count without sending a transaction when the registry already exists", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: registryData(["Game1111111111111111111111111111111111111"]),
    } as MaybeAccount<Registry>);

    const result = await initializeRegistry();

    expect(result).toEqual({ activeGameCount: 1 });
    expect(mockSendAndConfirmTransaction).not.toHaveBeenCalled();
    // Regression guard: the registry PDA must be derived against the
    // env-configured program address (getSolanaContext), never the
    // codegen-baked default — see apps/frontend/src/server/actions/noop.ts.
    expect(mockFindRegistryPda).toHaveBeenCalledWith({
      programAddress: "Prog1111111111111111111111111111111111111",
    });
  });

  it("sends the init transaction and returns zero active games when the registry does not yet exist", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({ exists: false, address: REGISTRY_ADDRESS } as MaybeAccount<Registry>);

    const result = await initializeRegistry();

    expect(result).toEqual({ activeGameCount: 0 });
    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
    expect(mockGetInitializeRegistryInstructionAsync).toHaveBeenCalledWith(
      { admin: { address: "Admin111111111111111111111111111111111111" } },
      { programAddress: "Prog1111111111111111111111111111111111111" },
    );
  });

  it("recovers by re-fetching when the init transaction races and the account already exists", async () => {
    mockFetchMaybeRegistry
      .mockResolvedValueOnce({ exists: false, address: REGISTRY_ADDRESS } as MaybeAccount<Registry>)
      .mockResolvedValueOnce({
        exists: true,
        address: REGISTRY_ADDRESS,
        data: registryData([]),
      } as MaybeAccount<Registry>);
    mockSendAndConfirmTransaction.mockRejectedValueOnce(new Error("already in use"));

    const result = await initializeRegistry();

    expect(result).toEqual({ activeGameCount: 0 });
    expect(mockFetchMaybeRegistry).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend run test -- registry.test.ts`
Expected: FAIL — `Cannot find module './registry'` (the action doesn't exist yet).

- [ ] **Step 3: Implement the Server Action**

Create `apps/frontend/src/server/actions/registry.ts`:

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
import { fetchMaybeRegistry, findRegistryPda, getInitializeRegistryInstructionAsync } from "on-chain-client";
import { getSolanaContext } from "../connection";

export async function initializeRegistry(): Promise<{ activeGameCount: number }> {
  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();

  const [registryAddress] = await findRegistryPda({ programAddress });

  const existing = await fetchMaybeRegistry(rpc, registryAddress);
  if (existing.exists) {
    return { activeGameCount: existing.data.activeGames.length };
  }

  const initializeInstruction = await getInitializeRegistryInstructionAsync(
    { admin: adminSigner },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([initializeInstruction], tx),
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  // See apps/frontend/src/server/actions/noop.ts for why this assertion is needed.
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  try {
    await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
  } catch (error) {
    // Concurrent caller may have initialized it first between our read and
    // our send — re-check rather than surfacing a scary error for what is,
    // from the caller's perspective, still a successful outcome.
    const raced = await fetchMaybeRegistry(rpc, registryAddress);
    if (raced.exists) {
      return { activeGameCount: raced.data.activeGames.length };
    }
    throw error;
  }

  return { activeGameCount: 0 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend run test -- registry.test.ts`
Expected: PASS — all 3 tests in `initializeRegistry` green.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/server/actions/registry.ts apps/frontend/src/server/actions/registry.test.ts
git commit -m "feat(frontend): add initializeRegistry server action"
```

---

### Task 6: Admin page

**Files:**
- Create: `apps/frontend/src/app/admin/registry/page.tsx`

**Interfaces:**
- Consumes: `initializeRegistry()` from `apps/frontend/src/server/actions/registry.ts` (Task 5).
- Produces: a page rendered at `/admin/registry` with a button (`role="button"`, name `Initialize registry`), and on success a `data-testid="registry-status"` element containing `registry initialized, {n} active games`, or on failure a `data-testid="registry-error"` element with the error message. Task 7's Playwright spec drives this exact markup.

- [ ] **Step 1: Implement the page**

Create `apps/frontend/src/app/admin/registry/page.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { initializeRegistry } from "@/server/actions/registry";

export default function AdminRegistryPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await initializeRegistry();
        setStatus(`registry initialized, ${result.activeGameCount} active games`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  return (
    <main className="py-8 flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Registry admin</h1>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? "Initializing…" : "Initialize registry"}
      </button>
      {status && (
        <p data-testid="registry-status" className="break-all text-sm text-green-700">
          {status}
        </p>
      )}
      {error && (
        <p data-testid="registry-error" className="break-all text-sm text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles cleanly**

Run: `pnpm --filter frontend run typecheck && pnpm --filter frontend run lint`
Expected: Both PASS with no errors. (Behavioral verification — does the button actually work end to end — is covered by Task 7's Playwright spec and Task 8's manual check, matching how the existing home page in `apps/frontend/src/app/page.tsx` has no colocated unit test either.)

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/app/admin/registry/page.tsx
git commit -m "feat(frontend): add admin registry init page"
```

---

### Task 7: Playwright end-to-end spec

**Files:**
- Create: `apps/e2e/tests/admin-registry.spec.ts`

**Interfaces:**
- Consumes: the running Docker Compose e2e stack (`docker-compose.e2e.yml`, prod-built frontend + Surfpool + program deploy), specifically the `/admin/registry` route and its `data-testid="registry-status"` markup from Task 6.

- [ ] **Step 1: Write the spec**

Create `apps/e2e/tests/admin-registry.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("admin can initialize the registry and see the active-game count", async ({ page }) => {
  await page.goto("/admin/registry");
  await page.getByRole("button", { name: "Initialize registry" }).click();
  await expect(page.getByTestId("registry-status")).toBeVisible({ timeout: 30_000 });

  const status = await page.getByTestId("registry-status").textContent();
  expect(status).toBe("registry initialized, 0 active games");
});
```

- [ ] **Step 2: Run it against the real stack**

Run: `docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e`
Expected: The compose run exits 0; the Playwright report shows `admin-registry.spec.ts` passing alongside the existing `noop.spec.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/admin-registry.spec.ts
git commit -m "test(e2e): cover admin registry init page"
```

---

### Task 8: Manual verification and final Done-Means checklist

No new files — this task confirms the whole feature works end to end on the local dev stack (not just the throwaway prod-built e2e stack from Task 7) and that repo-wide gates pass, per this repo's Done-Means rule.

- [ ] **Step 1: Boot the local dev stack**

Run: `just up-build`
Expected: `surfpool`, `program-deploy`, and `frontend` containers come up; `program-deploy` exits 0 (program deployed + client regenerated); `frontend` stays up, listening on `http://localhost:3000`.

- [ ] **Step 2: Exercise the real page in a browser**

Using a browser automation tool (e.g. chrome-devtools MCP or Playwright), navigate to `http://localhost:3000/admin/registry`, click the "Initialize registry" button, and read the resulting text.
Expected: Text reads exactly `registry initialized, 0 active games`.

- [ ] **Step 3: Confirm idempotent success on a second click**

Click "Initialize registry" again on the same page.
Expected: Text still reads `registry initialized, 0 active games` (no error shown, no page crash) — confirming the read-before-write idempotency from Task 5 works against a real deployed program, not just mocks.

- [ ] **Step 4: Tear down the dev stack**

Run: `just down-clean`
Expected: Containers and volumes removed cleanly.

- [ ] **Step 5: Run the full repo-wide test suite**

Run: `just test`
Expected: All of `cargo test`, `pnpm --filter frontend run test`, `pnpm --filter on-chain-client run test`, `anchor test`, and the `docker-compose.e2e.yml` Playwright run pass.

- [ ] **Step 6: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: Both PASS. (Per `CLAUDE.local.md`: if `pnpm lint` fails unexpectedly, re-run with `rtk proxy pnpm lint` to bypass a local hook rewrite before treating it as a real regression.)

- [ ] **Step 7: Final status check**

Run: `git log --oneline feat/002-registry-account-init` and `git status --short`
Expected: One commit per task above, working tree clean. Ready to hand off per `superpowers:finishing-a-development-branch`.
