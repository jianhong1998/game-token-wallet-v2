# Close Game (General Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ticket:** [../../tickets/013-close-game-general-mode.md](../../tickets/013-close-game-general-mode.md)
**Spec:** [../../../openspec/changes/close-game/](../../../openspec/changes/close-game/)

**Goal:** Let a game's admin permanently end a General Mode game — burning every remaining player's balance (including the admin's own), closing every player ATA, closing the `Game` account, and pruning the game from the `Registry` — with a resumable client-side close flow and an in-app confirmation UI.

**Architecture:** Two new Anchor instructions following the existing `transfer_token`/`quit_game` shape (fixed accounts, no `remaining_accounts` loops, per architecture decision Q14): `close_game_player` (admin-authorized, burns+closes one specified player's ATA, decrements `Game.player_count`) and `close_game` (requires `player_count == 0`, prunes the `Registry`, closes the `Game` PDA). The game's SPL mint is **never closed** — the legacy SPL Token program has no instruction capable of closing a `Mint` account (verified against the actual `anchor-spl` 1.1.2 dependency this program uses — see `openspec/changes/close-game/design.md` D3's correction note); its rent is a permanent, accepted per-game cost. A new `closeGame` Server Action discovers every current player via the same `getProgramAccounts` scan `fetchGameDetail` already uses, chunks `close_game_player` calls across transactions, then sends the final `close_game` — safely re-invocable if it fails partway.

**Tech Stack:** Rust + Anchor 1.x (on-chain program), TypeScript + `@solana/kit` + Codama-generated client (`on-chain-client`), Next.js Server Actions (frontend), Vitest (all TS tests), `anchor test` via Surfpool (on-chain-program-e2e).

**Spec:** `openspec/changes/close-game/` (`proposal.md`, `design.md`, `specs/close-game/spec.md`, `specs/game/spec.md`, `specs/registry/spec.md`) — read `design.md` in full before starting; it documents every account shape, error, and the mint-cannot-be-closed correction referenced throughout this plan.

## Global Constraints

- No `ctx.remaining_accounts` / `Vec<Pubkey>` loops in on-chain instructions — every multi-target action is client-composed and chunked (architecture decision Q14).
- The game's mint is **never closed or written to as a close target** — only read/burned-against. Do not add a `close_account` CPI against `mint` anywhere in this feature.
- Burn amounts are always read from the actual ATA balance on-chain, never a client-supplied argument (matches `quit_game.rs`'s existing convention).
- Rent from every closed account (player ATAs, the `Game` PDA) goes to the `admin` signer (the system wallet), matching every existing instruction's convention.
- New error variants are appended to the *end* of `ErrorCode` in `errors.rs` — Anchor error codes are `6000 + enum index`, so inserting earlier would silently renumber existing errors (`AdminCannotQuitGame` is currently index 12 / code `0x177C` / `6012`; the two new errors must land at index 13 (`0x177D` / `6013`) and 14 (`0x177E` / `6014`)).
- `close_game_player`'s single `admin: Signer` account is used to derive **both** the caller's `user` PDA and the target's `player_user` PDA (seeds `[b"user", <username>, admin.key()]` each) — exactly like `mint_to_player.rs`. This only resolves correctly when the caller and every target player were registered under the **same shared admin keypair** in a test. Every existing e2e test that hit this same pattern (`mint_to_player.test.ts`, `quit_game.test.ts`) had to be corrected to use one shared `admin: KeyPairSigner` across host + all players — do not repeat the per-user-random-admin mistake documented in those files' own comments.
- Follow existing account-naming discipline: identically-seeded PDA accounts across instructions must use identical field names (`user`, `player_user`) so Codama's IDL-driven client generator canonicalizes them into one named finder — see `quit_game.rs`'s and `mint_to_player.rs`'s own comments on this.
- TDD: write the failing test before the implementation for every step below. Rust unit tests are inline `#[cfg(test)] mod tests` per file (existing convention — only pure/extractable logic is unit-tested; CPI-heavy handler behavior is verified by `on-chain-program-e2e` integration tests, matching every existing instruction file in this program).
- Frontend tests are colocated (`Component.test.tsx` next to `Component.tsx`, `game.test.ts` next to `game.ts`).

---

## File Structure

New files:
- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/close_game_player.rs` — `close_game_player` instruction
- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/close_game.rs` — `close_game` instruction
- `apps/on-chain-program-e2e/tests/game/close_game.test.ts` — integration tests for both instructions
- `apps/frontend/src/app/(app)/games/[address]/CloseGameButton.tsx` — admin-only close UI
- `apps/frontend/src/app/(app)/games/[address]/CloseGameButton.test.tsx` — its tests

Modified files:
- `apps/on-chain-program/programs/game_token_wallet/src/errors.rs` — add `GameNotEmpty`, `GameNotInRegistry`
- `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs` — export the two new modules
- `apps/on-chain-program/programs/game_token_wallet/src/lib.rs` — register the two new instructions
- `apps/frontend/src/server/actions/game.ts` — extract a shared player-discovery helper from `fetchGameDetail`, add `closeGame`
- `apps/frontend/src/server/actions/game.test.ts` — tests for `closeGame`
- `apps/frontend/src/app/(app)/games/[address]/page.tsx` — render `CloseGameButton` for admins

---

### Task 1: On-chain `close_game_player` instruction

**Files:**
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/close_game_player.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`
- Test: inline `#[cfg(test)] mod tests` in `close_game_player.rs`

**Interfaces:**
- Consumes: `crate::state::{Game, User}` (existing), `crate::errors::ErrorCode::{NotGameAdmin, InvalidPlayerAta, PlayerNotInGame}` (existing — no new error variants needed for this task; those come in Task 2).
- Produces: `close_game_player(ctx: Context<CloseGamePlayer>, game_id: [u8; 16], username: String, player_username: String) -> Result<()>` instruction, registered in `lib.rs`, callable by Task 3's e2e tests and (once the client regenerates in Task 4) by Task 5's `closeGame` Server Action as `getCloseGamePlayerInstructionAsync({ admin, username, gameId, playerUsername, playerAta }, { programAddress })`.

- [ ] **Step 1: Write the failing unit test for the admin-check helper**

Add to a new file `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/close_game_player.rs`:

```rust
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

pub fn ensure_caller_is_admin(user: Pubkey, game_admin: Pubkey) -> Result<()> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_games_admin() {
        let admin_user = Pubkey::new_unique();
        assert!(ensure_caller_is_admin(admin_user, admin_user).is_ok());
    }

    #[test]
    fn rejects_a_non_admin_caller() {
        let caller = Pubkey::new_unique();
        let game_admin = Pubkey::new_unique();
        assert!(ensure_caller_is_admin(caller, game_admin).is_err());
    }
}
```

- [ ] **Step 2: Run the test to verify it fails (panics on `todo!()`)**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml close_game_player`
Expected: FAIL — panics with `not yet implemented` inside `allows_the_games_admin`.

- [ ] **Step 3: Implement the full instruction file**

Replace the file's contents with the complete instruction (account struct, handler, and the now-real helper):

```rust
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{burn, close_account, Burn, CloseAccount, Mint, Token, TokenAccount};

use crate::errors::ErrorCode;
use crate::state::{Game, User};

// `user` = the calling game admin's own identity; `player_user` = the
// target player being closed out (may be the same username as `user` when
// the admin is closing their own player slot — see design.md D2). Both PDAs
// are derived from the SAME `admin` signer (seeds
// `[b"user", <username>, admin.key()]` each), matching `mint_to_player.rs`'s
// existing two-user pattern and its Codama field-naming convention.
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String, player_username: String)]
pub struct CloseGamePlayer<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    #[account(
        seeds = [b"user", player_username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub player_user: Account<'info, User>,

    #[account(mut, seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    // `mut`: the `Burn` CPI below reduces total supply, requiring the mint
    // to be writable (same reasoning as `quit_game.rs`'s own `mint` field).
    #[account(mut, seeds = [b"mint", game.key().as_ref()], bump = game.mint_bump)]
    pub mint: Account<'info, Mint>,

    /// CHECK: the target player's Associated Token Account for `mint`. Its
    /// address is validated against the deterministic ATA derivation for
    /// `(player_user, mint)` in the handler, and its initialized state is
    /// checked explicitly there too — same posture as `quit_game.rs`'s own
    /// `player_ata` check.
    #[account(mut)]
    pub player_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn ensure_caller_is_admin(user: Pubkey, game_admin: Pubkey) -> Result<()> {
    require_keys_eq!(user, game_admin, ErrorCode::NotGameAdmin);
    Ok(())
}

pub fn handler(
    ctx: Context<CloseGamePlayer>,
    _game_id: [u8; 16],
    _username: String,
    player_username: String,
) -> Result<()> {
    ensure_caller_is_admin(ctx.accounts.user.key(), ctx.accounts.game.admin)?;

    let expected_ata =
        get_associated_token_address(&ctx.accounts.player_user.key(), &ctx.accounts.mint.key());
    require_keys_eq!(
        ctx.accounts.player_ata.key(),
        expected_ata,
        ErrorCode::InvalidPlayerAta
    );
    require!(
        !ctx.accounts.player_ata.data_is_empty(),
        ErrorCode::PlayerNotInGame
    );

    // Burn whatever the ATA actually holds — never a client-supplied
    // amount, same as `quit_game.rs`.
    let balance = {
        let data = ctx.accounts.player_ata.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut &data[..])?.amount
    };

    // Authority is always the TARGET's own `User` PDA (`player_user`), not
    // the caller's — this is what makes the burn valid regardless of which
    // player is targeted, including the admin's own slot (where
    // `player_username == username` and `player_user` resolves to the same
    // PDA as `user`, with no special-casing needed).
    let admin_key = ctx.accounts.admin.key();
    let signer_seeds: &[&[u8]] = &[
        b"user",
        player_username.as_bytes(),
        admin_key.as_ref(),
        &[ctx.bumps.player_user],
    ];
    let signer_seeds_arr = [signer_seeds];

    let burn_accounts = Burn {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.player_ata.to_account_info(),
        authority: ctx.accounts.player_user.to_account_info(),
    };
    let burn_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        burn_accounts,
        &signer_seeds_arr,
    );
    burn(burn_ctx, balance)?;

    let close_accounts = CloseAccount {
        account: ctx.accounts.player_ata.to_account_info(),
        destination: ctx.accounts.admin.to_account_info(),
        authority: ctx.accounts.player_user.to_account_info(),
    };
    let close_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        close_accounts,
        &signer_seeds_arr,
    );
    close_account(close_ctx)?;

    ctx.accounts.game.player_count -= 1;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_games_admin() {
        let admin_user = Pubkey::new_unique();
        assert!(ensure_caller_is_admin(admin_user, admin_user).is_ok());
    }

    #[test]
    fn rejects_a_non_admin_caller() {
        let caller = Pubkey::new_unique();
        let game_admin = Pubkey::new_unique();
        assert!(ensure_caller_is_admin(caller, game_admin).is_err());
    }
}
```

- [ ] **Step 4: Register the module**

Edit `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`:

```rust
pub mod close_game_player;
pub mod create_game;
pub mod join_game;
pub mod mint_to_player;
pub mod quit_game;

