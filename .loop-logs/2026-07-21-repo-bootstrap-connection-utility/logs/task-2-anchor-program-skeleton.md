# Task 2 Log: Anchor program skeleton (`game_token_wallet` + `noop`)

## Task Context

### Plan Section
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

### Acceptance Criteria
(none listed for Task 2 — no `### Acceptance Criteria` in ticket for this specific task; global "Done means" acceptance criteria live in ticket 001 / spec §9 and are validated across the whole plan, not per-task)

### Orchestrator-Specified Deviations
- **Step 1 skipped**: Anchor CLI 1.1.2 already installed and satisfies "Anchor 1.x (latest stable via AVM)" — running `cargo install --git ... avm` would be redundant and slow. Confirmed via `anchor --version` instead.
- **Test cycle deviation** (per plan's Global Constraints, "Deviation from spec" note): `noop` has zero pure logic (`Ok(())`), so there is no unit test to TDD. Verification gate for this task is: `anchor build` succeeds twice (before/after `anchor keys sync`) and `cargo test` exits 0 with 0 tests.

---

## Attempt 1 — 2026-07-21T19:01:00Z

### Implementation Plan
- Confirm Anchor 1.1.2 already satisfies "Anchor 1.x" (skip plan's AVM install Step 1 per orchestrator instruction)
- Create Cargo workspace manifest, program crate Cargo.toml, `noop` instruction lib.rs, Anchor.toml, program package.json, .env.template (Steps 2-7)
- Run `anchor build` -> `anchor keys sync` -> `anchor build` again (Step 8), recording the synced program address
- Run `cargo test` and confirm exit 0 (Step 9)
- Commit `apps/on-chain-program` (Step 10)

### Files Changed
- created `apps/on-chain-program/Cargo.toml` — Cargo workspace manifest for the program crate(s)
- created `apps/on-chain-program/programs/game_token_wallet/Cargo.toml` — program crate manifest (anchor-lang 1.x dep)
- created `apps/on-chain-program/programs/game_token_wallet/src/lib.rs` — `noop` instruction, `game_token_wallet` program module
- created `apps/on-chain-program/Anchor.toml` — Anchor workspace config (localnet, provider wallet, e2e test script hook)
- created `apps/on-chain-program/package.json` — `on-chain-program` workspace package (`build` -> `anchor build`)
- created `apps/on-chain-program/.env.template` — local Anchor CLI env var template (not read on-chain)
- created `apps/on-chain-program/Cargo.lock` — generated by `cargo`/`anchor build`, committed for reproducible builds

### New Tests
(none — see "Deviation from spec" in plan's Global Constraints: `noop` has zero pure logic, no unit test to TDD for this task)

### Key Decisions
- **Fixed a malformed placeholder pubkey from the plan.** The plan's Step 4/5 snippets use `declare_id!("11111111111111111111111111111111111111111")` (41 `1` characters) as the placeholder program ID in both `lib.rs` and `Anchor.toml`. A valid base58-encoded 32-byte all-zero pubkey (the System Program convention Anchor scaffolds use) is exactly 32 `1` characters, not 41. Using the plan's literal 41-character string caused `anchor build` to fail immediately with `Error: String is the wrong size` (Anchor tries to parse it as a 32-byte pubkey and the decoded byte length doesn't match). Fixed by using the correct 32-character placeholder (`"11111111111111111111111111111111"`) in both files before the first `anchor build`. This is inert either way since `anchor keys sync` overwrites both occurrences with the real generated program address in Step 8 — the fix only unblocks the *first* build, which needs a syntactically valid (if wrong) pubkey to get through IDL/codegen.
- `cargo test` ran 1 test (`test_id`), not 0 as the plan's Step 9 "Expected: exits 0 (0 tests)" anticipated. This is auto-generated by Anchor's `declare_id!` macro (a sanity check that the compiled program ID matches the declared one) — not a test I authored, and consistent with the plan's stated deviation rationale (no hand-written unit test needed for `noop`). Treated as part of the passing verification gate, not a new test I need to list.
- Confirmed `apps/on-chain-program/target/idl/` is excluded by the root `.gitignore`'s `target/` rule despite the `!apps/on-chain-program/target/idl/` negation — git cannot re-include a path whose parent directory is itself excluded via a directory-level ignore pattern (a pre-existing latent bug from Task 1's `.gitignore`, out of scope to fix here). Not a blocker: nothing in this pipeline (Task 3's inline codegen, Docker/CI rebuilds) depends on the IDL being *git-tracked* — only on it existing on disk after `anchor build`, which it does.

### Lint Output
n/a — no lint step defined for this task (Rust crate skeleton, no `cargo clippy`/`cargo fmt --check` specified in plan or orchestrator instructions)

### Test Output
anchor build (1st, before keys sync): PASS — `target/idl/game_token_wallet.json` and `target/deploy/game_token_wallet-keypair.json` written, exit 0
anchor keys sync: PASS — synced `lib.rs` declare_id! and `Anchor.toml` `[programs.localnet]` entry to `BWS4UCkFps4XUs7bqqzgNxFZ3keLUMVbb9CJUpyefNob`
anchor build (2nd, after keys sync): PASS — exit 0, IDL `address` field now reads the synced program address
cargo test --manifest-path apps/on-chain-program/Cargo.toml: PASS (1 passed, 0 failed — `test_id`, auto-generated by `declare_id!` macro; 0 doc-tests)

### Commit
`df89703`

### Outcome: success
