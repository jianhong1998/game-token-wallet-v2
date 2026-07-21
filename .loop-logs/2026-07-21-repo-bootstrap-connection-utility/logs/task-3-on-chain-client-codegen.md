# Task 3 Log: `packages/on-chain-client` — Codama codegen

## Task Context

### Plan Section

## Task 3: `packages/on-chain-client` — Codama codegen

**Files:**
- Create: `packages/on-chain-client/package.json`
- Create: `packages/on-chain-client/scripts/generate-client.mjs`
- Create: `packages/on-chain-client/src/index.ts`
- Create: `packages/on-chain-client/src/generated/` (codegen output, committed)
- Create: `packages/on-chain-client/src/index.test.ts`
- Create: `packages/on-chain-client/tsconfig.json`

**Interfaces:**
- Consumes: `apps/on-chain-program/target/idl/game_token_wallet.json` (Task 2, Step 8).
- Produces: `getNoopInstruction(input?, config?)` and a program-address constant, both re-exported from `on-chain-client`'s package root. **Exact export names are whatever Codama's `@codama/renderers-js` emits for an instruction named `noop` in a program named `game_token_wallet` — confirm them by reading `src/generated/instructions/noop.ts` and `src/generated/programs/gameTokenWallet.ts` after Step 4 below, before writing Step 5's test.** (Codama's JS renderer camelCases IDL names, so `getNoopInstruction` and a `GAME_TOKEN_WALLET_PROGRAM_ADDRESS`-style constant are the expected shape, but treat the generated files as the source of truth.)

- [ ] **Step 1: Create the package manifest**

`packages/on-chain-client/package.json`:
```json
{
  "name": "on-chain-client",
  "private": true,
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "codegen": "node scripts/generate-client.mjs",
    "test": "vitest run"
  },
  "dependencies": {
    "@solana/kit": "^5.5.1"
  },
  "devDependencies": {
    "codama": "^1.0.0",
    "@codama/nodes-from-anchor": "^1.0.0",
    "@codama/renderers-js": "^1.0.0",
    "vitest": "^3.0.0",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Create the tsconfig**

`packages/on-chain-client/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the codegen script**

`packages/on-chain-client/scripts/generate-client.mjs`:
```javascript
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { createFromRoot } from "codama";
import renderVisitor from "@codama/renderers-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const idlPath = join(
  __dirname,
  "..",
  "..",
  "on-chain-program",
  "target",
  "idl",
  "game_token_wallet.json",
);

const anchorIdl = JSON.parse(readFileSync(idlPath, "utf-8"));
const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));
codama.accept(renderVisitor(join(__dirname, "..", "src", "generated")));

console.log(`Generated on-chain-client from ${idlPath}`);
```

- [ ] **Step 4: Install deps and run codegen**

Run (from repo root):
```bash
pnpm add @solana/kit --filter on-chain-client
pnpm add -D codama @codama/nodes-from-anchor @codama/renderers-js vitest typescript --filter on-chain-client
pnpm --filter on-chain-client run codegen
```
Expected: `packages/on-chain-client/src/generated/` is created with `instructions/`, `programs/`, and an `index.ts` barrel file.

Read `packages/on-chain-client/src/generated/instructions/noop.ts` and `packages/on-chain-client/src/generated/programs/*.ts` now and note the exact exported instruction-builder function name and program-address constant name — you'll need them verbatim in Step 5 and in Tasks 4 and 7.

- [ ] **Step 5: Create the barrel export**

`packages/on-chain-client/src/index.ts`:
```typescript
export * from "./generated";
```

- [ ] **Step 6: Write the smoke test using the real generated export names from Step 4**