pub use close_game_player::*;
pub use create_game::*;
pub use join_game::*;
pub use mint_to_player::*;
pub use quit_game::*;
```

- [ ] **Step 5: Register the instruction entrypoint**

Edit `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`, adding this method inside `pub mod game_token_wallet` (after `quit_game`):

```rust
    pub fn close_game_player(
        ctx: Context<CloseGamePlayer>,
        game_id: [u8; 16],
        username: String,
        player_username: String,
    ) -> Result<()> {
        instructions::game::close_game_player::handler(ctx, game_id, username, player_username)
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml close_game_player`
Expected: PASS (2 tests: `allows_the_games_admin`, `rejects_a_non_admin_caller`).

- [ ] **Step 7: Build the program to confirm it compiles**

Run: `cd apps/on-chain-program && anchor build`
Expected: builds cleanly, no errors. (`GameNotAdmin`/`InvalidPlayerAta`/`PlayerNotInGame` errors already exist in `errors.rs` — no error changes needed for this task; `GameNotEmpty`/`GameNotInRegistry` are added in Task 2.)

- [ ] **Step 8: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/instructions/game/close_game_player.rs \
        apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs \
        apps/on-chain-program/programs/game_token_wallet/src/lib.rs
git commit -m "feat(013): add close_game_player instruction"
```

---

### Task 2: On-chain `close_game` instruction

**Files:**
- Create: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/close_game.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`
- Modify: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`
- Test: inline `#[cfg(test)] mod tests` in `close_game.rs`

**Interfaces:**
- Consumes: `crate::state::{Game, Registry, User}` (existing), `crate::errors::ErrorCode::NotGameAdmin` (existing).
- Produces: `close_game(ctx: Context<CloseGame>, game_id: [u8; 16], username: String) -> Result<()>` instruction, two new `ErrorCode` variants `GameNotEmpty` and `GameNotInRegistry`, registered in `lib.rs`, callable by Task 3's e2e tests and Task 5's `closeGame` Server Action as `getCloseGameInstructionAsync({ admin, username, gameId }, { programAddress })`.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/close_game.rs`:

```rust
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

pub fn ensure_caller_is_admin(user: Pubkey, game_admin: Pubkey) -> Result<()> {
    todo!()
}

pub fn ensure_game_is_empty(player_count: u8) -> Result<()> {
    todo!()
}

pub fn find_registry_index(active_games: &[Pubkey], game: Pubkey) -> Result<usize> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_games_admin() {
        let admin_user = Pubkey::new_unique();
        assert!(ensure_caller_is_admin(admin_user, admin_user).is_ok());
    }

    #[test]
    fn rejects_a_non_admin_caller() {
        assert!(ensure_caller_is_admin(Pubkey::new_unique(), Pubkey::new_unique()).is_err());
    }

    #[test]
    fn allows_an_empty_game() {
        assert!(ensure_game_is_empty(0).is_ok());
    }

    #[test]
    fn rejects_a_non_empty_game() {
        assert!(ensure_game_is_empty(1).is_err());
    }

    #[test]
    fn finds_the_games_index_in_the_registry() {
        let game = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let active_games = vec![other, game];
        assert_eq!(find_registry_index(&active_games, game).unwrap(), 1);
    }

    #[test]
    fn errors_when_the_game_is_not_in_the_registry() {
        let game = Pubkey::new_unique();
        let active_games = vec![Pubkey::new_unique()];
        assert!(find_registry_index(&active_games, game).is_err());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml close_game::`
Expected: FAIL — panics with `not yet implemented` in every test (all three helpers are `todo!()`).

- [ ] **Step 3: Add the two new error variants**

Edit `apps/on-chain-program/programs/game_token_wallet/src/errors.rs`, appending these two variants at the **end** of the `ErrorCode` enum (after `AdminCannotQuitGame` — order matters, see Global Constraints):

```rust
    #[msg("Cannot close a game that still has players — close every player first")]
    GameNotEmpty,
    #[msg("Game was not found in the registry's active-games list")]
    GameNotInRegistry,
```

- [ ] **Step 4: Implement the full instruction file**

Replace `close_game.rs`'s contents:

```rust
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::state::{Game, Registry, User};

#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String)]
pub struct CloseGame<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    // `close = admin`: Anchor's declarative close constraint reclaims this
    // account's rent to `admin` once the handler returns successfully — no
    // manual CPI needed (there is no CPI to make; a `Game` account is owned
    // by this program itself, not the Token program).
    #[account(mut, seeds = [b"game", game_id.as_ref()], bump = game.bump, close = admin)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [b"registry"], bump)]
    pub registry: Account<'info, Registry>,
}

pub fn ensure_caller_is_admin(user: Pubkey, game_admin: Pubkey) -> Result<()> {
    require_keys_eq!(user, game_admin, ErrorCode::NotGameAdmin);
    Ok(())
}

pub fn ensure_game_is_empty(player_count: u8) -> Result<()> {
    require_eq!(player_count, 0, ErrorCode::GameNotEmpty);
    Ok(())
}

pub fn find_registry_index(active_games: &[Pubkey], game: Pubkey) -> Result<usize> {
    active_games
        .iter()
        .position(|candidate| *candidate == game)
        .ok_or_else(|| error!(ErrorCode::GameNotInRegistry))
}

// NOTE: this instruction never touches `game.mint`. The legacy SPL Token
// program has no instruction capable of closing/reclaiming rent from a
// `Mint` account (only Token-2022's `MintCloseAuthority` extension supports
// that, which this project's mints don't use) — see design.md D3's
// correction note. Do not add a mint-closing CPI here.
pub fn handler(ctx: Context<CloseGame>, _game_id: [u8; 16], _username: String) -> Result<()> {
    ensure_caller_is_admin(ctx.accounts.user.key(), ctx.accounts.game.admin)?;
    ensure_game_is_empty(ctx.accounts.game.player_count)?;

    let game_key = ctx.accounts.game.key();
    let index = find_registry_index(&ctx.accounts.registry.active_games, game_key)?;
    ctx.accounts.registry.active_games.swap_remove(index);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_games_admin() {
        let admin_user = Pubkey::new_unique();
        assert!(ensure_caller_is_admin(admin_user, admin_user).is_ok());
    }

    #[test]
    fn rejects_a_non_admin_caller() {
        assert!(ensure_caller_is_admin(Pubkey::new_unique(), Pubkey::new_unique()).is_err());
    }

    #[test]
    fn allows_an_empty_game() {
        assert!(ensure_game_is_empty(0).is_ok());
    }

    #[test]
    fn rejects_a_non_empty_game() {
        assert!(ensure_game_is_empty(1).is_err());
    }

    #[test]
    fn finds_the_games_index_in_the_registry() {
        let game = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let active_games = vec![other, game];
        assert_eq!(find_registry_index(&active_games, game).unwrap(), 1);
    }

    #[test]
    fn errors_when_the_game_is_not_in_the_registry() {
        let game = Pubkey::new_unique();
        let active_games = vec![Pubkey::new_unique()];
        assert!(find_registry_index(&active_games, game).is_err());
    }
}
```

- [ ] **Step 5: Register the module**

Edit `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs`:

```rust
pub mod close_game;
pub mod close_game_player;
pub mod create_game;
pub mod join_game;
pub mod mint_to_player;
pub mod quit_game;

pub use close_game::*;
pub use close_game_player::*;
pub use create_game::*;
pub use join_game::*;
pub use mint_to_player::*;
pub use quit_game::*;
```

- [ ] **Step 6: Register the instruction entrypoint**

Edit `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`, adding this method inside `pub mod game_token_wallet` (after `close_game_player`):

```rust
    pub fn close_game(ctx: Context<CloseGame>, game_id: [u8; 16], username: String) -> Result<()> {
        instructions::game::close_game::handler(ctx, game_id, username)
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml close_game::`
Expected: PASS (6 tests).

- [ ] **Step 8: Run the full Rust unit test suite and build**

Run: `cargo test --manifest-path apps/on-chain-program/Cargo.toml && cd apps/on-chain-program && anchor build`
Expected: all tests pass (existing + new), program builds cleanly.

- [ ] **Step 9: Commit**

```bash
git add apps/on-chain-program/programs/game_token_wallet/src/instructions/game/close_game.rs \
        apps/on-chain-program/programs/game_token_wallet/src/instructions/game/mod.rs \
        apps/on-chain-program/programs/game_token_wallet/src/lib.rs \
        apps/on-chain-program/programs/game_token_wallet/src/errors.rs
git commit -m "feat(013): add close_game instruction"
```

---

### Task 3: On-chain integration tests (`on-chain-program-e2e`)

**Files:**
- Create: `apps/on-chain-program-e2e/tests/game/close_game.test.ts`

**Interfaces:**
- Consumes: `getCloseGamePlayerInstructionAsync`, `getCloseGameInstructionAsync`, `GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY` (`0x177d`), `GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN` (existing, `0x1777`), `GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME` (existing, `0x1778`) from `on-chain-client` — these only exist once Task 4 regenerates the client from the program built in Task 2. Also consumes the existing `getCreateUserInstructionAsync`, `getCreateGameInstructionAsync`, `getJoinGameInstructionAsync`, `getMintToPlayerInstructionAsync`, `findGamePda`, `findUserPda`, `fetchGame`, `fetchMaybeGame`, `fetchRegistry`, `findRegistryPda`, `isGameTokenWalletError` (all already used by sibling test files in this directory).
- Produces: nothing consumed by later tasks — this is a leaf verification task. **Run this task's Step 1 (write the tests) before Task 4, but only actually execute them (Steps 2+) after Task 4 regenerates the client**, since the instruction builders/error constants this file imports don't exist until then. If running strictly in task order, write the file now and note in the PR/commit that verification happens in Task 4; if reordering is easier, swap Tasks 3 and 4.

- [ ] **Step 1: Write the test file**

Create `apps/on-chain-program-e2e/tests/game/close_game.test.ts`. This closely follows `mint_to_player.test.ts`'s structure — **one shared `admin` signer for host + every player**, since `close_game_player` derives both `user` and `player_user` from that single signer (see Global Constraints):

```typescript
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
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync,
  getCloseGamePlayerInstructionAsync,
  getCloseGameInstructionAsync,
  findGamePda,
  findUserPda,
  findRegistryPda,
  fetchGame,
  fetchRegistry,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY,
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

// One shared `admin` keypair registers every username in a scenario — see
// this file's DEVIATION-avoidance note: close_game_player derives BOTH the
// caller's `user` PDA and the target's `player_user` PDA from a single
// `admin: Signer`, exactly like mint_to_player.rs. Using a different random
// admin per user (as create_game.test.ts/join_game.test.ts do, where it's
// safe because those instructions only ever resolve one user) breaks that
// invariant here.
async function registeredAdmin(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  username: string,
): Promise<void> {
  const createUserInstruction = await getCreateUserInstructionAsync({
    admin,
    username,
    salt: new Uint8Array(16),
    passwordHash: new Uint8Array(64),
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createUserInstruction);
}

function gameId(fill: number): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = fill;
  return bytes;
}

async function createdGame(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  hostUsername: string,
  idFill: number,
) {
  await registeredAdmin(rpc, rpcSubscriptions, admin, hostUsername);
  const id = gameId(idFill);
  const createGameInstruction = await getCreateGameInstructionAsync({
    admin,
    username: hostUsername,
    gameId: id,
    name: "Close Test Game",
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createGameInstruction);
  const [gameAddress] = await findGamePda({ gameId: id });
  return { id, gameAddress };
}

async function joinedPlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  username: string,
) {
  await registeredAdmin(rpc, rpcSubscriptions, admin, username);
  const [userAddress] = await findUserPda({ username, admin: admin.address });
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
  return { playerAta };
}

async function closePlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  hostUsername: string,
  gameIdBytes: Uint8Array,
  playerUsername: string,
  playerAta: Parameters<typeof getCloseGamePlayerInstructionAsync>[0]["playerAta"],
): Promise<void> {
  const instruction = await getCloseGamePlayerInstructionAsync({
    admin,
    username: hostUsername,
    gameId: gameIdBytes,
    playerUsername,
    playerAta,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, instruction);
}

describe("close_game_player instruction", () => {
  it("burns a non-admin player's balance, closes their ATA, and decrements player_count", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost1", 231);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "closeplayer1",
    );
    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin,
      username: "closehost1",
      gameId: id,
      playerUsername: "closeplayer1",
      playerAta,
      amount: 500n,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, mintInstruction);

    const gameBeforeClose = await fetchGame(rpc, gameAddress);
    expect(gameBeforeClose.data.playerCount).toBe(2); // host (auto-joined) + this player

    await closePlayer(rpc, rpcSubscriptions, admin, "closehost1", id, "closeplayer1", playerAta);

    const { value: closedAtaInfo } = await rpc.getAccountInfo(playerAta).send();
    expect(closedAtaInfo).toBeNull();

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("closes the admin's own player slot via the same instruction", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost2", 232);
    const game = await fetchGame(rpc, gameAddress);
    const [hostUserAddress] = await findUserPda({ username: "closehost2", admin: admin.address });
    const [hostAta] = await findAssociatedTokenPda({
      owner: hostUserAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    await closePlayer(rpc, rpcSubscriptions, admin, "closehost2", id, "closehost2", hostAta);

    const { value: closedAtaInfo } = await rpc.getAccountInfo(hostAta).send();
    expect(closedAtaInfo).toBeNull();

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(0);
  }, 30_000);

  it("rejects a target who is not a member with PlayerNotInGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost3", 233);
    const game = await fetchGame(rpc, gameAddress);
    const nonMemberUsername = "closenonmember3";
    await registeredAdmin(rpc, rpcSubscriptions, admin, nonMemberUsername);
    const [nonMemberUserAddress] = await findUserPda({
      username: nonMemberUsername,
      admin: admin.address,
    });
    const [nonMemberAta] = await findAssociatedTokenPda({
      owner: nonMemberUserAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const instruction = await getCloseGamePlayerInstructionAsync({
      admin,
      username: "closehost3",
      gameId: id,
      playerUsername: nonMemberUsername,
      playerAta: nonMemberAta,
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
      expect.fail("expected close_game_player to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
        ),
      ).toBe(true);
    }

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("rejects a non-admin caller with NotGameAdmin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost4", 234);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "closeplayer4",
    );
    const impostorUsername = "closeimpostor4";
    await registeredAdmin(rpc, rpcSubscriptions, admin, impostorUsername);

    const instruction = await getCloseGamePlayerInstructionAsync({
      admin,
      username: impostorUsername,
      gameId: id,
      playerUsername: "closeplayer4",
      playerAta,
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
      expect.fail("expected close_game_player to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
        ),
      ).toBe(true);
    }

    const { value: ataInfo } = await rpc.getAccountInfo(playerAta).send();
    expect(ataInfo).not.toBeNull();
    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(2);
  }, 30_000);
});

describe("close_game instruction", () => {
  it("closes an empty game: prunes the registry, closes the Game account, leaves the mint untouched", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost5", 235);
    const game = await fetchGame(rpc, gameAddress);
    const mintAddress = game.data.mint;
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      mintAddress,
      "closeplayer5",
    );
    const [hostUserAddress] = await findUserPda({ username: "closehost5", admin: admin.address });
    const [hostAta] = await findAssociatedTokenPda({
      owner: hostUserAddress,
      mint: mintAddress,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const [registryAddress] = await findRegistryPda();
    const registryBefore = await fetchRegistry(rpc, registryAddress);
    expect(registryBefore.data.activeGames).toContain(gameAddress);

    // Close every player (host + the one joined player) before finalizing.
    await closePlayer(rpc, rpcSubscriptions, admin, "closehost5", id, "closeplayer5", playerAta);
    await closePlayer(rpc, rpcSubscriptions, admin, "closehost5", id, "closehost5", hostAta);

    const gameBeforeFinalize = await fetchGame(rpc, gameAddress);
    expect(gameBeforeFinalize.data.playerCount).toBe(0);

    const closeGameInstruction = await getCloseGameInstructionAsync({
      admin,
      username: "closehost5",
      gameId: id,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, closeGameInstruction);

    const { value: gameAccountInfo } = await rpc.getAccountInfo(gameAddress).send();
    expect(gameAccountInfo).toBeNull();

    const registryAfter = await fetchRegistry(rpc, registryAddress);
    expect(registryAfter.data.activeGames).not.toContain(gameAddress);

    // The mint is never closed — legacy SPL Token program has no
    // mint-closing instruction (design.md D3's correction note).
    const { value: mintAccountInfo } = await rpc.getAccountInfo(mintAddress).send();
    expect(mintAccountInfo).not.toBeNull();
  }, 30_000);

  it("rejects closing a non-empty game with GameNotEmpty", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    // Host is auto-joined at creation, so player_count is 1 — never closed
    // out here, so close_game must reject.
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost6", 236);

    const closeGameInstruction = await getCloseGameInstructionAsync({
      admin,
      username: "closehost6",
      gameId: id,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([closeGameInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected close_game to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY,
        ),
      ).toBe(true);
    }

    const { value: gameAccountInfo } = await rpc.getAccountInfo(gameAddress).send();
    expect(gameAccountInfo).not.toBeNull();
  }, 30_000);

  it("rejects a non-admin caller with NotGameAdmin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost7", 237);
    const impostorUsername = "closeimpostor7";
    await registeredAdmin(rpc, rpcSubscriptions, admin, impostorUsername);

    const closeGameInstruction = await getCloseGameInstructionAsync({
      admin,
      username: impostorUsername,
      gameId: id,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([closeGameInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected close_game to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
        ),
      ).toBe(true);
    }

    const { value: gameAccountInfo } = await rpc.getAccountInfo(gameAddress).send();
    expect(gameAccountInfo).not.toBeNull();
  }, 30_000);
});
```

- [ ] **Step 2: Confirm the file doesn't type-check yet (expected — client not regenerated)**

Run: `pnpm --filter on-chain-client run typecheck`
Expected: this file isn't part of that package, so this specific command won't catch it; instead run `pnpm --filter e2e-program run typecheck` if such a script exists, or simply proceed to Task 4 — the real signal is that `getCloseGamePlayerInstructionAsync`/`getCloseGameInstructionAsync`/`GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY` don't exist in `on-chain-client` until Task 4 regenerates it. Do not attempt to run this test file yet.

- [ ] **Step 3: Commit the test file (execution deferred to Task 4)**

```bash
git add apps/on-chain-program-e2e/tests/game/close_game.test.ts
git commit -m "test(013): add close_game/close_game_player integration tests"
```

---

### Task 4: Regenerate the on-chain client and verify no breakage

**Files:**
- Modify (generated): `apps/on-chain-client/src/generated/**` (Codama output — do not hand-edit)

**Interfaces:**
- Consumes: the built program IDL from Task 2's `anchor build` (`apps/on-chain-program/target/idl/*.json`).
- Produces: `getCloseGamePlayerInstructionAsync`, `getCloseGameInstructionAsync`, `GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY`, `GAME_TOKEN_WALLET_ERROR__GAME_NOT_IN_REGISTRY` exports from `on-chain-client`, consumed by Task 3's tests (now runnable) and Task 5's `closeGame` Server Action.

- [ ] **Step 1: Build the program (produces the updated IDL)**

Run: `cd apps/on-chain-program && anchor build`
Expected: succeeds; `apps/on-chain-program/target/idl/game_token_wallet.json` now includes `closeGamePlayer` and `closeGame` instructions and the two new error codes.

- [ ] **Step 2: Regenerate the Codama client**

Run: `pnpm --filter on-chain-client run codegen`
Expected: succeeds; generated files under `apps/on-chain-client/src/generated/` now export the new instruction builders, PDA finders (none new — no new account types), and error constants.

- [ ] **Step 3: Run the now-complete on-chain-program-e2e tests from Task 3**

Requires a running local validator with the program deployed — bring one up first if not already running:

Run: `just up` (in a separate terminal/background, or ensure it's already running), then:
Run: `just test-e2e-program`
Expected: all tests in `apps/on-chain-program-e2e/tests/game/close_game.test.ts` PASS, plus every pre-existing test in that suite still passes (no regression).

- [ ] **Step 4: Run the on-chain-client's own test suite and typecheck**

Run: `pnpm --filter on-chain-client run test && pnpm --filter on-chain-client run typecheck`
Expected: PASS — confirms the regeneration didn't break the client's own generated-code tests.

- [ ] **Step 5: Run the frontend's typecheck and full unit test suite**

Run: `pnpm --filter frontend run typecheck && pnpm --filter frontend run test`
Expected: PASS with no changes needed yet (frontend doesn't use the new instructions until Task 5) — this step exists specifically to catch the "regenerating an IDL silently broke an unrelated existing binding" failure mode documented in ticket 011's design notes, before any frontend code depends on the new client output.

- [ ] **Step 6: Commit the regenerated client**

```bash
git add apps/on-chain-client/src/generated
git commit -m "chore(013): regenerate on-chain-client for close_game instructions"
```

---

### Task 5: Frontend Server Action — `closeGame`

**Files:**
- Modify: `apps/frontend/src/server/actions/game.ts`
- Modify: `apps/frontend/src/server/actions/game.test.ts`

**Interfaces:**
- Consumes: `getCloseGamePlayerInstructionAsync`, `getCloseGameInstructionAsync`, `GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY`, `GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN` (from Task 4's regenerated `on-chain-client`); `chunkInstructionsBySize` (existing, `./transfer-chunking`); `fetchMaybeGame`, `findUserPda`, `findAssociatedTokenPda`, `getTokenDecoder` (existing, already imported in this file); `getSolanaContext` (existing).
- Produces:
  - `fetchGameMembers(rpc, mint: Address): Promise<{ username: string; owner: Address; ata: Address; balance: number }[]>` — extracted shared helper, used by both `fetchGameDetail` (refactored to call it) and `closeGame`.
  - `type CloseGameResult = { ok: true } | { ok: false; error: string; playersClosed: number; playersTotal: number }`
  - `closeGame(gameAddress: string): Promise<CloseGameResult>` — consumed by Task 6's `CloseGameButton.tsx`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/frontend/src/server/actions/game.test.ts`. First add the two new error-code mocks alongside the existing hoisted block (find the existing `vi.hoisted` block defining `NOT_GAME_ADMIN_CODE` etc. near the top of the file and add to it):

```typescript
// Add to the existing hoisted error-code block:
  GAME_NOT_EMPTY_CODE: 0x177d,
```

And add to the existing `vi.mock("on-chain-client", ...)` factory object:

```typescript
  getCloseGamePlayerInstructionAsync: mockGetCloseGamePlayerInstructionAsync,
  getCloseGameInstructionAsync: mockGetCloseGameInstructionAsync,
  GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY: GAME_NOT_EMPTY_CODE,
```

And add `mockGetCloseGamePlayerInstructionAsync`, `mockGetCloseGameInstructionAsync` to the existing hoisted mock-functions block.

Then append this new `describe` block at the end of the file (after the existing `describe("fetchGameDetail", ...)` block — reuses that block's `getProgramAccounts`/`getTokenDecoder`/`fetchAllUser` mocking pattern for player discovery, plus `quitGame`'s pattern for the not-signed-in/game-not-found/chunked-send flow):

```typescript
describe("closeGame", () => {
  const rawTokenAccountBase64 = "ZmFrZS10b2tlbi1hY2NvdW50LWJ5dGVz";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("host");
    mockGetSolanaContext.mockResolvedValue({
      rpc: {
        getLatestBlockhash: () => ({
          send: async () => ({ value: { blockhash: "fake", lastValidBlockHeight: 1n } }),
        }),
        getProgramAccounts: () => ({
          send: async () => ({
            value: [
              { pubkey: "HostAta1", account: { data: [rawTokenAccountBase64, "base64"] } },
              { pubkey: "PlayerAta1", account: { data: [rawTokenAccountBase64, "base64"] } },
            ],
          }),
        }),
      },
      rpcSubscriptions: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFetchMaybeGame.mockResolvedValue({
      exists: true,
      address: GAME_ADDRESS,
      data: gameData({ mint: MINT_ADDRESS, admin: "HostOwner11111111111111111111111111111111" }),
    });
    mockGetTokenDecoder.mockReturnValue({
      decode: vi
        .fn()
        .mockReturnValueOnce({ owner: "HostOwner11111111111111111111111111111111", amount: 0n })
        .mockReturnValueOnce({ owner: "PlayerOwner111111111111111111111111111111", amount: 150n }),
    });
    mockFetchAllUser.mockResolvedValue([
      { data: { username: "host" } },
      { data: { username: "player1" } },
    ]);
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    mockFindAssociatedTokenPda.mockResolvedValue([PLAYER_ATA_ADDRESS, 254]);
    mockGetCloseGamePlayerInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockGetCloseGameInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignAndSendTransaction.mockResolvedValue(undefined);
    mockIsGameTokenWalletError.mockReturnValue(false);
  });

  it("rejects when not signed in, without touching the chain", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(closeGame(GAME_ADDRESS)).resolves.toEqual({
      ok: false,
      error: "Not signed in",
      playersClosed: 0,
      playersTotal: 0,
    });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("treats a missing game as already closed", async () => {
    mockFetchMaybeGame.mockResolvedValue({ exists: false });
    await expect(closeGame(GAME_ADDRESS)).resolves.toEqual({
      ok: false,
      error: "Game not found",
      playersClosed: 0,
      playersTotal: 0,
    });
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("closes every discovered player then finalizes on success", async () => {
    await expect(closeGame(GAME_ADDRESS)).resolves.toEqual({ ok: true });
    expect(mockGetCloseGamePlayerInstructionAsync).toHaveBeenCalledTimes(2);
    expect(mockGetCloseGameInstructionAsync).toHaveBeenCalledTimes(1);
    // 2 player-close sends + 1 final close send (chunking packs both
    // close_game_player instructions into one chunk at this tiny test size).
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(2);
  });

  it("reports partial progress when a player-close chunk fails", async () => {
    mockSignAndSendTransaction.mockRejectedValueOnce(new Error("network blip"));
    await expect(closeGame(GAME_ADDRESS)).resolves.toEqual({
      ok: false,
      error: "network blip",
      playersClosed: 0,
      playersTotal: 2,
    });
    expect(mockGetCloseGameInstructionAsync).not.toHaveBeenCalled();
  });

  it("maps a GameNotEmpty rejection on the final close to a friendly message", async () => {
    mockSignAndSendTransaction
      .mockResolvedValueOnce(undefined) // player-close chunk succeeds
      .mockRejectedValueOnce(new Error("simulation failed")); // final close fails
    mockIsGameTokenWalletError.mockImplementation((_error, _tx, code) => code === GAME_NOT_EMPTY_CODE);
    await expect(closeGame(GAME_ADDRESS)).resolves.toEqual({
      ok: false,
      error: "A player joined or was paid while closing — please try again",
      playersClosed: 2,
      playersTotal: 2,
    });
  });

  it("re-throws an unrecognized error from the final close", async () => {
    mockSignAndSendTransaction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("network blip"));
    mockIsGameTokenWalletError.mockReturnValue(false);
    await expect(closeGame(GAME_ADDRESS)).rejects.toThrow("network blip");
  });

  it("resumes correctly on retry after a partial failure, re-closing only what discovery still finds", async () => {
    // First call: 2 members discovered, the only chunk's send fails —
    // nothing actually closed on-chain.
    mockSignAndSendTransaction.mockRejectedValueOnce(new Error("network blip"));
    await expect(closeGame(GAME_ADDRESS)).resolves.toEqual({
      ok: false,
      error: "network blip",
      playersClosed: 0,
      playersTotal: 2,
    });

    // Retry: re-discovery now finds only ONE remaining member (simulating
    // live on-chain state after some other successful closure, or simply a
    // fresh scan) — closeGame must build exactly one close_game_player
    // instruction this time, not two, since it never tracks prior attempts.
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("host");
    mockGetSolanaContext.mockResolvedValue({
      rpc: {
        getLatestBlockhash: () => ({
          send: async () => ({ value: { blockhash: "fake", lastValidBlockHeight: 1n } }),
        }),
        getProgramAccounts: () => ({
          send: async () => ({
            value: [{ pubkey: "PlayerAta1", account: { data: [rawTokenAccountBase64, "base64"] } }],
          }),
        }),
      },
      rpcSubscriptions: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFetchMaybeGame.mockResolvedValue({
      exists: true,
      address: GAME_ADDRESS,
      data: gameData({ mint: MINT_ADDRESS, admin: "HostOwner11111111111111111111111111111111" }),
    });
    mockGetTokenDecoder.mockReturnValue({
      decode: vi
        .fn()
        .mockReturnValueOnce({ owner: "PlayerOwner111111111111111111111111111111", amount: 150n }),
    });
    mockFetchAllUser.mockResolvedValue([{ data: { username: "player1" } }]);
    mockGetCloseGamePlayerInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockGetCloseGameInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignAndSendTransaction.mockResolvedValue(undefined);
    mockIsGameTokenWalletError.mockReturnValue(false);

    await expect(closeGame(GAME_ADDRESS)).resolves.toEqual({ ok: true });
    expect(mockGetCloseGamePlayerInstructionAsync).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter frontend run test -- game.test.ts -t closeGame`
Expected: FAIL — `closeGame is not defined` / mocks referencing undefined imports.

- [ ] **Step 3: Extract the shared player-discovery helper**

In `apps/frontend/src/server/actions/game.ts`, locate `fetchGameDetail` (the function with the `getProgramAccounts` scan + `fetchAllUser` mapping). Extract its discovery logic into a new exported helper placed just above `fetchGameDetail`:

```typescript
interface GameMember {
  username: string;
  owner: Address;
  ata: Address;
  balance: number;
}

// Shared by fetchGameDetail (needs balance + admin-flag context) and
// closeGame (needs every current player's username + ata to build
// close_game_player instructions) — both derive membership the same way:
// no on-chain player list exists, so live token accounts against the
// game's mint ARE the membership list (see registry/game capability specs).
async function fetchGameMembers(
  rpc: Awaited<ReturnType<typeof getSolanaContext>>["rpc"],
  mint: Address,
): Promise<GameMember[]> {
  const { value: tokenAccounts } = await rpc
    .getProgramAccounts(TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      withContext: true,
      filters: [
        { dataSize: 165n },
        {
          memcmp: {
            offset: 0n,
            bytes: mint as unknown as Base58EncodedBytes,
            encoding: "base58",
          },
        },
      ],
    })
    .send();

  const tokenDecoder = getTokenDecoder();
  const holders = tokenAccounts.map(({ account }) => {
    const decoded = tokenDecoder.decode(Buffer.from(account.data[0], "base64"));
    return { owner: decoded.owner, ata: decoded.owner, balance: Number(decoded.amount) / 100 };
  });

  const owners = holders.map((holder) => holder.owner);
  const userAccounts = owners.length ? await fetchAllUser(rpc, owners) : [];

  return holders.map((holder, index) => ({
    username: userAccounts[index].data.username,
    owner: holder.owner,
    ata: holder.ata,
    balance: holder.balance,
  }));
}
```

**Important correction while wiring this in:** the raw `tokenAccounts` entries from `getProgramAccounts` carry the ATA's own address as `pubkey` (a sibling of `account`) — `fetchGameDetail`'s original code discarded it (it never needed the ATA address, only the owner and balance). `closeGame` DOES need each player's ATA address to build `close_game_player` instructions, so change the destructuring above to capture it:

```typescript
  const holders = tokenAccounts.map(({ pubkey, account }) => {
    const decoded = tokenDecoder.decode(Buffer.from(account.data[0], "base64"));
    return { owner: decoded.owner, ata: pubkey, balance: Number(decoded.amount) / 100 };
  });
```

Now refactor `fetchGameDetail` to call this helper instead of duplicating the scan (replace its inline `getProgramAccounts`/decode/`fetchAllUser` block with a single call):

```typescript
  const members = await fetchGameMembers(rpc, game.data.mint);

  const players: GamePlayer[] = members.map((member) => ({
    username: member.username,
    balance: member.balance,
    isAdmin: member.owner === game.data.admin,
  }));

  const myMemberIndex = members.findIndex((member) => member.owner === userAddress);

  return {
    address: game.address,
    name: game.data.name,
    mode: game.data.mode,
    isAdmin: game.data.admin === userAddress,
    myBalance: myMemberIndex === -1 ? 0 : members[myMemberIndex].balance,
    players,
  };
```

(This replaces the existing `holders`/`owners`/`userAccounts`/`myHolderIndex` local variables inside `fetchGameDetail` — remove them, since `fetchGameMembers` now owns that logic. `rpc` and `adminSigner`/`programAddress` destructuring at the top of `fetchGameDetail` stays as-is since `userAddress` is still derived the same way.)

- [ ] **Step 4: Implement `closeGame`**

Add after `quitGame` in `apps/frontend/src/server/actions/game.ts`:

```typescript
export type CloseGameResult =
  | { ok: true }
  | { ok: false; error: string; playersClosed: number; playersTotal: number };

export async function closeGame(gameAddress: string): Promise<CloseGameResult> {
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in", playersClosed: 0, playersTotal: 0 };
  }

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();

  const game = await fetchMaybeGame(rpc, gameAddress as Address);
  if (!game.exists) {
    // Retrying after a full prior success lands here: the Game account no
    // longer exists once closed. Treat as an already-closed game, not an
    // error — see design.md D5.
    return { ok: false, error: "Game not found", playersClosed: 0, playersTotal: 0 };
  }

  const members = await fetchGameMembers(rpc, game.data.mint);
  const playersTotal = members.length;

  const closeInstructions = await Promise.all(
    members.map((member) =>
      getCloseGamePlayerInstructionAsync(
        {
          admin: adminSigner,
          username,
          gameId: game.data.gameId,
          playerUsername: member.username,
          playerAta: member.ata,
        },
        { programAddress },
      ),
    ),
  );

  const chunks = chunkInstructionsBySize(closeInstructions, adminSigner.address);

  let playersClosed = 0;
  for (const chunk of chunks) {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions(chunk, tx),
    );
    try {
      await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      return { ok: false, error: message, playersClosed, playersTotal };
    }
    playersClosed += chunk.length;
  }

  const closeGameInstruction = await getCloseGameInstructionAsync(
    { admin: adminSigner, username, gameId: game.data.gameId },
    { programAddress },
  );
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const finalTransactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([closeGameInstruction], tx),
  );
  try {
    await signAndSendTransaction(finalTransactionMessage, { rpc, rpcSubscriptions });
  } catch (error) {
    const cause = unwrapSimulationError(error);
    if (
      isGameTokenWalletError(cause, finalTransactionMessage, GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY)
    ) {
      return {
        ok: false,
        error: "A player joined or was paid while closing — please try again",
        playersClosed,
        playersTotal,
      };
    }
    throw error;
  }

  return { ok: true };
}
```

Add the two new imports to the existing `from "on-chain-client"` import block at the top of the file:

```typescript
  getCloseGamePlayerInstructionAsync,
  getCloseGameInstructionAsync,
  GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter frontend run test -- game.test.ts -t closeGame`
Expected: PASS (all 7 new tests).

- [ ] **Step 6: Run the full frontend test suite and typecheck**

Run: `pnpm --filter frontend run typecheck && pnpm --filter frontend run test`
Expected: PASS — confirms the `fetchGameDetail` refactor (Step 3) didn't break its own existing test (`describe("fetchGameDetail", ...)`'s "returns the roster with balances..." test, which now exercises the extracted `fetchGameMembers` path).

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/server/actions/game.ts apps/frontend/src/server/actions/game.test.ts
git commit -m "feat(013): add closeGame server action"
```

---

### Task 6: Frontend UI — `CloseGameButton`

**Files:**
- Create: `apps/frontend/src/app/(app)/games/[address]/CloseGameButton.tsx`
- Create: `apps/frontend/src/app/(app)/games/[address]/CloseGameButton.test.tsx`
- Modify: `apps/frontend/src/app/(app)/games/[address]/page.tsx`
- Modify: `apps/frontend/src/app/(app)/games/[address]/page.test.tsx` (if it asserts on the full rendered admin view — check whether adding `CloseGameButton` output requires updating an existing snapshot/assertion there)

**Interfaces:**
- Consumes: `closeGame` from `@/server/actions/game` (Task 5), `Button`/`Alert` from `@/components/ui/*` (existing, used identically by `QuitGameButton.tsx`), `useRouter` from `next/navigation`.
- Produces: default-exported `CloseGameButton({ gameAddress }: { gameAddress: string })` component, rendered by `page.tsx` when `game.isAdmin`.

- [ ] **Step 1: Write the failing component tests**

Create `apps/frontend/src/app/(app)/games/[address]/CloseGameButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockCloseGame } = vi.hoisted(() => ({ mockCloseGame: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ closeGame: mockCloseGame }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import CloseGameButton from "./CloseGameButton";

describe("CloseGameButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the Close game button and no confirmation content until clicked", () => {
    render(<CloseGameButton gameAddress="Game1" />);
    expect(screen.getByRole("button", { name: "Close game" })).toBeInTheDocument();
    expect(screen.queryByText("Close this game?")).not.toBeInTheDocument();
  });

  it("opens a confirmation modal explaining the game will be permanently destroyed", () => {
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    expect(screen.getByText("Close this game?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This game and every player's balance will be permanently destroyed and can't be recovered.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(mockCloseGame).not.toHaveBeenCalled();
  });

  it("closes the modal without submitting when Cancel is clicked", () => {
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Close this game?")).not.toBeInTheDocument();
    expect(mockCloseGame).not.toHaveBeenCalled();
  });

  it("closes and redirects home on full success", async () => {
    mockCloseGame.mockResolvedValue({ ok: true });
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockCloseGame).toHaveBeenCalledWith("Game1");
  });

  it("shows partial progress and keeps the modal open on a partial failure", async () => {
    mockCloseGame.mockResolvedValue({
      ok: false,
      error: "network blip",
      playersClosed: 3,
      playersTotal: 5,
    });
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.getByTestId("close-error")).toHaveTextContent(
        "Closed 3 of 5 players, then failed: network blip",
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("Close this game?")).toBeInTheDocument();
  });

  it("shows a plain error when nothing was closed yet", async () => {
    mockCloseGame.mockResolvedValue({
      ok: false,
      error: "A player joined or was paid while closing — please try again",
      playersClosed: 0,
      playersTotal: 0,
    });
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.getByTestId("close-error")).toHaveTextContent(
        "A player joined or was paid while closing — please try again",
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows a fallback error when closeGame throws unexpectedly", async () => {
    mockCloseGame.mockRejectedValue(new Error("Network error"));
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.getByTestId("close-error")).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter frontend run test -- CloseGameButton.test.tsx`
Expected: FAIL — `Failed to resolve import "./CloseGameButton"`.

- [ ] **Step 3: Implement the component**

Create `apps/frontend/src/app/(app)/games/[address]/CloseGameButton.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeGame } from "@/server/actions/game";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export default function CloseGameButton({ gameAddress }: { gameAddress: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function closeModal() {
    setIsOpen(false);
    setError(null);
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await closeGame(gameAddress);
        if (result.ok) {
          router.push("/");
        } else if (result.playersClosed > 0) {
          setError(`Closed ${result.playersClosed} of ${result.playersTotal} players, then failed: ${result.error}`);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full py-3 text-center text-xs font-bold text-danger"
      >
        Close game
      </button>
      {isOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/70 p-6">
          <div className="glass-hero w-full max-w-sm p-6">
            <p className="text-sm font-extrabold text-text-primary">Close this game?</p>
            <p className="mt-1 text-xs font-semibold text-text-secondary">
              This game and every player&apos;s balance will be permanently destroyed and can&apos;t be
              recovered.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={closeModal} className="flex-1">
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                isLoading={isPending}
                className="flex-1"
              >
                Close
              </Button>
            </div>
            {error && (
              <Alert data-testid="close-error" variant="error" className="mt-3">
                {error}
              </Alert>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter frontend run test -- CloseGameButton.test.tsx`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Wire the button into the game detail page**

Edit `apps/frontend/src/app/(app)/games/[address]/page.tsx`: add the import and render it admin-only, alongside `AdminControlsModal`:

```tsx
import CloseGameButton from "./CloseGameButton";
```

```tsx
      {game.isAdmin && <AdminControlsModal gameAddress={game.address} players={game.players} />}

      {game.mode === GameMode.General && (
        <SendTokensForm
          gameAddress={game.address}
          players={game.players}
          currentUsername={username}
        />
      )}

      {!game.isAdmin && <QuitGameButton gameAddress={game.address} />}
      {game.isAdmin && <CloseGameButton gameAddress={game.address} />}
```

- [ ] **Step 6: Add admin-visibility tests to `page.test.tsx`**

`page.test.tsx` already has this exact pattern for `QuitGameButton` ("shows the Quit game button for a non-admin player" / "does not show the Quit game button for the game's admin"). Add the mirrored pair for `CloseGameButton` right after those two tests in `apps/frontend/src/app/(app)/games/[address]/page.test.tsx` (no new mocks needed — `page.tsx` only calls `fetchGameDetail` directly; `CloseGameButton`'s own `closeGame` import isn't invoked until a click, which these tests don't trigger):

```typescript
  it("shows the Close game button for the game's admin", async () => {
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
    expect(screen.getByRole("button", { name: "Close game" })).toBeInTheDocument();
  });

  it("does not show the Close game button for a non-admin player", async () => {
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
    expect(screen.queryByRole("button", { name: "Close game" })).not.toBeInTheDocument();
  });
```

Run: `pnpm --filter frontend run test -- page.test.tsx`
Expected: PASS (8 tests total, up from 6).

- [ ] **Step 7: Run the full frontend suite**

Run: `pnpm --filter frontend run typecheck && pnpm --filter frontend run test`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/app/\(app\)/games/\[address\]/CloseGameButton.tsx \
        apps/frontend/src/app/\(app\)/games/\[address\]/CloseGameButton.test.tsx \
        apps/frontend/src/app/\(app\)/games/\[address\]/page.tsx \
        apps/frontend/src/app/\(app\)/games/\[address\]/page.test.tsx
git commit -m "feat(013): add admin-only close game UI"
```

---

### Task 7: Full verification gate (Done Means)

**Files:** none (verification only).

**Interfaces:** none — this task consumes everything built in Tasks 1–6 and confirms it as a whole.

- [ ] **Step 1: Format and lint**

Run: `just lint`
Expected: no changes needed, clean pass. If it fails unexpectedly, check `CLAUDE.local.md` first — a local `rtk` hook is known to sometimes rewrite `pnpm lint` into a broader `eslint .` invocation; verify with `rtk proxy pnpm lint` before treating a failure as real.

- [ ] **Step 2: Full test suite**

Run: `just test`
Expected: all of `test-program-unit`, `test-ui`, `test-on-chain-client`, `test-e2e-program`, plus the two `docker-compose.e2e.yml`-driven stacks (`on-chain-program-e2e` against a fresh container, and the Playwright `e2e` suite against a built frontend image) all pass.

- [ ] **Step 3: Boot the local stack and manually exercise the close flow**

Run: `just up` (or `just up-build` on first run)
Then, in a browser against the local frontend:
1. Register two users, log in as the first, create a game (auto-joins as admin).
2. Log in as the second user, join the game.
3. As the admin, deposit tokens to the second player (Admin Controls).
4. As the admin, open the game detail page, click "Close game", confirm.
5. Verify: redirected to `/`; the game no longer appears in "My games"; visiting the game's old URL directly returns a not-found state (mirrors `fetchGameDetail` returning `null` for a nonexistent `Game` account); log in as the second player and confirm the game is gone from their list too.

Expected: every step above observably succeeds — this is the "Behavior is observed on the running system, not just inferred" gate from `CLAUDE.md`'s Done Means section. Note in the final report whether this was actually run against a live stack or blocked (and why), per that same section's instruction never to claim success without this evidence.

- [ ] **Step 4: Update ticket and index**

Check off all boxes in `docs/tickets/013-close-game-general-mode.md`, set its status to `Done`, and update its row in `docs/tickets/000-index.md` from `Pending` to `Done`.

- [ ] **Step 5: Fold delta specs into main specs**

Run the `openspec-sync-specs` (or `openspec-archive-change`, if ticket 013 is now fully closed with nothing left to extend) skill/workflow against `openspec/changes/close-game/` per this project's `plan-implementation` workflow Step 6, so `openspec/specs/close-game/spec.md`, `openspec/specs/game/spec.md`, and `openspec/specs/registry/spec.md` reflect the now-shipped behavior.

- [ ] **Step 6: Final commit**

```bash
git add docs/tickets/013-close-game-general-mode.md docs/tickets/000-index.md
git commit -m "docs(013): mark close game ticket done"
```
