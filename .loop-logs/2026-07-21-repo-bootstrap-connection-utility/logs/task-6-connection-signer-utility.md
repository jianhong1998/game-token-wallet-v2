# Task 6 Log: Connection/signer utility (TDD)

## Task Context

### Plan Section
## Task 6: Connection/signer utility (TDD)

**Files:**
- Create: `apps/frontend/src/server/env.ts`
- Create: `apps/frontend/src/server/env.test.ts`
- Create: `apps/frontend/src/server/connection.ts`
- Create: `apps/frontend/src/server/connection.test.ts`

**Interfaces:**
- Produces: `loadSolanaEnv(): SolanaEnv` and `getSolanaContext(): Promise<SolanaContext>` where `SolanaContext = { rpc, adminSigner, programAddress }`. Task 7's Server Action is the only other file allowed to import from `connection.ts`.

- [ ] **Step 1: Write the failing env tests**

`apps/frontend/src/server/env.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { loadSolanaEnv } from "./env";

const REQUIRED_VARS = ["SOLANA_CLUSTER", "SOLANA_RPC_URL", "PROGRAM_ID", "SYSTEM_ADMIN_SECRET_KEY"];

function setValidEnv() {
  process.env.SOLANA_CLUSTER = "localnet";
  process.env.SOLANA_RPC_URL = "http://127.0.0.1:8899";
  process.env.PROGRAM_ID = "11111111111111111111111111111111111111111";
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
      programId: "11111111111111111111111111111111111111111",
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter frontend exec vitest run src/server/env.test.ts`
Expected: FAIL — `Cannot find module './env'`.

- [ ] **Step 3: Implement env.ts**

`apps/frontend/src/server/env.ts`:
```typescript
export type SolanaCluster = "localnet" | "devnet" | "mainnet-beta";

export interface SolanaEnv {
  cluster: SolanaCluster;
  rpcUrl: string;
  programId: string;
  adminSecretKeyBase58: string;
}

const CLUSTERS: readonly SolanaCluster[] = ["localnet", "devnet", "mainnet-beta"];

function readRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadSolanaEnv(): SolanaEnv {
  const cluster = readRequiredEnvVar("SOLANA_CLUSTER");
  if (!CLUSTERS.includes(cluster as SolanaCluster)) {
    throw new Error(
      `Invalid SOLANA_CLUSTER "${cluster}": expected one of ${CLUSTERS.join(", ")}`,
    );
  }
  return {
    cluster: cluster as SolanaCluster,
    rpcUrl: readRequiredEnvVar("SOLANA_RPC_URL"),
    programId: readRequiredEnvVar("PROGRAM_ID"),
    adminSecretKeyBase58: readRequiredEnvVar("SYSTEM_ADMIN_SECRET_KEY"),
  };
}
```

- [ ] **Step 4: Run the env tests again**

Run: `pnpm --filter frontend exec vitest run src/server/env.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add bs58 dependency**

Run: `pnpm add bs58 --filter frontend`
Expected: adds `bs58` to `apps/frontend/package.json` dependencies (already listed in Task 5's manifest — this step syncs the lockfile if it wasn't installed yet).

- [ ] **Step 6: Write the failing connection tests**

`apps/frontend/src/server/connection.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

function setValidEnv() {
  process.env.SOLANA_CLUSTER = "localnet";
  process.env.SOLANA_RPC_URL = "http://127.0.0.1:8899";
  process.env.PROGRAM_ID = "11111111111111111111111111111111111111111";
  process.env.SYSTEM_ADMIN_SECRET_KEY =
    "PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis";
}

function clearEnv() {
  delete process.env.SOLANA_CLUSTER;
  delete process.env.SOLANA_RPC_URL;
  delete process.env.PROGRAM_ID;
  delete process.env.SYSTEM_ADMIN_SECRET_KEY;
}

