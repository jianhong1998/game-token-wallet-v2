## Context

Ticket 011 (`docs/tickets/011-quit-game.md`) requires a self-service way for a player to leave a General Mode game. Architecture decision Q11 (`docs/technical-related/architecture/002-architecture-decisions.md`) already settled that quitting is unconditional and forfeits any pot contributions — no pot exists yet in General Mode, so this change only deals with the player's own wallet balance.

Game membership is implicit: there's no on-chain player list, only each player's per-game Associated Token Account (ATA). The frontend's `fetchGameDetail` (`apps/frontend/src/server/actions/game.ts`) already derives the displayed player list via `getProgramAccounts` scanning for live token accounts against the game's mint — so closing a player's ATA is sufficient to drop them from every list/picker built on that data, with no additional frontend bookkeeping.

Resolved during this ticket's grill-me session (see conversation history — not re-litigated here):
- Rent from the closed ATA returns to the admin/system signer (symmetric with who paid it at join time).
- The game's admin cannot quit their own game (must transfer admin or close the game instead) — prevents a permanently unmanageable, adminless game.
- `Game.player_count` decrements on quit, mirroring the existing increment-on-join counter.
- A quit player can rejoin later — free consequence of `join_game.rs`'s existing "ATA must be empty" check.
- Self-service only; no admin-initiated "kick" in this change (tracked in `docs/business-related/003-roadmap.md`).
- Frontend uses a styled confirmation modal (never `window.confirm`/`alert`), matching `AdminControlsModal.tsx`'s visual chrome and the copy/behavior sketched in `docs/technical-related/ui-design/004-ui-sample/Kitty - Glass Vault.dc.html` (lines 274-406, 720-728) — except the "Quit game" entry point is hidden entirely for the admin, rather than shown-then-rejected as in that sample.

## Goals / Non-Goals

**Goals:**
- Let any non-admin player in a General Mode game burn their balance, close their ATA, and leave.
- Keep `Game.player_count` accurate so capacity (`MAX_PLAYERS_PER_GAME`) and rejoin both keep working correctly.
- Ship a frontend confirmation flow consistent with the app's existing modal/copy conventions.

**Non-Goals:**
- Admin-initiated removal ("kick") of another player — deferred (`docs/business-related/003-roadmap.md`).
- Any Poker/Pool-mode pot/pool reconciliation on quit — no such mode exists yet; out of scope until those modes ship.
- Admin-transfer (ticket 010) or close-game (ticket 013) instructions themselves — referenced as the required alternative for an admin who wants to leave, not implemented here.

## Decisions

### D1: Authorization model — self-service via the player's own `User` PDA, admin fee-pays

Mirrors `transfer_token.rs`'s pattern rather than `mint_to_player.rs`'s: the quitting player's `username` derives their `User` PDA, which signs the SPL `Burn` and `CloseAccount` CPIs via `signer_seeds` (`[b"user", username, admin.key(), bump]`). The `admin` account is only the transaction fee-payer/signer (the system wallet), not a privileged actor — there is no separate "target player" field the way `mint_to_player.rs` has `player_user` vs `user`, because the caller IS the target.

**Alternative considered:** admin-authorized removal (kick), where `game.admin`'s signature authorizes removing any player. Rejected for this change — ticket 011 only asks for self-service quitting; bundling kick would expand scope beyond the ticket and grill-me's explicit decision to defer it.

### D2: Admin cannot quit their own game

The handler rejects with a new `AdminCannotQuitGame` error (`errors.rs`) when `ctx.accounts.user.key() == ctx.accounts.game.admin` — same equality-check style as `mint_to_player.rs`'s `NotGameAdmin` check, inverted.

**Alternative considered:** allow admin to quit unconditionally, accepting a resulting adminless/zombie game with no recovery path (no kick, no re-admin mechanism exists). Rejected — an unrecoverable dead end is worse than a small extra guard clause, especially since tickets 010 (admin transfer) and 013 (close game) already exist as the intended exits.

### D3: `player_count` decrement needs no explicit concurrency guard

`quit_game` declares `game` as `#[account(mut)]` and does a plain `player_count -= 1`, mirroring `join_game.rs`'s unguarded `+= 1`. Solana's runtime serializes any two transactions that both write the same account (standard account-level locking at the scheduler level) — there is no read-modify-write race to defend against in program code. Underflow is impossible: only a caller whose ATA already exists (proven by the same address-derivation check `join_game.rs`/`transfer_token.rs` already use) reaches the decrement, and the one player who could otherwise complicate accounting — the admin — is blocked by D2.

### D4: Burn the ATA's actual balance, not a client-supplied amount

The instruction burns whatever the ATA currently holds (read from the account itself in the handler), not an amount passed as an instruction argument. This matches the ticket's "burns the player's remaining game-token balance" wording exactly and removes an entire class of bugs (client passing a stale/wrong amount) — there's no legitimate reason to burn anything other than the full balance when leaving.

### D5: Rent-reclaim destination is the admin/system signer

`close_account`'s `destination` is set to the `admin` account (the tx fee-payer). This mirrors who paid the ATA's rent at `join_game` time (`payer: ctx.accounts.admin` in that CPI) — rent flows back to whoever funded it, keeping the custodial model's single-payer economics symmetric. No new "who owns reclaimed rent" concept is introduced.

### D6: Frontend — hide the button for admins, styled modal, redirect home

- "Quit game" button renders only when `!game.isAdmin` — diverges from the UI sample's always-visible-with-error-toast approach; the explicit product decision was to prevent the admin from ever attempting (and being rejected by) this action, at the cost of one extra conditional.
- Confirmation uses a styled modal component (matching `AdminControlsModal.tsx`'s chrome: dark overlay, `glass-hero` card) with a plain Cancel/Quit button pair and no form fields — this app never uses native `confirm()`/`alert()`.
- Copy follows the design sample verbatim: title "Quit this game?", body "Your balance in this game will be burned immediately and can't be recovered." No dynamic balance interpolation — the balance is already visible one glance up on the same screen.
- On success, redirect to `/` (home dashboard), matching the design sample's `confirmQuit` behavior and where `listMyMemberGames()` is rendered.

## Risks / Trade-offs

- **[Risk] A player force-closes their browser mid-transaction after the burn CPI succeeds but before the ATA close CPI runs.** → Not possible: both CPIs execute within the same atomic instruction/transaction — Solana transactions are all-or-nothing, so there's no intermediate on-chain state where the balance is burned but the ATA still open.
- **[Risk] Regenerating the Codama client for the new instruction/error could silently break an unrelated existing instruction's generated bindings.** → Mitigation: run the full frontend typecheck/test suite after regeneration, per this project's `Done Means` gate; no different from the process already used for prior tickets (008/009) that added instructions.

## Migration Plan

No data migration — this adds a new instruction and error variant to the existing program; no existing account layouts change. Deploying the updated program to devnet (via the existing CircleCI pipeline) makes `quit_game` available; no backfill or rollback concerns beyond the standard devnet redeploy process already used for prior tickets.
