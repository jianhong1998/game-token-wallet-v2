## Context

Ticket 010 (`docs/tickets/010-game-admin-transfer.md`), blocked by 006 (join game, done). See proposal.md for why. Architecture decision Q13 already fixed the product semantics: the new admin must already be a player, the outgoing admin stays a regular player, and there is exactly one admin.

`Game.admin` (`state/game.rs`) is already a `Pubkey` holding the admin's `User` PDA. `create_game` sets it to the creator. `mint_to_player` and `close_game` / `close_game_player` authorize with `require_keys_eq!(user.key(), game.admin, ErrorCode::NotGameAdmin)`. `quit_game` rejects that same equality with `AdminCannotQuitGame` and tells the admin to transfer (this ticket) or close (ticket 013). Membership is an initialized per-game ATA, not a player list. Nothing in this change resizes `Game` or adds an account.

The custodial model is unchanged: one system wallet signs and pays for every transaction. Which end user is acting is the session username, resolved to a `User` PDA with seeds `["user", username, system_admin]`. That is how `depositToPlayer` decides "the caller is the game admin."

## Goals / Non-Goals

**Goals:**
- One instruction that overwrites `Game.admin` and nothing else, safe to audit because the account list is fixed and there is no token CPI.
- On-chain rejection, with the existing errors where they already mean the right thing, for a non-admin caller, a non-member target, a mismatched ATA, a self-transfer, and a missing game.
- After the write, mint/deposit and close-game authorization follow the new pubkey, and the former admin can quit through the existing `quit_game` instruction while the new admin cannot.
- A Server Action and an admin-only form that a Quality Engineer can turn into unit tests, an on-chain round-trip, and one Playwright flow.

**Non-Goals:**
- Admin-initiated kick. Deferred in `docs/business-related/003-roadmap.md`.
- Private-game passwords (ticket 007). The new admin will gain that power when 007 exists because it will read `Game.admin`; this change does not add password fields or instructions.
- A second admin, a pending-invite state, or an acceptance transaction.
- Any change to `player_count`, token balances, the mint, or the `Game` account layout.
- CI config. CircleCI already runs `cargo test`, `on-chain-program-e2e`, frontend unit tests, and Playwright on every PR.

## Decisions

### D1: One instruction, overwrite `Game.admin` only

`transfer_game_admin(ctx, game_id: [u8; 16], username: String, player_username: String)`.

The handler's only write is `ctx.accounts.game.admin = ctx.accounts.player_user.key()`. No `realloc`, no mint, no burn, no `player_count` update. `Game::INIT_SPACE` already includes the 32-byte `admin` field, so existing games accept the write with no migration.

**Alternative considered:** a new `pending_admin` field plus an accept instruction. Rejected — the PRD says the role "can be transferred," Q13 does not mention acceptance, and a second field would resize every `Game` account for a handshake the product does not ask for.

### D2: Account list mirrors `MintToPlayer`'s names, without the token CPI

| Account | Type | Notes |
|---|---|---|
| `admin` | `Signer`, `mut` | System wallet. Fee payer. Same name as every other instruction so Codama keeps one signer slot. |
| `user` | `Account<User>` | seeds `[b"user", username, admin.key()]`. The caller. Compared to `game.admin`. |
| `player_user` | `Account<User>` | seeds `[b"user", player_username, admin.key()]`. The new admin. Same field name as `MintToPlayer`, so Codama reuses `findPlayerUserPda` instead of emitting a third user finder. |
| `game` | `Account<Game>`, `mut` | seeds `[b"game", game_id]`, `bump = game.bump`. The only account this instruction writes. |
| `player_ata` | `UncheckedAccount` | The new admin's ATA. Address checked against `get_associated_token_address(player_user, game.mint)`. `PlayerNotInGame` when `data_is_empty()`. Not `mut`: nothing here writes token state. |

`mint` and `token_program` are intentionally absent. `MintToPlayer` has them because it CPIs `MintTo`. The mint pubkey is already stored on `Game.mint`, which is enough to derive the ATA. Adding those accounts would not change the check and would force every caller to pass accounts the handler never reads.

`player_ata` stays `UncheckedAccount`, not `Account<TokenAccount>`, for the same reason `mint_to_player.rs` documents: an uninitialized ATA must surface `PlayerNotInGame` rather than Anchor's generic deserialization error.

