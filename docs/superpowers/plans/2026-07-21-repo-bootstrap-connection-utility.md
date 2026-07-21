# Repo Bootstrap & Connection Utility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the V2 repo with a working local dev loop and a system-admin-wallet connection utility that every later ticket builds on, per [ticket 001](../../tickets/001-repo-bootstrap-connection-utility.md) and the approved [design](../specs/2026-07-21-repo-bootstrap-connection-utility-design.md).

**Architecture:** pnpm workspace containing an Anchor 1.x program (`game_token_wallet`, one `noop` instruction), a Codama-generated `@solana/kit`-based TS client, a Next.js/Tailwind frontend whose only chain access goes through one lazy-singleton connection utility, and two minimal-but-real test apps (`on-chain-program-e2e`, `e2e`). `docker compose up` is the single local-dev entry point: Surfpool validator → program deploy + codegen → frontend boot. CircleCI runs six real jobs on every PR.

**Tech Stack:** Next.js 16.2.10 (App Router) + Tailwind CSS v4 + TypeScript, `@solana/kit` ^5.5.1, Anchor 1.x (via AVM) + Rust, Codama (`@codama/nodes-from-anchor` + `@codama/renderers-js`), vitest, Playwright, pnpm 11.15.1, Node 24.18.0, Surfpool (`surfpool/surfpool` Docker image).

## Global Constraints

- Node `24.18.0`, pnpm `11.15.1` (via corepack) — pin exactly, don't drift to a different major.
- Anchor 1.x (latest via `avm install latest && avm use latest`), not 0.30.x.
- Program crate name: `game_token_wallet`. Sole instruction for this ticket: `noop` (no accounts, no args).
- Env vars for the connection utility, exact names: `SOLANA_CLUSTER` (`localnet | devnet | mainnet-beta`), `SOLANA_RPC_URL` (always explicit, required), `PROGRAM_ID` (base58 pubkey), `SYSTEM_ADMIN_SECRET_KEY` (base58-encoded 64-byte secret key). All required, no silent fallback — missing/malformed → throw.
- Nothing outside `apps/frontend/src/server/connection.ts` may construct an RPC client or signer directly.
- `packages/on-chain-client/src/generated/` **is committed to git** (regenerated via `pnpm codegen`, not gitignored) — this sidesteps Docker build-ordering problems between the program-deploy step and the frontend image build. Regenerate it after any change to the Anchor program's instructions/accounts.
- No `NEXT_PUBLIC_*` env vars — there is no client-side chain access at all (custodial model), so nothing Solana-related is ever build-time-baked.
- Throwaway local-dev keypair used throughout this plan (docker-compose defaults, do not reuse anywhere real): `SYSTEM_ADMIN_SECRET_KEY=PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis`.
- **Deviation from spec, flagged for the user:** the spec's §8 called for "a trivial Rust unit test" for `noop`. `noop` has zero pure logic (`Ok(())`), so a contrived `Context<Noop>` unit test would be fake-for-the-sake-of-a-checkbox. This plan instead treats "`anchor build` succeeds and `cargo test` exits 0 (0 tests)" as Task 2's test cycle, and gets `noop`'s real coverage from Task 4's on-chain integration test and Task 8's e2e test — both of which actually invoke it on a live validator.

---

## Task 1: Root workspace scaffold

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Modify: `Justfile`

**Interfaces:**
- Produces: root `pnpm` scripts `lint`, `typecheck`, `test`, `build` — each fans out to every workspace package via `pnpm -r --if-present run <script>`. Later tasks rely on these names existing verbatim.

- [ ] **Step 1: Create the pnpm workspace manifest**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create the root package.json**

