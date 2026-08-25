## Context

Ticket 013 (`docs/tickets/013-close-game-general-mode.md`), blocked-by 002
(`registry`, done) and 009 (`general-mode-transfers`, done). The closest code
precedent is `quit_game.rs` (ticket 011, done, though not listed as a
blocker) — same burn-then-close-ATA CPI pair, but self-authorized rather than
admin-authorized, and touching only one player rather than every remaining
player plus the mint, `Game` PDA, and `Registry`.

Architecture decision Q14 (`docs/technical-related/architecture/002-architecture-decisions.md`)
already settled the general shape for "one admin action, many player-level
effects": fixed-account, single-purpose on-chain instructions, composed and
chunked client-side, rather than a `Vec<Pubkey>`/`ctx.remaining_accounts`
loop in one instruction. `transfer_token` already follows this for
multi-recipient sends; this change applies the same shape to closing a game.

Game membership is implicit (no on-chain player list) — the frontend's
`fetchGameDetail` already discovers every current player by
`getProgramAccounts`-scanning the token program for live accounts against
the game's mint. This change reuses that exact discovery mechanism to decide
which players still need closing.

Resolved in this ticket's grill-me session (see conversation history — not
re-litigated here):
- Two-instruction split (`close_game_player`, `close_game`), not a bounded
  remaining-accounts loop, to match the Q14 precedent.
- The admin's own player slot is closed via the exact same
  `close_game_player` path as any other player — no special-casing.
- `close_game` hard-rejects (no state change) unless `Game.player_count == 0`.
- The `Game` PDA itself is closed (full rent reclaim) as part of `close_game`
  — no closed-game history is retained anywhere on-chain.
- `Registry.active_games` pruning is swap-remove, not shift-remove — order in
  that list was never meaningful.
- No new "closing" flag/state machine on `Game`. Mid-closure races (e.g. a
  `join_game` or `mint_to_player` landing between per-player closes and the
  final `close_game` call) are accepted as an operational concern, not
  program-enforced, because the whole client-side close flow is idempotent:
  player discovery always re-scans live state, so a straggler is simply
  picked up and closed on the next attempt.
- The client's `closeGame` action auto-chains discovery → per-player closes
  → final close as one admin-facing action, reporting partial progress
  (`playersClosed`/`playersTotal`) on failure — same contract shape as 009's
  `transferTokens`/`transfersApplied`/`transfersTotal`.
- Frontend confirmation is a styled in-app modal (never `window.confirm`),
  matching `QuitGameButton.tsx`'s existing modal chrome and copy pattern.

## Goals / Non-Goals

**Goals:**
- Let a game's admin permanently end a General Mode game: burn every
  remaining player's balance (including the admin's own), close every player
  ATA, close the `Game` PDA, and prune the `Registry` entry. (The mint
  itself is not closable under the legacy SPL Token program — see D3's
  correction note — so its rent is a permanent, accepted per-game cost.)
- Keep the on-chain instructions simple and auditable (fixed accounts, no
  dynamic-length validation), consistent with Q14 and every existing
  instruction in this program.
- Make the client-side close flow safely resumable: a partial failure (one
  chunk of player-closes fails, or the final `close_game` call fails because
  of a late-arriving player) can be retried by simply calling the same action
  again, with no separate resume-state to track.
- Leave the resulting listings (`listBrowseGames`, `listMyMemberGames`)
  correct for free, since both already derive from `Registry.active_games`
  and live account existence.

**Non-Goals:**
- Poker/Pool pot-burning. Tickets 015/016 will later extend
  `close_game_player`/`close_game` for pot accounts; nothing Poker/Pool-
  specific is designed or built here.
- Program-enforced mid-closure locking (a `closing` flag rejecting new
  `join_game`/`transfer_token`/`mint_to_player` calls once a close has
  started). Explicitly rejected in the grill-me session — accepted as an
  operational risk given this is an admin-driven, interactive, low-stakes
  self-hosted deployment.
- Retaining any record of a closed game (name, final player list, etc.) for
  a future "closed games" history view — the `Game` PDA is fully closed, no
  trace remains beyond transaction history.
- Atomicity across the whole multi-transaction close — same non-goal as
  009's `transferTokens`; Solana transactions are only atomic individually.

## Decisions

### D1: Two on-chain instructions, not a bounded remaining-accounts loop

`close_game_player(ctx, game_id: [u8; 16], username: String, player_username: String)`
and `close_game(ctx, game_id: [u8; 16], username: String)`.