**Alternative considered:** proving membership by comparing `player_user` to a list on `Game`. Rejected — there is no such list; the ATA is the membership record (architecture Q15).

### D3: Errors and check order

Reuse:

- `NotGameAdmin` — caller `user` is not `game.admin`.
- `PlayerNotInGame` — target ATA is missing or uninitialized.
- `InvalidPlayerAta` — supplied ATA address is not the derivation for `(player_user, game.mint)`.

New, appended at the end of `ErrorCode` so existing codes do not renumber (next index is 15, code `6015` / `0x177F`):

- `CannotTransferAdminToSelf` — "Cannot transfer the admin role to yourself".

Handler order:

1. `ensure_caller_is_admin(user, game.admin)` → `NotGameAdmin`.
2. `ensure_not_self_admin(user, player_user)` → `CannotTransferAdminToSelf`.
3. ATA address → `InvalidPlayerAta`.
4. ATA initialized → `PlayerNotInGame`.
5. Write `game.admin`.

Admin is checked before self so a non-admin who names themselves still gets `NotGameAdmin`. The dedicated error is what the current admin gets when the target is their own `User` PDA. `ensure_caller_is_admin` is the function already in `close_game.rs` (with its unit tests). `transfer_game_admin` calls it through a private `use super::close_game::ensure_caller_is_admin` and does not declare a second copy — `instructions/game/mod.rs` glob-exports both modules, and a second public function of that name is an `ambiguous_glob_reexports` warning. `ensure_not_self_admin` is new, with `#[cfg(test)]` tests in `transfer_game_admin.rs`, same shape as `quit_game.rs`'s `ensure_not_admin`. The ATA checks and the write are covered by `on-chain-program-e2e`, not by cargo unit tests — they need accounts.

**Alternative considered:** treating self-transfer as a successful no-op. Rejected by the team: it must fail with its own error so a buggy client cannot report success.

**Alternative considered:** reusing `SelfTransfer`. Rejected — that error's message is "Cannot transfer tokens to yourself," which would mis-describe a role change. Token self-transfer and admin self-transfer stay distinct.

### D4: Trust model matches deposits

`transferGameAdmin({ gameAddress, playerUsername })` in `apps/frontend/src/server/actions/game.ts`:

1. `getCurrentUsername()`. Missing session → `{ ok: false, error: "Not signed in" }` and no RPC.
2. Empty `playerUsername` → `"Select a player"`. `playerUsername === username` → `"Cannot transfer the admin role to yourself"`. Both happen before any transaction is built.
3. `fetchMaybeGame`. `exists: false` (unknown address, or a game `close_game` already deleted) → `"Game not found"`.
4. Derive the target ATA with `findUserPda` / `findAssociatedTokenPda` from `game.data.mint`, build `getTransferGameAdminInstructionAsync` with `username` from the session (never from the request body) and `playerUsername` from the request, sign with the system wallet, send.
5. Map `NotGameAdmin` → `"Only the game's admin can transfer the admin role"`, `PlayerNotInGame` → `"That player hasn't joined this game"`, `CannotTransferAdminToSelf` → `"Cannot transfer the admin role to yourself"`. `InvalidPlayerAta` maps to `"That player's token account is invalid"` so a bad account cannot escape the action as an uncaught throw; the action itself derives the address, so this path is defense in depth.

There is no on-chain session. A caller who bypasses the Server Action and submits the instruction directly is still bound by D3, because the program compares the `user` PDA to `game.admin`. The system wallet being the signer does not make every user an admin.

### D5: The new admin does not accept, and the UI does not ask twice

The transfer commits in the single instruction from D1. The new admin is not prompted, and there is no pending state to expire.

The form lives in the existing Admin controls modal (`AdminControlsModal.tsx`), which the game detail page already renders only when `game.isAdmin`. It follows the design sample's "Transfer admin role" block: a player `<select>` plus a Transfer button, placed under the deposit form. The sample's second confirmation dialog does not exist for this action (quit and close have one because they burn tokens; this action does not). The sample's success toast also does not exist in the app. Success closes the modal and calls `router.refresh()`, which is what deposit already does, so the former admin's page drops the admin badge, Admin controls, and Close game, and shows Quit game, without a navigation.