describe("getSolanaContext", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
  });

  it("returns the same context instance on repeated calls", async () => {
    setValidEnv();
    const { getSolanaContext } = await import("./connection");
    const first = await getSolanaContext();
    const second = await getSolanaContext();
    expect(second).toBe(first);
  });

  it("rejects when SYSTEM_ADMIN_SECRET_KEY does not decode to 64 bytes", async () => {
    setValidEnv();
    process.env.SYSTEM_ADMIN_SECRET_KEY = "4g78KBwb1F7uAmFYDPKQDjXt9TcoUThChSVDBtCkXxfA";
    const { getSolanaContext } = await import("./connection");
    await expect(getSolanaContext()).rejects.toThrow(/Invalid SYSTEM_ADMIN_SECRET_KEY/);
  });

  it("rejects when a required env var is missing", async () => {
    setValidEnv();
    delete process.env.PROGRAM_ID;
    const { getSolanaContext } = await import("./connection");
    await expect(getSolanaContext()).rejects.toThrow(
      /Missing required environment variable: PROGRAM_ID/,
    );
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `pnpm --filter frontend exec vitest run src/server/connection.test.ts`
Expected: FAIL — `Cannot find module './connection'`.

- [ ] **Step 8: Implement connection.ts**

`apps/frontend/src/server/connection.ts`:
```typescript
import {
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  address,
  type Address,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import bs58 from "bs58";
import { loadSolanaEnv } from "./env";

export interface SolanaContext {
  rpc: Rpc<SolanaRpcApi>;
  adminSigner: KeyPairSigner;
  programAddress: Address;
}

let contextPromise: Promise<SolanaContext> | null = null;

async function createContext(): Promise<SolanaContext> {
  const env = loadSolanaEnv();

  const secretKeyBytes = bs58.decode(env.adminSecretKeyBase58);
  if (secretKeyBytes.length !== 64) {
    throw new Error(
      `Invalid SYSTEM_ADMIN_SECRET_KEY: decoded to ${secretKeyBytes.length} bytes, expected 64`,
    );
  }

  const adminSigner = await createKeyPairSignerFromBytes(secretKeyBytes);

  return {
    rpc: createSolanaRpc(env.rpcUrl),
    adminSigner,
    programAddress: address(env.programId),
  };
}

export function getSolanaContext(): Promise<SolanaContext> {
  if (!contextPromise) {
    contextPromise = createContext();
  }
  return contextPromise;
}
```

- [ ] **Step 9: Run the connection tests again**

Run: `pnpm --filter frontend exec vitest run src/server/connection.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 10: Run the full frontend suite**

Run: `pnpm --filter frontend run test`
Expected: PASS, 6 tests total (3 env + 3 connection).

- [ ] **Step 11: Commit**

```bash
git add apps/frontend/src/server apps/frontend/package.json pnpm-lock.yaml
git commit -m "feat: add lazy-singleton connection/signer utility"
```

### Acceptance Criteria
- AC-1: `loadSolanaEnv()` returns parsed config `{ cluster, rpcUrl, programId, adminSecretKeyBase58 }` when all four required env vars are set.
- AC-2: `loadSolanaEnv()` throws `Missing required environment variable: <NAME>` when a required var is missing.
- AC-3: `loadSolanaEnv()` throws matching `/Invalid SOLANA_CLUSTER/` when `SOLANA_CLUSTER` is not one of `localnet | devnet | mainnet-beta`.
- AC-4: `getSolanaContext()` returns the identical (same-reference) `SolanaContext` instance on repeated calls (lazy singleton).
- AC-5: `getSolanaContext()` rejects matching `/Invalid SYSTEM_ADMIN_SECRET_KEY/` when the base58 secret key does not decode to exactly 64 bytes.
- AC-6: `getSolanaContext()` rejects matching `/Missing required environment variable: PROGRAM_ID/` when a required env var is missing.

### Interfaces (for downstream Task 7)
- `loadSolanaEnv(): SolanaEnv` — exported from `apps/frontend/src/server/env.ts`. `SolanaEnv = { cluster: "localnet" | "devnet" | "mainnet-beta", rpcUrl: string, programId: string, adminSecretKeyBase58: string }`. Throws synchronously on missing/malformed env vars — no silent fallback.
- `getSolanaContext(): Promise<SolanaContext>` — exported from `apps/frontend/src/server/connection.ts`. `SolanaContext = { rpc: Rpc<SolanaRpcApi>, adminSigner: KeyPairSigner, programAddress: Address }`. Lazy singleton: constructed once on first call via a memoized module-level `contextPromise`, same instance returned on every subsequent call for the process lifetime. Rejects (not throws, since it's async) if env is missing/malformed or `SYSTEM_ADMIN_SECRET_KEY` doesn't decode to 64 bytes.
- Per plan's Global Constraints: nothing outside `apps/frontend/src/server/connection.ts` may construct an RPC client or signer directly. Per this task's Interfaces line: **Task 7's Server Action is the only other file allowed to import from `connection.ts`.**

---

## Attempt 1 — 2026-07-21T11:27:46Z

### Implementation Plan
- Write failing `env.test.ts` (3 tests: happy path, missing var, invalid cluster), run to confirm RED (`Cannot find module './env'`)
- Implement `env.ts` per plan literal contents, rerun to confirm GREEN (3 tests)
- Add `bs58` dependency (already present in Task 5's manifest/lockfile — no-op sync)
- Write failing `connection.test.ts` (3 tests: singleton identity, malformed secret key, missing env var), run to confirm RED (`Cannot find module './connection'`)
- Implement `connection.ts` per plan literal contents, rerun — hit one unpredicted failure (see Key Decisions), fix test fixture, confirm GREEN (3 tests)
- Run full frontend suite (`pnpm --filter frontend run test`) to confirm PASS 6 total; run lint + typecheck; commit

### Files Changed
- created `apps/frontend/src/server/env.test.ts` — failing-then-passing tests for `loadSolanaEnv`
- created `apps/frontend/src/server/env.ts` — `loadSolanaEnv()` implementation, verbatim from plan
- created `apps/frontend/src/server/connection.test.ts` — failing-then-passing tests for `getSolanaContext`, PROGRAM_ID fixture corrected (see Key Decisions)
- created `apps/frontend/src/server/connection.ts` — `getSolanaContext()` lazy-singleton implementation, verbatim from plan

### New Tests
- `loadSolanaEnv > returns parsed config when all vars are set`
- `loadSolanaEnv > throws when a required var is missing`
- `loadSolanaEnv > throws when SOLANA_CLUSTER is not a recognized value`
- `getSolanaContext > returns the same context instance on repeated calls`
- `getSolanaContext > rejects when SYSTEM_ADMIN_SECRET_KEY does not decode to 64 bytes`
- `getSolanaContext > rejects when a required env var is missing`

### Key Decisions
- The plan's literal `PROGRAM_ID` test fixture value `"11111111111111111111111111111111111111111"` is 41 characters, decoding to 41 bytes — not a valid 32-byte pubkey. `env.test.ts`'s `toEqual` assertion doesn't decode/validate the string so it passed unnoticed with the 41-char literal on the first run. `connection.test.ts`'s happy-path test does exercise real decoding (`createContext()` calls `@solana/kit`'s `address()`, which validates 32-byte length) and failed with `SolanaError: Expected base58 encoded address to decode to a byte array of length 32. Actual length: 41.` — this is a bug in the plan's test-fixture prose, not in the implementation under test (`env.ts`/`connection.ts` match the plan verbatim and are correct). Fixed by replacing the fixture literal with the real 32-character System Program address (`"1".repeat(32)` = `"11111111111111111111111111111111"`) in both `env.test.ts` and `connection.test.ts` for consistency, since both conceptually represent the same placeholder `PROGRAM_ID`. Verified via node + the installed `bs58` package that 32 `'1'` characters decodes to exactly 32 zero bytes, confirming the corrected literal is valid.
- No other deviations — `env.ts` and `connection.ts` implementations are verbatim from the plan.

### Lint Output
PASS
(`pnpm --filter frontend run lint` → `eslint .` exits 0, no output)

### Test Output
PASS (6 passed, 6 new)
(`pnpm --filter frontend run test` → 2 test files, 6 tests, all passed)

### Typecheck Output
PASS
(`pnpm --filter frontend run typecheck` → `tsc --noEmit` exits 0, no output)

### Commit
`9e075d5`

### Outcome: success

---

## Task Summary

- RED confirmed genuinely for both `env.test.ts` (`Cannot find module './env'`) and `connection.test.ts` (`Cannot find module './connection'`, all 3 tests) before any implementation code was written.
- GREEN confirmed for `env.ts` (3/3) immediately after implementation.
- GREEN for `connection.ts` required one test-fixture correction (invalid-length `PROGRAM_ID` literal inherited from the plan's prose, not an implementation bug) — see Key Decisions above. After the fix, 3/3 passed.
- Final full suite: PASS 6/6 (`pnpm --filter frontend run test`).
- Lint and typecheck both pass clean.
- Committed as `9e075d5`: "feat: add lazy-singleton connection/signer utility" — 4 files changed (`env.ts`, `env.test.ts`, `connection.ts`, `connection.test.ts`), 168 insertions. `apps/frontend/package.json` and `pnpm-lock.yaml` had no diff (bs58 was already present from Task 5), so `git add` on those paths was a no-op, consistent with the plan's Step 5 note.
- No blockers. Task complete within 1 attempt (the fixture fix was applied inline within the same attempt, not counted as a separate failed attempt per the "3 attempts" budget since the implementation code was correct on first try).