**Alternative considered:** a single `close_game` instruction taking up to
`MAX_PLAYERS_PER_GAME` (20) player ATAs via `ctx.remaining_accounts`, looping
over them atomically in one transaction. This bound is hard and small (an
existing program constant), unlike `transfer_token`'s arbitrary recipient
list, so it doesn't trigger Q14's original "unbounded/arbitrary" objection
as directly — but it was rejected anyway to keep one consistent shape across
the whole program (every multi-target admin action is client-composed and
chunked, not a remaining-accounts loop), and because 015/016 explicitly plan
to "extend this instruction" for pot-burning, which composes more naturally
onto a small single-purpose instruction than a monolithic one.

### D2: `close_game_player` account shape and authorization

Mirrors `quit_game.rs`'s account list and CPI pattern, with two differences:
the signer/authorizer is the **admin** (system wallet + `game.admin`'s
identity is not itself required to sign — same custodial posture as
`mint_to_player.rs`), and the **target player is a separate field**
(`player_username`) rather than the caller being the target — unlike
`quit_game.rs`, which has no separate "target" field because quitting is
self-service.

| Account | Type | Notes |
|---|---|---|
| `admin` | `Signer` | System wallet, fee payer, rent destination |
| `user` | `Account<User>` | seeds `[b"user", username, admin.key()]` — the *calling* game admin's own identity, verified against `game.admin` |
| `player_user` | `Account<User>` | seeds `[b"user", player_username, admin.key()]` — the target player being closed out; named `player_user` to match `mint_to_player.rs`'s existing field name for "the target, not the caller" |
| `game` | `Account<Game>`, `mut` | seeds `[b"game", game_id]` |
| `mint` | `Account<Mint>`, `mut` | seeds `[b"mint", game.key()]` — writable, `Burn` reduces supply |
| `player_ata` | `UncheckedAccount`, `mut` | validated against `get_associated_token_address(player_user.key(), mint.key())`; `PlayerNotInGame` if empty — identical posture to `quit_game.rs`'s `player_ata` check |
| `token_program` | `Program<Token>` | |