The `<select>` lists `players.filter((player) => !player.isAdmin)`. `isAdmin` is `owner === game.admin`, so the current admin is excluded without threading the session username into the modal. A game whose only player is the admin shows the placeholder and no names. Submitting with no selection sets a `data-testid="transfer-admin-error"` message "Select a player" and does not call the action. The button uses the existing `Button` `destructive` variant so the role change reads as dangerous, which is the sample's danger treatment expressed with the component the modal already imports.

**Alternative considered:** a confirm modal matching `QuitGameButton`. Rejected as the extra step the sample does not use for transfer, and because the new admin can transfer the role back. The on-chain self-transfer rejection plus the picker exclusion is the guard against an accidental self-target.

**Alternative considered:** redirecting home, as quit and close do. Rejected — both users are still in the game, and the former admin's next action is often to quit from this same page.

### D6: Tests, and no CI change

- Cargo: `ensure_caller_is_admin` stays in `close_game.rs` (equal keys ok, unequal keys err). `transfer_game_admin.rs` adds only `ensure_not_self_admin` (different keys ok, equal keys err).
- `apps/on-chain-program-e2e/tests/game/transfer_game_admin.test.ts`: one shared system `admin` signer for every user in a test, as `mint_to_player.test.ts` documents. Cover happy path, non-admin, non-member, a player who already quit, self-transfer, a wrong ATA in the same game, the target's ATA from another game, a missing game account, a chained A→B→C transfer where A is then `NotGameAdmin`, then the post-transfer split: former admin `quit_game` succeeds and new admin `quit_game` returns `AdminCannotQuitGame`; former admin `mint_to_player` returns `NotGameAdmin` and new admin `mint_to_player` succeeds; former admin `close_game` returns `NotGameAdmin` and the new admin's `close_game` on a non-empty game returns `GameNotEmpty`.
- Server Action unit tests in `game.test.ts`, colocated, mocking `on-chain-client` the way `depositToPlayer`'s tests do. Add `GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF` (`0x177f`) to that mock. An extra caller `username` on the input is ignored; the instruction username is the session.
- `AdminControlsModal.test.tsx` for the picker, the empty submit, success refresh, and the error slot. `page.test.tsx` asserts a non-admin viewer does not render the transfer form.
- Playwright `apps/e2e/tests/general-mode/transfer-admin.spec.ts`, two browser contexts, unique usernames (the e2e stack persists): transfer, balances unchanged, admin label and controls flip without leaving the game URL, the new admin sees them on reload, new admin deposits, former admin quits.
- `apps/on-chain-client/src/index.test.ts` asserts `getTransferGameAdminInstructionAsync` and the new error constant after codegen.
- Do not edit CircleCI config.

## Risks / Trade-offs

- **[Risk]** A client regenerates Codama and a renamed account (`new_admin` instead of `player_user`) produces a second PDA finder that drifts from `findPlayerUserPda`. → **Mitigation:** D2 fixes the field names to the ones `MintToPlayer` already uses, and the plan's codegen task fails the client unit test if the builder is missing.
- **[Risk]** Inserting `CannotTransferAdminToSelf` anywhere but the end of `ErrorCode` renumbers `GameNotEmpty` / `GameNotInRegistry` and breaks clients that already match `0x177d` / `0x177e`. → **Mitigation:** append only; the plan states the expected code `0x177f`.
- **[Risk]** Checking self before admin would report `CannotTransferAdminToSelf` for a non-admin naming themselves, and the non-admin test would be ambiguous. → **Mitigation:** D3's order; the two cases use different targets in the e2e (non-admin names the other player; the admin names themselves).
- **[Risk]** The former admin's browser still shows Admin controls until refresh. → **Mitigation:** the action's success path calls `router.refresh()`. A stale form that does get submitted fails on-chain with `NotGameAdmin`, which the action maps to the friendly message.
- **[Risk]** Transferring admin to a player who immediately goes offline leaves the game with an admin who is not at the table, and the former admin still cannot close it. → **Mitigation:** accepted. Q13 is a single admin who is already a player; the new admin can transfer back or close. This change does not add a recovery path beyond that.

## Migration Plan

No data migration. `Game.admin` already exists at its current offset and width; the new instruction only stores a different pubkey there. Deploying the upgraded program (existing devnet pipeline) makes `transfer_game_admin` callable. Rollback is a program redeploy of the previous binary: games whose admin pubkey was already overwritten keep that pubkey, which older instructions already honor because they compare against `Game.admin` and do not assume it is the creator.
