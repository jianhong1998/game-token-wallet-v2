# Task 7 Log: `noop` Server Action + proof-of-plumbing page

## Task Context

### Plan Section
## Task 7: `noop` Server Action + proof-of-plumbing page

**Files:**
- Create: `apps/frontend/src/server/actions/noop.ts`
- Modify: `apps/frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `getSolanaContext()` (Task 6), `getNoopInstruction` / program-address constant (Task 3).
- Produces: `sendNoopTransaction(): Promise<{ signature: string }>` — a Server Action Task 8's Playwright test exercises indirectly through the page, not by importing it directly.

- [ ] **Step 1: Write the Server Action**

`apps/frontend/src/server/actions/noop.ts` (use the exact generated export names confirmed in Task 3, Step 4):
```typescript
"use server";

import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  createSolanaRpcSubscriptions,
  getSignatureFromTransaction,
} from "@solana/kit";
import { getNoopInstruction } from "on-chain-client";
import { getSolanaContext } from "../connection";
import { loadSolanaEnv } from "../env";

export async function sendNoopTransaction(): Promise<{ signature: string }> {
  const { rpc, adminSigner, programAddress } = await getSolanaContext();
  const env = loadSolanaEnv();

  const rpcSubscriptions = createSolanaRpcSubscriptions(
    env.rpcUrl.replace(/^http/, "ws"),
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const noopInstruction = getNoopInstruction({}, { programAddress });

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([noopInstruction], tx),
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });

  return { signature: getSignatureFromTransaction(signedTransaction) };
}
```

- [ ] **Step 2: Replace the placeholder home page with the proof-of-plumbing UI**

`apps/frontend/src/app/page.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { sendNoopTransaction } from "@/server/actions/noop";