Handler:
1. `require_keys_eq!(ctx.accounts.user.key(), ctx.accounts.game.admin, ErrorCode::NotGameAdmin)` — only the game's admin may close players out (reuses the existing `NotGameAdmin` error, same check `mint_to_player.rs` already does).
2. Validate `player_ata` against its expected derivation; `PlayerNotInGame` if uninitialized (identical to `quit_game.rs`).
3. Read the ATA's actual balance (never a client-supplied amount — same as `quit_game.rs`'s D4) and burn it, with CPI authority = `player_user` (the target's own `User` PDA), signer seeds `[b"user", player_username.as_bytes(), admin.key().as_ref(), &[ctx.bumps.player_user]]`. This is what makes the burn valid regardless of which player is targeted, including the admin's own slot — the authority is always the *target's* PDA, not the caller's.
4. Close the ATA via CPI, same authority/signer seeds, rent `destination = admin`.
5. `game.player_count -= 1`.

No new state, no new account type. When the target is the admin's own
player slot, `player_username == username` and `player_user` resolves to
the same `User` PDA as `user` — the handler doesn't need to special-case
this; the derivation and CPI logic are identical either way.

**Alternative considered:** special-casing the admin's own ATA in the final
`close_game` instruction instead (since `close_game` already touches
`game`/`mint` and could derive the admin's own ATA without a separate call).
Rejected in grill-me — one uniform code path for every player (including
admin) is simpler to reason about and test than two divergent paths for the
same underlying operation.

### D3: `close_game` requires an empty game, otherwise hard-fails

| Account | Type | Notes |
|---|---|---|
| `admin` | `Signer` | System wallet, fee payer, rent destination for the `Game` PDA |
| `user` | `Account<User>` | seeds `[b"user", username, admin.key()]`, verified against `game.admin` |
| `game` | `Account<Game>`, `mut`, `close = admin` | seeds `[b"game", game_id]` — Anchor's declarative `close` constraint reclaims rent to `admin` automatically |
| `registry` | `Account<Registry>`, `mut` | seeds `[b"registry"]` |

Handler:
1. `require_keys_eq!(user.key(), game.admin, ErrorCode::NotGameAdmin)`.
2. `require_eq!(game.player_count, 0, ErrorCode::GameNotEmpty)` — checked
   *before* any registry mutation, so a rejection leaves every account
   untouched (no partial registry mutation).
3. Find `game.key()` in `registry.active_games`, swap-remove it. (The index
   is guaranteed to exist — every game is pushed to the registry exactly
   once at creation and never removed except here.)
4. `game` is closed automatically by Anchor's `close = admin` account
   constraint, reclaiming its rent, once the handler returns successfully.

New error: `GameNotEmpty` ("Cannot close a game that still has players —
close every player first") — `errors.rs`.

**Alternative considered:** letting `close_game` silently no-op if
`player_count > 0` (returning success anyway, leaving a zombie game).
Rejected explicitly in grill-me — the ticket asks for a "fail loudly" check;
a silent partial success would hide a bug (a straggling player) rather than
surfacing it.

**Correction from the original grill-me/design pass — the game's mint is
NOT closed.** The original design assumed `token::close_account` (SPL
Token's `CloseAccount` instruction) could close a `Mint` account once its
supply reaches zero, mirroring how it closes a `TokenAccount`. This is
false: verified against the actual dependency this program uses
(`anchor_spl::token::close_account` in `anchor-spl` 1.1.2 is a thin wrapper
around the legacy SPL Token program's `CloseAccount` instruction, which per
its own instruction-set documentation only operates on token *accounts*
(165-byte `Account` state) — non-native accounts may only be closed once
their token amount is zero, but there is no code path for a `Mint` (82-byte
`Mint` state) at all. The legacy SPL Token program has no instruction
capable of closing/reclaiming rent from a `Mint` account under any
condition — that capability only exists in Token-2022 via the
`MintCloseAuthority` extension, which this project's mints don't use (see
`openspec/specs/game/spec.md`'s "legacy SPL Token program... no freeze
authority" pin). Invoking `close_account` against the game's `mint` would
fail on-chain immediately (`Account::unpack` expects a 165-byte layout and
gets a Mint's 82 bytes) — caught by the first e2e test, not a subtle bug,
but real enough to have derailed this ticket's original design.

**Resolved (second grill-me question, mid-implementation-planning):**
`close_game` does not touch the mint at all — it is not in the account list
above. The mint account remains on-chain permanently once a game is closed;
its one-time rent (paid at `create_game` time) is never recovered. This is
accepted as a fixed, unavoidable per-game cost given the legacy-Token-program
mint architecture, not a bug to work around — migrating to Token-2022's
`MintCloseAuthority` extension (which would touch every already-shipped
instruction that creates/reads/mints against a game's mint) was explicitly
rejected as disproportionate to this ticket's scope. `close_game`'s actual
effects are: enforce `player_count == 0`, prune the `Registry` entry, and
close the `Game` PDA — full rent reclaim on those two, no reclaim on the
mint.

### D4: Registry swap-remove

```rust
let index = registry.active_games.iter().position(|g| *g == game.key())
    .ok_or(ErrorCode::GameNotInRegistry)?; // defensive; should be unreachable
registry.active_games.swap_remove(index);
```

Swap-remove is O(1) versus a shift-remove's O(n), and `active_games`'s order
was never meaningful (it's a browse list, not a priority queue) — no
existing behavior depends on registry order. `GameNotInRegistry` is a
defensive error for a state that shouldn't be reachable given the registry
is only ever mutated by `create_game` (push) and this instruction (remove);
included because Anchor requires every fallible operation to have an error
path, not because a realistic scenario produces it.

### D5: Client-side player discovery and orchestration

`closeGame(gameAddress)` in `apps/frontend/src/server/actions/game.ts`,
following `transferTokens`'s exact structure in the same file:

1. Discover every current player of the game via the same
   `getProgramAccounts`-against-the-mint scan `fetchGameDetail` already uses
   (extracted as a shared helper if not already reusable as one) — this
   includes the admin's own ATA if it still exists.
2. Build one `close_game_player` instruction per discovered player, chunk
   them via the existing `chunkInstructionsBySize` helper
   (`apps/frontend/src/server/actions/transfer-chunking.ts`), send
   sequentially, stop on first failure — identical sequencing rationale to
   009's D4 (sending chunk 2 before confirming chunk 1 would make
   "stop-on-first-failure" meaningless).
3. Once every discovered player is closed (or the discovery scan finds zero
   remaining players, e.g. on a retry after a full player-closing pass that
   only failed on the final step), send the `close_game` instruction.
4. Return type mirrors `TransferTokensResult`:
   ```ts
   type CloseGameResult =
     | { ok: true }
     | { ok: false; error: string; playersClosed: number; playersTotal: number };
   ```
5. Idempotent retry: since discovery re-scans live on-chain state on every
   call, calling `closeGame` again after a partial failure naturally skips
   already-closed players and continues; calling it again after a full
   success finds the `Game` account no longer exists and returns
   `{ ok: false, error: "Game not found", playersClosed: 0, playersTotal: 0 }`
   (same "not found" convention `joinGame`/`quitGame` already use via
   `fetchMaybeGame`), rather than throwing.

**Alternative considered:** tracking close-progress in some client-side or
off-chain state (e.g. a cookie, a resume token) to avoid re-scanning on
retry. Rejected — there is no off-chain database in this project (binding
architecture constraint), and re-scanning on-chain state is already how
every other listing in this codebase (`listBrowseGames`, `fetchGameDetail`)
determines truth; adding a second source of truth for "who's left to close"
would only introduce a new way for that state to go stale.

### D6: Frontend — admin-only action, styled confirmation modal, redirect home

- `CloseGameButton.tsx`, rendered only when `game.isAdmin` (mirrors
  `QuitGameButton.tsx`'s `!game.isAdmin` gating, inverted), placed alongside
  the existing `AdminControlsModal` on the game detail page.
- Confirmation modal reuses `QuitGameButton.tsx`'s exact chrome (`glass-hero`
  card, dark overlay, `Button` `secondary`/`destructive` pair, no native
  `confirm()`/`alert()`) with copy adjusted for the larger blast radius:
  title "Close this game?", body "This game and every player's balance will
  be permanently destroyed and can't be recovered." — since this affects
  every player, not just the admin's own balance.
- On success, redirect to `/` (home dashboard) — same target as
  `QuitGameButton.tsx`'s D6, since `listMyMemberGames()` is rendered there
  and the closed game must no longer appear.
- On partial failure (`playersClosed > 0`), render progress explicitly
  ("Closed `playersClosed` of `playersTotal` players, then failed:
  `error`") so the admin knows it's safe/expected to retry by pressing the
  same button again — mirrors 009's `transfersApplied`/`transfersTotal`
  frontend treatment.

## Risks / Trade-offs

- **[Risk]** A `join_game` or `mint_to_player` lands between the last
  `close_game_player` call and the final `close_game` call, leaving
  `player_count > 0` when `close_game` runs.
  → **Mitigation:** `close_game` hard-fails with `GameNotEmpty` (D3) rather
  than corrupting state; the admin retries `closeGame`, which re-discovers
  the straggler and closes it too (D5). Accepted as a real but low-probability,
  self-correcting race per the grill-me decision — no program-level lock
  added.
- **[Risk]** The game's mint account is never closed — its rent is
  permanently locked once a game closes, for the lifetime of the deployment.
  → **Mitigation:** accepted as an unavoidable consequence of the legacy SPL
  Token program having no mint-closing instruction (D3's correction note);
  not worth a Token-2022 migration for this ticket. Documented in the ticket
  and spec so it isn't mistaken for a bug later.
- **[Risk]** A close flow spanning many transactions (up to 20 players,
  chunked, plus one final instruction) is slower and more failure-prone than
  a single atomic call. → **Mitigation:** accepted, same trade-off 009
  already made for multi-recipient transfers; correctness (auditable, fixed-
  account instructions; honest partial-progress reporting) is prioritized
  over minimizing round-trips, and the flow is safely resumable if it does
  fail partway.
- **[Risk]** `close_game`'s registry swap-remove assumes the game is always
  present in `active_games` — if that invariant were ever violated (a bug
  elsewhere), the defensive `GameNotInRegistry` error surfaces it loudly
  instead of panicking or silently no-op'ing.
- **[Risk]** Regenerating the Codama client for two new instructions and one
  new error variant could silently affect unrelated generated bindings
  (observed previously per ticket 011's design notes). → **Mitigation**: run
  the full frontend typecheck/test suite after regeneration, per this
  project's `Done Means` gate — same process already used for prior tickets.

## Migration Plan

No data migration — this adds two new instructions and two new error
variants to the existing program; no existing account layouts change
(`Game` and `Registry` are read/mutated with their current shapes; the mint
is read-only in `close_game_player` and untouched by `close_game`).
Deploying the updated program to devnet via the existing CircleCI pipeline
makes `close_game_player`/`close_game` available; no backfill or rollback
concerns beyond the standard devnet redeploy process already used for prior
tickets.