`package.json`:
```json
{
  "name": "game-token-wallet-v2",
  "private": true,
  "packageManager": "pnpm@11.15.1",
  "engines": {
    "node": ">=24.18.0"
  },
  "scripts": {
    "lint": "pnpm -r --if-present run lint",
    "typecheck": "pnpm -r --if-present run typecheck",
    "test": "pnpm -r --if-present run test",
    "build": "pnpm -r --if-present run build",
    "codegen": "pnpm --filter on-chain-program run build && pnpm --filter on-chain-client run codegen"
  },
  "devDependencies": {
    "eslint": "^9.19.0",
    "prettier": "^3.4.2",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 3: Create the shared base tsconfig**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 4: Create the root ESLint flat config**

`eslint.config.mjs`:
```javascript
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/.next/**", "**/target/**", "**/generated/**"],
  },
);
```

- [ ] **Step 5: Install the ESLint config's own dependencies**

Run: `pnpm add -D -w @eslint/js typescript-eslint`
Expected: adds both packages to root `devDependencies` and creates `pnpm-lock.yaml`.

- [ ] **Step 6: Create Prettier config**

`.prettierrc.json`:
```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 7: Create root .gitignore**

`.gitignore`:
```
node_modules/
.next/
dist/
target/
!apps/on-chain-program/target/idl/
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 8: Extend the Justfile with lint/typecheck targets**

Modify `Justfile` — add after the existing `init`/`help` recipes:
```
[group: 'CI']
lint:
  @pnpm lint

[group: 'CI']
typecheck:
  @pnpm typecheck
```

- [ ] **Step 9: Verify the workspace installs cleanly**

Run: `pnpm install`
Expected: exits 0, creates `node_modules/` and `pnpm-lock.yaml`, no workspace packages to link yet (none created before Task 2).

- [ ] **Step 10: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json .gitignore Justfile
git commit -m "chore: bootstrap pnpm workspace scaffold"
```

---

## Task 2: Anchor program skeleton (`game_token_wallet` + `noop`)

**Files:**
- Create: `apps/on-chain-program/Anchor.toml`
- Create: `apps/on-chain-program/Cargo.toml`
- Create: `apps/on-chain-program/package.json`
- Create: `apps/on-chain-program/.env.template`
- Create: `apps/on-chain-program/programs/game_token_wallet/Cargo.toml`
- Create: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`

**Interfaces:**
- Produces: on-chain instruction `noop` (no accounts, no args), program crate `game_token_wallet`. Built IDL lands at `apps/on-chain-program/target/idl/game_token_wallet.json` — Task 3 consumes this path directly.

- [ ] **Step 1: Install Anchor 1.x via AVM**

Run:
```bash
cargo install --git https://github.com/solana-foundation/anchor avm --force
avm install latest
avm use latest
anchor --version
```
Expected: prints `anchor-cli 1.x.x`.

- [ ] **Step 2: Create the Cargo workspace manifest**

`apps/on-chain-program/Cargo.toml`:
```toml
[workspace]
members = ["programs/*"]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
```

- [ ] **Step 3: Create the program crate's Cargo.toml**

`apps/on-chain-program/programs/game_token_wallet/Cargo.toml`:
```toml
[package]
name = "game_token_wallet"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "game_token_wallet"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build"]

[dependencies]
anchor-lang = "1"
```

- [ ] **Step 4: Write the `noop` instruction**

`apps/on-chain-program/programs/game_token_wallet/src/lib.rs`:
```rust
use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111111111111");

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

- [ ] **Step 5: Create Anchor.toml**

`apps/on-chain-program/Anchor.toml`:
```toml
[toolchain]

[features]
resolution = true
skip-lint = false

[programs.localnet]
game_token_wallet = "11111111111111111111111111111111111111111"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "pnpm --filter on-chain-program-e2e run test"
```

- [ ] **Step 6: Create the program's own package.json (per `001-CODEBASE-STRUCTURE.md`)**

`apps/on-chain-program/package.json`:
```json
{
  "name": "on-chain-program",
  "private": true,
  "scripts": {
    "build": "anchor build"
  }
}
```

- [ ] **Step 7: Create the program's env template**

`apps/on-chain-program/.env.template`:
```
# Used by `anchor deploy` / local tooling only — Solana programs cannot read
# process env vars on-chain, so this is not consumed by the program itself.
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
ANCHOR_WALLET=~/.config/solana/id.json
```

- [ ] **Step 8: Build and sync the real program ID**

Run:
```bash
cd apps/on-chain-program
anchor build
anchor keys sync
anchor build
```
Expected: first `anchor build` succeeds and writes `target/idl/game_token_wallet.json` and `target/deploy/game_token_wallet-keypair.json`. `anchor keys sync` rewrites the placeholder `declare_id!` in `lib.rs` and the `[programs.localnet]` entry in `Anchor.toml` to the real generated program address. The second `anchor build` picks up the synced ID.

Record the resulting program address (from `anchor keys list`) — Tasks 6, 9, and 10 need it as the local-dev `PROGRAM_ID` value.

- [ ] **Step 9: Run `cargo test`**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml`
Expected: exits 0 (0 tests — see "Deviation from spec" in Global Constraints).

- [ ] **Step 10: Commit**

```bash
git add apps/on-chain-program
git commit -m "feat: add Anchor program skeleton with noop instruction"
```

---

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

---

## Task 4: `apps/on-chain-program-e2e` skeleton — real `noop` round trip

**Files:**
- Create: `apps/on-chain-program-e2e/package.json`
- Create: `apps/on-chain-program-e2e/tsconfig.json`
- Create: `apps/on-chain-program-e2e/tests/noop.test.ts`

**Interfaces:**
- Consumes: `on-chain-client`'s `getNoopInstruction` / program-address constant (Task 3, exact names confirmed there).
- Produces: nothing later tasks import — this is a leaf test app. Invoked by `apps/on-chain-program/Anchor.toml`'s `[scripts] test` (Task 2, Step 5) via `anchor test`.

- [ ] **Step 1: Create the package manifest**

`apps/on-chain-program-e2e/package.json`:
```json
{
  "name": "on-chain-program-e2e",
  "private": true,
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@solana/kit": "^5.5.1",
    "on-chain-client": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Create the tsconfig**

`apps/on-chain-program-e2e/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["tests"]
}
```

- [ ] **Step 3: Install deps**

Run: `pnpm install`
Expected: links `on-chain-client` as a workspace dependency.

- [ ] **Step 4: Write the round-trip test**

`apps/on-chain-program-e2e/tests/noop.test.ts` (use the exact export names you confirmed in Task 3, Step 4):
```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  airdropFactory,
  getSignatureFromTransaction,
  lamports,
} from "@solana/kit";
import { getNoopInstruction, GAME_TOKEN_WALLET_PROGRAM_ADDRESS } from "on-chain-client";

const RPC_URL = "http://127.0.0.1:8899";
const RPC_WS_URL = "ws://127.0.0.1:8900";

describe("noop instruction round trip", () => {
  it("confirms on the local validator through the generated on-chain-client", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);

    const keypairPath = join(homedir(), ".config", "solana", "id.json");
    const secretKeyBytes = new Uint8Array(JSON.parse(readFileSync(keypairPath, "utf-8")));
    const payer = await createKeyPairSignerFromBytes(secretKeyBytes);

    const airdrop = airdropFactory({ rpc, rpcSubscriptions });
    await airdrop({
      commitment: "confirmed",
      recipientAddress: payer.address,
      lamports: lamports(1_000_000_000n),
    });

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const noopInstruction = getNoopInstruction(
      {},
      { programAddress: GAME_TOKEN_WALLET_PROGRAM_ADDRESS },
    );

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([noopInstruction], tx),
    );

    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    await expect(
      sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" }),
    ).resolves.not.toThrow();

    expect(getSignatureFromTransaction(signedTransaction)).toMatch(
      /^[1-9A-HJ-NP-Za-km-z]{64,88}$/,
    );
  }, 30_000);
});
```

- [ ] **Step 5: Run it through Anchor**

Run: `cd apps/on-chain-program && anchor test`
Expected: Anchor builds the program, deploys it to a local Surfpool validator it spins up, runs `pnpm --filter on-chain-program-e2e run test`, and the test PASSes.

- [ ] **Step 6: Commit**

```bash
git add apps/on-chain-program-e2e
git commit -m "test: add on-chain-program-e2e skeleton with noop round-trip test"
```

---

## Task 5: `apps/frontend` scaffold (Next.js + Tailwind)

**Files:**
- Create: `apps/frontend/package.json`
- Create: `apps/frontend/tsconfig.json`
- Create: `apps/frontend/next.config.ts`
- Create: `apps/frontend/postcss.config.mjs`
- Create: `apps/frontend/vitest.config.ts`
- Create: `apps/frontend/.env.template`
- Create: `apps/frontend/src/app/layout.tsx`
- Create: `apps/frontend/src/app/globals.css`
- Create: `apps/frontend/src/app/page.tsx` (placeholder, replaced in Task 7)
- Modify: `docs/technical-related/architecture/003-TECH-STACK.md`

**Interfaces:**
- Produces: `pnpm --filter frontend run dev|build|test` — Task 6, 7 add files under this app; Task 9/10 build this app inside Docker images.

- [ ] **Step 1: Create the package manifest**

`apps/frontend/package.json`:
```json
{
  "name": "frontend",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "16.2.10",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "@solana/kit": "^5.5.1",
    "bs58": "^6.0.0",
    "on-chain-client": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "@types/node": "^22.10.5",
    "@types/react": "^19.0.7",
    "@types/react-dom": "^19.0.3",
    "vitest": "^3.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "eslint": "^9.19.0",
    "eslint-config-next": "16.2.10"
  }
}
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: exits 0.

- [ ] **Step 3: Create the tsconfig**

`apps/frontend/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create next.config.ts**

`apps/frontend/next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["on-chain-client"],
};

export default nextConfig;
```

- [ ] **Step 5: Create the Tailwind v4 PostCSS config**

`apps/frontend/postcss.config.mjs`:
```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 6: Create globals.css with the mobile-first container theme**

`apps/frontend/src/app/globals.css`:
```css
@import "tailwindcss";

@theme {
  --breakpoint-sm: 30rem;
  --width-app-max: 28rem;
}

.app-shell {
  max-width: var(--width-app-max);
  margin-inline: auto;
}
```

- [ ] **Step 7: Create the root layout**

`apps/frontend/src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Game Token Wallet",
  description: "Tokenize offline group games as on-chain SPL tokens.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="app-shell min-h-screen px-4">{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Create a placeholder home page**

`apps/frontend/src/app/page.tsx` (replaced with the real proof-of-plumbing UI in Task 7):
```tsx
export default function HomePage() {
  return <main className="py-8">Game Token Wallet</main>;
}
```

- [ ] **Step 9: Create the vitest config**

`apps/frontend/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 10: Create the frontend env template**

`apps/frontend/.env.template`:
```
# Cluster this app talks to: localnet | devnet | mainnet-beta
SOLANA_CLUSTER=localnet

# Explicit RPC endpoint — always required, never inferred from SOLANA_CLUSTER.
SOLANA_RPC_URL=http://127.0.0.1:8899

# Base58 pubkey of the deployed game_token_wallet program.
PROGRAM_ID=

# Base58-encoded 64-byte secret key for the system admin wallet.
# NEVER commit a real value here — this signs every on-chain transaction.
SYSTEM_ADMIN_SECRET_KEY=
```

- [ ] **Step 11: Verify the app builds**

Run: `pnpm --filter frontend run build`
Expected: Next.js build succeeds (it will fail if `PROGRAM_ID`/`SYSTEM_ADMIN_SECRET_KEY` are read at *module scope* anywhere reachable from a page — Task 6/7 must only read them lazily inside the singleton accessor, never at import time, or this build step breaks).

- [ ] **Step 12: Record the Tailwind decision in the tech-stack doc**

Modify `docs/technical-related/architecture/003-TECH-STACK.md` — in the "Client — Next.js App" table, change the `Design` row's neighboring context by adding a new row:

```diff
 | Server state        | TanStack React Query                                           |
 | Client/shared state | React Context                                                  |
+| Styling             | Tailwind CSS v4                                                |
 | Design              | Mobile-first; desktop capped to mobile width with side margins |
```

- [ ] **Step 13: Commit**

```bash
git add apps/frontend docs/technical-related/architecture/003-TECH-STACK.md
git commit -m "feat: scaffold Next.js frontend with Tailwind CSS v4"
```

---

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

---

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

## Task 8: `apps/e2e` skeleton — Playwright `noop` round trip

**Files:**
- Create: `apps/e2e/package.json`
- Create: `apps/e2e/playwright.config.ts`
- Create: `apps/e2e/tests/noop.spec.ts`

**Interfaces:**
- Consumes: the running frontend's `/` page from Task 7 (via HTTP, not import — no code dependency).
- Produces: nothing later tasks import directly; Task 9 (`docker compose up`) and Task 10 (CI) are how this suite actually runs against a live stack.

- [ ] **Step 1: Create the package manifest**

`apps/e2e/package.json`:
```json
{
  "name": "e2e",
  "private": true,
  "scripts": {
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0"
  }
}
```

- [ ] **Step 2: Install and download browsers**

Run:
```bash
pnpm add -D @playwright/test --filter e2e
pnpm --filter e2e exec playwright install --with-deps chromium
```

- [ ] **Step 3: Create the Playwright config**

`apps/e2e/playwright.config.ts`:
```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  },
});
```

- [ ] **Step 4: Write the round-trip test**

`apps/e2e/tests/noop.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";

test("home page proves the connection utility plumbing works end-to-end", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Send noop transaction" }).click();
  await expect(page.getByTestId("noop-signature")).toBeVisible({ timeout: 30_000 });

  const signature = await page.getByTestId("noop-signature").textContent();
  expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
});
```

- [ ] **Step 5: Note — this test cannot pass in isolation yet**

There is no running frontend + deployed program for it to hit. Task 9 stands up that stack locally; run `pnpm --filter e2e run test` again after Task 9 to get a real PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e
git commit -m "test: add e2e Playwright skeleton with noop round-trip test"
```

---

## Task 9: Local dev loop — `docker-compose.yml`

**Files:**
- Create: `docker/local/Dockerfile.anchor`
- Create: `docker/local/Dockerfile.frontend`
- Create: `docker-compose.yml`
- Modify: `Justfile`

**Interfaces:**
- Produces: `docker compose up` — brings up `surfpool`, `program-deploy` (one-shot), `frontend`. Task 10's `docker-compose.e2e.yml` reuses `docker/local/Dockerfile.anchor` verbatim.

- [ ] **Step 1: Create the Anchor build+deploy+codegen image**

`docker/local/Dockerfile.anchor`:
```dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates build-essential pkg-config libssl-dev git \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
ENV PATH="/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:/root/.avm/bin:${PATH}"

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

RUN solana-keygen new --no-bip39-passphrase --silent --outfile /root/.config/solana/id.json

WORKDIR /workspace

ENTRYPOINT ["sh", "-c"]
CMD ["solana airdrop 10 --url \"$ANCHOR_PROVIDER_URL\" && cd apps/on-chain-program && anchor build && anchor deploy --provider.cluster \"$ANCHOR_PROVIDER_URL\" && cd ../.. && pnpm install --frozen-lockfile && pnpm --filter on-chain-client run codegen"]
```

- [ ] **Step 2: Create the frontend dev image**

`docker/local/Dockerfile.frontend`:
```dockerfile
FROM node:24.18.0-bookworm

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

WORKDIR /workspace

CMD ["sh", "-c", "pnpm install --frozen-lockfile && pnpm --filter frontend run dev"]
```

- [ ] **Step 3: Create docker-compose.yml**

`docker-compose.yml` (`PROGRAM_ID` below must match Task 2 Step 8's synced program address, and `SYSTEM_ADMIN_SECRET_KEY` is the throwaway dev key from Global Constraints):
```yaml
services:
  surfpool:
    image: surfpool/surfpool:latest
    command: ["start", "--no-tui"]
    ports:
      - "8899:8899"
      - "8900:8900"
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "curl -sf -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getHealth\"}' http://localhost:8899 || exit 1",
        ]
      interval: 2s
      timeout: 2s
      retries: 30

  program-deploy:
    build:
      context: .
      dockerfile: docker/local/Dockerfile.anchor
    depends_on:
      surfpool:
        condition: service_healthy
    environment:
      ANCHOR_PROVIDER_URL: http://surfpool:8899
    volumes:
      - .:/workspace

  frontend:
    build:
      context: .
      dockerfile: docker/local/Dockerfile.frontend
    depends_on:
      program-deploy:
        condition: service_completed_successfully
    ports:
      - "3000:3000"
    environment:
      SOLANA_CLUSTER: localnet
      SOLANA_RPC_URL: http://surfpool:8899
      PROGRAM_ID: "<paste the address from Task 2 Step 8's `anchor keys list`>"
      SYSTEM_ADMIN_SECRET_KEY: "PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis"
    volumes:
      - .:/workspace
```

- [ ] **Step 4: Add Justfile dev-up/dev-down targets**

Modify `Justfile` — add:
```
[group: 'Dev']
dev-up:
  @docker compose up --build

[group: 'Dev']
dev-down:
  @docker compose down --volumes
```

- [ ] **Step 5: Bring up the full stack**

Run: `just dev-up`
Expected: `surfpool` becomes healthy, `program-deploy` runs to completion (builds, deploys, codegens, exits 0), `frontend` starts and logs "Ready" on port 3000.

- [ ] **Step 6: Verify the real end-to-end path manually**

With the stack still running, in a second terminal:
```bash
E2E_BASE_URL=http://localhost:3000 pnpm --filter e2e run test
```
Expected: PASS — the Playwright test from Task 8 now has something real to hit.

- [ ] **Step 7: Tear down**

Run: `just dev-down`

- [ ] **Step 8: Commit**

```bash
git add docker/local docker-compose.yml Justfile
git commit -m "feat: add docker-compose local dev loop (surfpool + program deploy + frontend)"
```

---

## Task 10: CI-parity stack — `docker-compose.e2e.yml`

**Files:**
- Create: `docker/deployment/Dockerfile`
- Create: `docker/deployment/.env.template`
- Create: `docker/local/Dockerfile.e2e`
- Create: `docker-compose.e2e.yml`
- Modify: `Justfile`

**Interfaces:**
- Produces: `docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e` — Task 11's CircleCI `e2e` job runs exactly this.

- [ ] **Step 1: Create the production frontend Dockerfile**

`docker/deployment/Dockerfile`:
```dockerfile
FROM node:24.18.0-bookworm AS builder
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY packages/on-chain-client ./packages/on-chain-client
RUN pnpm install --frozen-lockfile
COPY apps/frontend ./apps/frontend
RUN pnpm --filter frontend run build

FROM node:24.18.0-bookworm-slim AS runner
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
WORKDIR /workspace
COPY --from=builder /workspace ./
WORKDIR /workspace/apps/frontend
EXPOSE 3000
CMD ["pnpm", "start"]
```

- [ ] **Step 2: Create the deployment env template**

`docker/deployment/.env.template`:
```
# Runtime config for a self-hosted deployment — read at container start,
# never baked into the image at build time.
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=
PROGRAM_ID=
SYSTEM_ADMIN_SECRET_KEY=
```

- [ ] **Step 3: Create the Playwright runner image**

`docker/local/Dockerfile.e2e`:
```dockerfile
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/e2e/package.json ./apps/e2e/package.json
RUN pnpm install --frozen-lockfile --filter e2e...
COPY apps/e2e ./apps/e2e

WORKDIR /workspace/apps/e2e
CMD ["pnpm", "test"]
```

- [ ] **Step 4: Create docker-compose.e2e.yml**

`docker-compose.e2e.yml` (reuses `docker/local/Dockerfile.anchor` from Task 9 as-is):
```yaml
services:
  surfpool:
    image: surfpool/surfpool:latest
    command: ["start", "--no-tui"]
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "curl -sf -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getHealth\"}' http://localhost:8899 || exit 1",
        ]
      interval: 2s
      timeout: 2s
      retries: 30

  program-deploy:
    build:
      context: .
      dockerfile: docker/local/Dockerfile.anchor
    depends_on:
      surfpool:
        condition: service_healthy
    environment:
      ANCHOR_PROVIDER_URL: http://surfpool:8899
    volumes:
      - .:/workspace

  frontend:
    build:
      context: .
      dockerfile: docker/deployment/Dockerfile
    depends_on:
      program-deploy:
        condition: service_completed_successfully
    environment:
      SOLANA_CLUSTER: localnet
      SOLANA_RPC_URL: http://surfpool:8899
      PROGRAM_ID: "<same value as docker-compose.yml>"
      SYSTEM_ADMIN_SECRET_KEY: "PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis"

  e2e:
    build:
      context: .
      dockerfile: docker/local/Dockerfile.e2e
    depends_on:
      - frontend
    environment:
      E2E_BASE_URL: http://frontend:3000
```

- [ ] **Step 5: Add the Justfile test fan-out target**

Modify `Justfile` — add:
```
[group: 'CI']
test:
  @cargo test --manifest-path apps/on-chain-program/Cargo.toml
  @pnpm --filter frontend run test
  @cd apps/on-chain-program && anchor test
  @docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e
```

- [ ] **Step 6: Run the e2e stack**

Run: `docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e`
Expected: `e2e` service exits 0 with the Playwright test passing against the prod-built frontend image.

- [ ] **Step 7: Tear down**

Run: `docker compose -f docker-compose.e2e.yml down --volumes`

- [ ] **Step 8: Commit**

```bash
git add docker/deployment docker/local/Dockerfile.e2e docker-compose.e2e.yml Justfile
git commit -m "feat: add prod-parity docker-compose.e2e.yml stack for CI"
```

---

## Task 11: CircleCI pipeline

**Files:**
- Create: `.circleci/config.yml`

**Interfaces:**
- Consumes: `pnpm lint`/`pnpm typecheck` (Task 1), `cargo test` (Task 2), `pnpm --filter frontend run test` (Task 6), `anchor test` (Task 4), `docker-compose.e2e.yml` (Task 10).

- [ ] **Step 1: Write the CircleCI config**

`.circleci/config.yml`:
```yaml
version: 2.1

jobs:
  lint:
    docker:
      - image: cimg/node:24.18
    steps:
      - checkout
      - run: corepack enable && corepack prepare pnpm@11.15.1 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  typecheck:
    docker:
      - image: cimg/node:24.18
    steps:
      - checkout
      - run: corepack enable && corepack prepare pnpm@11.15.1 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  web-unit-tests:
    docker:
      - image: cimg/node:24.18
    steps:
      - checkout
      - run: corepack enable && corepack prepare pnpm@11.15.1 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter frontend run test

  cargo-test:
    docker:
      - image: cimg/base:current
    steps:
      - checkout
      - run: curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
      - run:
          command: |
            echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"' >> "$BASH_ENV"
      - run:
          working_directory: apps/on-chain-program
          command: cargo test

  on-chain-program-e2e:
    machine:
      image: ubuntu-2404:current
    steps:
      - checkout
      - run: curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
      - run:
          command: |
            echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"' >> "$BASH_ENV"
      - run: corepack enable && corepack prepare pnpm@11.15.1 --activate
      - run: pnpm install --frozen-lockfile
      - run: solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
      - run:
          working_directory: apps/on-chain-program
          command: anchor test

  e2e:
    machine:
      image: ubuntu-2404:current
    steps:
      - checkout
      - run: docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e

workflows:
  ci:
    jobs:
      - lint
      - typecheck
      - web-unit-tests
      - cargo-test
      - on-chain-program-e2e
      - e2e
```

- [ ] **Step 2: Validate the config syntax**

Run: `circleci config validate` (if the CircleCI CLI is installed locally) or paste into CircleCI's web config editor.
Expected: "Config is valid."
**Blocker to name explicitly if you don't have the CLI or a CircleCI project connected yet:** you cannot observe an actual green pipeline run without pushing to a branch CircleCI is watching — say so rather than claiming CI passes.

- [ ] **Step 3: Commit**

```bash
git add .circleci/config.yml
git commit -m "ci: add CircleCI pipeline (lint, typecheck, cargo test, e2e suites)"
```

---

## Task 12: Wrap-up — tick ticket checklist, full local verification

**Files:**
- Modify: `docs/tickets/001-repo-bootstrap-connection-utility.md`

- [ ] **Step 1: Run the full local verification pass**

```bash
pnpm install
pnpm lint
pnpm typecheck
just test
```
Expected: all exit 0 — this is the same set CircleCI runs, minus the CircleCI-specific plumbing.

- [ ] **Step 2: Tick every acceptance-criteria checkbox in the ticket**

Modify `docs/tickets/001-repo-bootstrap-connection-utility.md` — change each `- [ ]` to `- [x]` for all five bullets, since Step 1 just verified all five hold:
```diff
-- [ ] New repo initialized: Next.js (app router) + TypeScript + TanStack React Query + React Context scaffolding, plus an Anchor program skeleton building successfully via `anchor build`.
+- [x] New repo initialized: Next.js (app router) + TypeScript + TanStack React Query + React Context scaffolding, plus an Anchor program skeleton building successfully via `anchor build`.
```
(repeat for the remaining four bullets)

**Note:** this ticket's checklist mentions TanStack React Query and React Context scaffolding, but no task above adds either — there's no server state to query yet and no cross-component state to share (the whole app is one page with local `useState`). Add empty `apps/frontend/src/hooks/` and `apps/frontend/src/context/` directories (with a `.gitkeep` each) so the structure from `001-CODEBASE-STRUCTURE.md` is visible, and leave wiring TanStack Query's `QueryClientProvider` / a real Context provider to whichever ticket first needs one (002+) — installing an unused provider now would be exactly the kind of speculative scaffolding `CLAUDE.md` says not to add.

- [ ] **Step 3: Create the placeholder directories**

Run:
```bash
mkdir -p apps/frontend/src/hooks apps/frontend/src/context apps/frontend/src/components
touch apps/frontend/src/hooks/.gitkeep apps/frontend/src/context/.gitkeep apps/frontend/src/components/.gitkeep
```

- [ ] **Step 4: Commit**

```bash
git add docs/tickets/001-repo-bootstrap-connection-utility.md apps/frontend/src/hooks apps/frontend/src/context apps/frontend/src/components
git commit -m "docs: mark ticket 001 acceptance criteria complete"
```