export default function HomePage() {
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendNoopTransaction();
        setSignature(result.signature);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  return (
    <main className="py-8 flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Game Token Wallet</h1>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Send noop transaction"}
      </button>
      {signature && (
        <p data-testid="noop-signature" className="break-all text-sm text-green-700">
          {signature}
        </p>
      )}
      {error && (
        <p data-testid="noop-error" className="break-all text-sm text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Verify the build still succeeds**

Run: `pnpm --filter frontend run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/server/actions apps/frontend/src/app/page.tsx
git commit -m "feat: add noop Server Action and proof-of-plumbing page"
```

---

### Deviation from plan (pre-confirmed by orchestrator)
Task 3's real `getNoopInstruction` signature is a single optional config object:
`getNoopInstruction({ programAddress })`, NOT the plan's two-arg example
`getNoopInstruction({}, { programAddress })`. Verified directly against
`packages/on-chain-client/src/generated/instructions/noop.ts:74-87`:
```typescript
export function getNoopInstruction<
  TProgramAddress extends Address = typeof GAME_TOKEN_WALLET_PROGRAM_ADDRESS,
>(config?: {
  programAddress?: TProgramAddress;
}): NoopInstruction<TProgramAddress> {
  const programAddress =
    config?.programAddress ?? GAME_TOKEN_WALLET_PROGRAM_ADDRESS;
  ...
}
```
The Server Action call site is adjusted to `getNoopInstruction({ programAddress })`.

Also verified Task 6 real exports match plan expectations exactly:
- `apps/frontend/src/server/env.ts` exports `loadSolanaEnv(): SolanaEnv` (env vars read lazily inside function body).
- `apps/frontend/src/server/connection.ts` exports `getSolanaContext(): Promise<SolanaContext>` where
  `SolanaContext = { rpc, adminSigner, programAddress }` (env read lazily via `loadSolanaEnv()` inside
  `createContext()`, memoized behind a promise — no module-scope env reads).

### Acceptance Criteria
- AC-1: `apps/frontend/src/server/actions/noop.ts` exports `sendNoopTransaction(): Promise<{ signature: string }>` as a Server Action (`"use server"`), consuming `getSolanaContext()` and `getNoopInstruction`.
- AC-2: `apps/frontend/src/app/page.tsx` renders a button with accessible name "Send noop transaction" that invokes `sendNoopTransaction()`, and shows result/error in elements with `data-testid="noop-signature"` / `data-testid="noop-error"`.
- AC-3: `pnpm --filter frontend run build` succeeds (no module-scope env var reads reachable from a page).

---

## Attempt 1 — 2026-07-21T11:20:00Z

### Implementation Plan
- Confirm real Task 6 exports (`loadSolanaEnv`, `getSolanaContext`) match plan's expected shape by reading `env.ts`/`connection.ts` directly.
- Confirm real Task 3 `getNoopInstruction` signature by reading `packages/on-chain-client/src/generated/instructions/noop.ts` — apply the pre-flagged single-config-object fix.
- Write `apps/frontend/src/server/actions/noop.ts` per plan Step 1, with `getNoopInstruction({ programAddress })`.
- Replace `apps/frontend/src/app/page.tsx` with the plan's Step 2 UI verbatim.
- Run `pnpm --filter frontend run build` as the verification gate.

### Files Changed
- created `apps/frontend/src/server/actions/noop.ts` — Server Action `sendNoopTransaction()` building/signing/sending the noop instruction via `getSolanaContext()`
- modified `apps/frontend/src/app/page.tsx` — proof-of-plumbing UI with "Send noop transaction" button and `data-testid="noop-signature"`/`data-testid="noop-error"` result elements

### New Tests
(none — plan Task 7 has no unit-test step; verification is `next build` type-checking, per plan Step 3)

### Key Decisions
(none yet — build failed before any judgment calls were needed)

### Lint Output
n/a — not reached this attempt

### Test Output
n/a — build (`next build`) is the verification gate per plan Step 3; failed at TypeScript check:
```
./src/server/actions/noop.ts:39:35
Type error: Argument of type 'FullySignedTransaction & TransactionWithinSizeLimit & Readonly<{ messageBytes: TransactionMessageBytes; signatures: SignaturesMap; }> & TransactionWithLifetime' is not assignable to parameter of type '... & Omit<...> & { ... }'.
  Type 'FullySignedTransaction & TransactionWithinSizeLimit & Readonly<{ messageBytes: TransactionMessageBytes; signatures: SignaturesMap; }> & TransactionWithLifetime' is not assignable to type '{ lifetimeConstraint: Omit<TransactionBlockhashLifetime, "blockhash">; }'.
    Types of property 'lifetimeConstraint' are incompatible.
      Type 'TransactionBlockhashLifetime | TransactionDurableNonceLifetime' is not assignable to type 'Omit<TransactionBlockhashLifetime, "blockhash">'.
        Property 'lastValidBlockHeight' is missing in type 'TransactionDurableNonceLifetime' but required in type 'Omit<TransactionBlockhashLifetime, "blockhash">'.
```
Root cause (confirmed via `node_modules/.pnpm/@solana+signers@5.5.1.../sign-transaction.d.ts`): `signTransactionMessageWithSigners`'s declared return type is the **non-generic** `Promise<SendableTransaction & Transaction & TransactionWithLifetime>` — it does not propagate the blockhash-specific lifetime type from its input `transactionMessage`, even though `setTransactionMessageLifetimeUsingBlockhash` correctly narrows the transaction *message* type earlier in the pipe. `sendAndConfirmTransactionFactory` requires the narrower `TransactionWithLastValidBlockHeight`. This is a genuine `@solana/kit@5.5.1` type-declaration gap in the plan's example code, not a mistake introduced here — reproduced identically by running `tsc --noEmit` directly against Task 4's already-committed `apps/on-chain-program-e2e/tests/noop.test.ts` (same `pipe`/`sendAndConfirmTransactionFactory` pattern), which only escaped detection there because `vitest` does not type-check by default.

### Commit
n/a — retrying

### Outcome: failed — `@solana/kit@5.5.1` type gap: `signTransactionMessageWithSigners` returns non-generic `TransactionWithLifetime`, not assignable to `sendAndConfirmTransactionFactory`'s required blockhash-lifetime parameter type

---

## Attempt 2 — 2026-07-21T11:28:00Z

### Implementation Plan
- Import `assertIsTransactionWithBlockhashLifetime` from `@solana/kit` (re-exported from `@solana/transactions`) — the library's own documented type-guard for exactly this narrowing gap.
- Call it on `signedTransaction` immediately after `signTransactionMessageWithSigners`, before passing to `sendAndConfirmTransaction`.
- Re-run `pnpm --filter frontend run build`.
- Also run `pnpm --filter frontend run lint` as a cheap extra check (not the formal gate, but free given CLAUDE.md's Done-Means bar).

### Files Changed
- modified `apps/frontend/src/server/actions/noop.ts` — added `assertIsTransactionWithBlockhashLifetime(signedTransaction)` call + explanatory comment before `sendAndConfirmTransaction`

### New Tests
(none — plan Task 7 has no unit-test step)

### Key Decisions
- Used `assertIsTransactionWithBlockhashLifetime` (an exported, documented runtime type-guard from `@solana/transactions`/`@solana/kit`) rather than an `as` cast — it performs a real runtime check (throws if the transaction unexpectedly lacks a blockhash lifetime) instead of silently lying to the type system, and it's the pattern the library's own doc comments recommend for this exact narrowing gap.
- Left Task 4's `apps/on-chain-program-e2e/tests/noop.test.ts` untouched — it has the same latent type gap but is out of scope for Task 7 (already committed in a prior task; vitest doesn't type-check it so it isn't a build-breaking issue there).

### Lint Output
PASS (`pnpm --filter frontend run lint` — `eslint .` — no output, no errors)

### Test Output
PASS — `pnpm --filter frontend run build`:
```
▲ Next.js 16.2.10 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 991ms
  Running TypeScript ...
  Finished TypeScript in 1129ms ...
  Collecting page data using 4 workers ...
  Generating static pages using 4 workers (3/3) in 164ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
└ ○ /_not-found

○  (Static)  prerendered as static content
```
Confirms AC-3: no module-scope env var reads reachable from `/` — build succeeds with zero env vars set in this shell, consistent with Task 6's `loadSolanaEnv()`/`getSolanaContext()` reading env only lazily inside function bodies invoked at request time.

### Commit
`d0d12b2`

### Outcome: success