`packages/on-chain-client/src/index.test.ts` (replace `getNoopInstruction` / `GAME_TOKEN_WALLET_PROGRAM_ADDRESS` below with whatever Step 4 showed you if they differ):
```typescript
import { describe, it, expect } from "vitest";
import { getNoopInstruction, GAME_TOKEN_WALLET_PROGRAM_ADDRESS } from "./index";

describe("generated on-chain-client", () => {
  it("exports a noop instruction builder", () => {
    expect(typeof getNoopInstruction).toBe("function");
  });

  it("exports the program address as a non-empty string", () => {
    expect(typeof GAME_TOKEN_WALLET_PROGRAM_ADDRESS).toBe("string");
    expect(GAME_TOKEN_WALLET_PROGRAM_ADDRESS.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 7: Run the test**

Run: `pnpm --filter on-chain-client run test`
Expected: PASS, 2 tests.

- [ ] **Step 8: Commit (including the generated client — see Global Constraints)**

```bash
git add packages/on-chain-client
git commit -m "feat: wire Codama codegen for on-chain-client, generate noop client"
```

### Interfaces (verbatim from plan)
- Consumes: `apps/on-chain-program/target/idl/game_token_wallet.json` (Task 2, Step 8).
- Produces: `getNoopInstruction(input?, config?)` and a program-address constant, both re-exported from `on-chain-client`'s package root. **Exact export names are whatever Codama's `@codama/renderers-js` emits for an instruction named `noop` in a program named `game_token_wallet` — confirm them by reading `src/generated/instructions/noop.ts` and `src/generated/programs/gameTokenWallet.ts` after Step 4 below, before writing Step 5's test.** (Codama's JS renderer camelCases IDL names, so `getNoopInstruction` and a `GAME_TOKEN_WALLET_PROGRAM_ADDRESS`-style constant are the expected shape, but treat the generated files as the source of truth.)

### Acceptance Criteria
- AC-1: `packages/on-chain-client/src/generated/` is produced by running Codama codegen against `apps/on-chain-program/target/idl/game_token_wallet.json`, containing `instructions/`, `programs/`, and a barrel `index.ts`.
- AC-2: `on-chain-client` package root re-exports a `noop` instruction-builder function and a program-address constant, using the exact names Codama actually generated (verified by reading the generated files, not assumed).
- AC-3: `pnpm --filter on-chain-client run test` PASSes with 2 tests (instruction builder is a function; program address constant is a non-empty string).
- AC-4: The generated `src/generated/` directory is committed to git (not gitignored), per Global Constraints.

---

## Attempt 1 — 2026-07-21T11:09:19Z

### Implementation Plan
- Create package.json, tsconfig.json, scripts/generate-client.mjs per plan Steps 1-3
- Install deps (@solana/kit, codama, @codama/nodes-from-anchor, @codama/renderers-js, vitest, typescript) and run codegen (Step 4)
- Read generated files to confirm real export names before writing the smoke test (Step 4 instruction)
- Create barrel export src/index.ts and smoke test src/index.test.ts (Steps 5-6)
- Run test, expect PASS 2 tests (Step 7), then commit including src/generated/ (Step 8)

### Files Changed
- created `packages/on-chain-client/package.json` — package manifest with codegen/test scripts and deps
- created `packages/on-chain-client/tsconfig.json` — extends root base tsconfig
- created `packages/on-chain-client/scripts/generate-client.mjs` — Codama codegen script (path fixed, see Key Decisions)
- created `packages/on-chain-client/src/generated/index.ts` — Codama-generated barrel (committed)
- created `packages/on-chain-client/src/generated/instructions/index.ts` — Codama-generated
- created `packages/on-chain-client/src/generated/instructions/noop.ts` — Codama-generated `getNoopInstruction`, `NOOP_DISCRIMINATOR`, etc.
- created `packages/on-chain-client/src/generated/programs/gameTokenWallet.ts` — Codama-generated `GAME_TOKEN_WALLET_PROGRAM_ADDRESS`, instruction identify/parse helpers
- created `packages/on-chain-client/src/generated/programs/index.ts` — Codama-generated
- created `packages/on-chain-client/src/generated/shared/index.ts` — Codama-generated
- created `packages/on-chain-client/src/index.ts` — barrel export (`export * from "./generated"`)
- created `packages/on-chain-client/src/index.test.ts` — smoke test using real export names
- modified `pnpm-workspace.yaml` — added `allowBuilds: { esbuild: true }` (see Key Decisions)
- modified `pnpm-lock.yaml` — dependency resolution from `pnpm add`

### New Tests
- `generated on-chain-client > exports a noop instruction builder`
- `generated on-chain-client > exports the program address as a non-empty string`

### Key Decisions
- **Fixed a path bug in the plan's literal `generate-client.mjs`**: the plan's script joined `__dirname` (`packages/on-chain-client/scripts`) with `"..", "..", "on-chain-program", ...`, which resolves to `packages/on-chain-program/target/idl/...` — a path that does not exist. The real program lives at `apps/on-chain-program` (per Task 2 and the orchestrator's own instructions). Fixed by adding a third `".."` and inserting `"apps"` before `"on-chain-program"`, so the script now correctly reads `apps/on-chain-program/target/idl/game_token_wallet.json`. Verified by running codegen — it printed the corrected path and succeeded.
- **Added `allowBuilds: { esbuild: true }` to `pnpm-workspace.yaml`**: pnpm 11.15.1 blocks `esbuild`'s postinstall script by default (`ERR_PNPM_IGNORED_BUILDS`), which made every `pnpm install`/`pnpm --filter ... run <script>` invocation fail outright (pnpm auto-runs an install check before filtered scripts). `esbuild` is a transitive dep of vitest/codama tooling; without allowing its build script, `pnpm --filter on-chain-client run codegen` and `run test` could not execute at all. This is an environment-level fix, not called out in the plan, but required to unblock every subsequent step.
- Confirmed generated export names exactly match the plan's guessed shape: `getNoopInstruction` (function) and `GAME_TOKEN_WALLET_PROGRAM_ADDRESS` (string constant, value `"BWS4UCkFps4XUs7bqqzgNxFZ3keLUMVbb9CJUpyefNob"`, matching Task 2's synced program ID) — no test rewrite needed beyond the plan's literal Step 6 content.
- Noted (not acted on, out of scope for this task): the real `getNoopInstruction` signature is `getNoopInstruction<TProgramAddress>(config?: { programAddress?: TProgramAddress })` — a single optional `config` argument, not the two-argument `(input?, config?)` shape implied by this task's own Interfaces bullet and used in Task 4/Task 7's plan code (`getNoopInstruction({}, { programAddress: ... })`). This is because `noop` has no accounts/args, so Codama omits the `input` parameter entirely. Flagged to the orchestrator for Tasks 4 and 7.

### Lint Output
n/a — `on-chain-client` package.json defines no `lint` script (matches plan; not required for this task)

### Test Output
PASS (2 passed, 2 new)

### Commit
`2cc8761`

### Outcome: success
