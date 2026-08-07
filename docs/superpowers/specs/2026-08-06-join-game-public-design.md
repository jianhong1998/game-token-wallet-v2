# 006 — Join game (public) — Design

Spec for [docs/tickets/006-join-game-public.md](../../tickets/006-join-game-public.md). Blocked by 005 (create game, Done). Builds on architecture decisions Q4 (`Registry` singleton discovery index, RPC-scan aversion), Q9 (2-decimal SPL mint per game), Q13 (admin transfer is decoupled from player membership), and Q15–17 (game membership tracked implicitly via ATA existence, no separate on-chain membership list).

This design **revises one assumption** from 005's own design doc: 005 Q4 speculated 006 would add `players: Vec<Pubkey>` (`#[max_len(20)]`) to `Game`. This design does not do that — see Q1 below for why a scalar counter is used instead, which is actually a closer fit to Q15–17's "no separate membership list" principle than a full pubkey vec would have been.

This ticket also expands past its own literal checklist wording ("player list ... visible to all current players") into a small per-game detail page, after a grill session surfaced that "visible" implied an actual roster view, not just a refreshed count — see Q2.

---

## Grill session — decisions

### Q1: How does `join_game` enforce the 20-player cap and let the browse page show a cheap per-game player count, given Q15–17 says no separate on-chain membership list?

**Answer:** Add a scalar `player_count: u8` to `Game`, not a `Vec<Pubkey>` roster.

**Decision:** `Game` gains `player_count: u8`, initialized to `0` by `create_game` (touched in this ticket — see Design) and incremented by `join_game`. `MAX_PLAYERS_PER_GAME: usize = 20` (PRD's fixed cap) added to `state/game.rs` alongside the existing name-length/id constants.

**Reason:** A scalar count can't drift out of sync the way a duplicated pubkey list could (Q15-17's actual concern) — it's incremented atomically in the same instruction that creates the membership-proving ATA. It gives `join_game` a cheap in-instruction cap check and gives the browse page a per-game count for free from the same `Game` fetch it already needs for name/mode, with zero extra RPC calls. The actual roster (who, and their balance) is still derived off-chain from ATA existence/balance (Q7), preserving Q15-17's "ATA is the membership record" principle — `player_count` is a derived cache of that fact's cardinality, not a second copy of the fact itself.

### Q2: What does "the player list visible to all current players" (ticket AC4) actually require?

**Answer:** A real per-game detail page showing each player's username and token balance — not just the browse page's count refreshing.

**Decision:** New route `/games/[address]` renders: header (game name/mode, admin badge if the viewer is the game's admin), a "your balance" card, and a "Players" list (username + balance per player). Modeled on the reference design's `isGame` screen (General Mode section) — see [`Kitty - Glass Vault.dc.html`](../../technical-related/ui-design/004-ui-sample/Kitty%20-%20Glass%20Vault.dc.html) lines 173–201.

**Reason:** Confirmed directly with the user against the reference design, which shows exactly this roster+balance view. Scope of that page is deliberately narrow (Q3) to avoid pulling in functionality several other tickets already own.

### Q3: Detail page scope boundary — how much of the reference design's `isGame` screen does 006 build?

**Answer:** Header, your-balance card, and players list only.

**Decision:** No "Send tokens" form (ticket 009 owns General Mode transfers), no "Quit game" button (ticket 011), no admin controls modal (008 deposit/mint, 010 admin transfer), no activity log (no ticket or architecture doc mentions this concept at all — out of scope for MVP, possibly permanently).

**Reason:** Keeps 006 focused on "join + verify you're in," matching its actual ticket title, and avoids scope creep into five other tickets' territory. User confirmed activity logs are out of scope for MVP.

### Q4: Does `create_game` (ticket 005, already shipped) get amended to auto-join the admin as a player?

**Answer:** No — 005 stays untouched.

**Decision:** A game's admin is not a player (has no ATA, doesn't appear in the players list, doesn't count toward `player_count`) unless they separately call `join_game` like anyone else. A **follow-up ticket** (number TBD, filed after this planning session — see end of this document) will own auto-joining the admin at creation time.

**Reason:** Architecture Q13 explicitly frames "admin can be a player" as optional, not automatic. Amending a Done, tested ticket's instruction here would also churn its existing tests for a change this ticket doesn't strictly need. User explicitly chose to keep this as separate, later work rather than bundling it in.

### Q5: ATA ownership model for the joining player

**Answer:** `authority = the joining player's User PDA`, `mint = game.mint`.

**Decision:** `join_game`'s created Associated Token Account is owned by the same `User` PDA that `create_game` already treats as the on-chain identity (`game.admin = creator_user.key()`, per 005 Q11) — not a bare wallet keypair (none exists, per architecture Q1's custodial model) and not the shared system admin wallet (which is the same signer for every user and would collapse all players' balances into one indistinguishable owner).

**Reason:** Consistent with the codebase's existing "`User` PDA is the wallet" convention. Verified against ticket 010 (admin transfer): `Game.admin` and player-membership are separate axes — admin transfer is a plain `Game.admin` field write gated by requiring the new admin's ATA account exist (proving Q13's "must already be a player" rule) — so this ATA-ownership choice doesn't complicate that later instruction; if anything it's what makes that instruction cheap (no token movement, no ATA authority reassignment).

### Q6: Duplicate-join handling

**Answer:** Dedicated custom on-chain error `AlreadyJoinedGame`, not a generic Anchor `init`-fails-if-exists error.

**Decision:** `join_game` does **not** use Anchor's declarative `#[account(init, associated_token::mint = ..., associated_token::authority = ...)]` for the player's ATA (that would surface a raw system/token-program "already in use" error on a second join, not a friendly message). Instead the ATA account is taken unchecked/mutable at its deterministic address; the handler explicitly checks whether it's already initialized and `require!`s a custom `ErrorCode::AlreadyJoinedGame` before attempting creation, then manually CPIs the Associated Token Program's `create` instruction.

**Reason:** User explicitly preferred a named, friendly on-chain error over relying on incidental CPI failure. The frontend's game-detail/browse roster fetch (Q7) also lets the UI pre-empt this in the common case, but the on-chain check is the actual correctness guarantee.

### Q7: How does the frontend get a per-game roster (usernames + balances) without a separate on-chain list?

**Answer:** A bounded, mint-filtered `getProgramAccounts` scan against the Token program, then batch-resolve owners to usernames.

**Decision:** For a given game: `getProgramAccounts(TOKEN_PROGRAM)` filtered by `dataSize = 165` (TokenAccount size) + `memcmp(offset: 0, bytes: game.mint)`. Returns up to `player_count` (≤20) token accounts, each with `owner` (a `User` PDA) and `amount` (raw balance, 2 decimals). Owners are then resolved to usernames via a single batched `getMultipleAccounts` fetch of those `User` PDAs (username is a field on `User`, per 003's account layout).

**Reason:** This is exactly the scan-avoidance concern architecture Q4 raised (that decision rejected `getProgramAccounts` for *global* game discovery) — but here the query is tightly bounded (≤20 results, exact-match filtered by a specific mint, not a discriminator-only or unfiltered scan) and scoped to one already-identified game, the same query shape block explorers use for "holders of token X." User confirmed this as an acceptable, justified exception rather than adding a second on-chain list.

### Q8: Local Surfpool/devnet state after the `Game` account layout change

**Answer:** Reset is fine — no persisted state to preserve.

**Decision:** Adding `player_count: u8` grows `Game::INIT_SPACE`; any `Game` accounts already created against the old layout during 005's own testing won't deserialize correctly and must be wiped (local validator reset + fresh devnet deploy) before/during this ticket's verification.

**Reason:** User confirmed there's no persisted devnet/local state from prior tickets that needs to survive.

### Q9: Route naming

**Answer:** `/games/all` for the browse list, `/games/[address]` for the detail page. Existing `/games` (005's admin-only "My games" list) is untouched.

**Decision:** Considered reusing `/games` directly for the browse page (ticket 018 eventually retires the "My games" list anyway), but that would overwrite live, shipped 005 functionality ahead of 018's own planned rework. `/games/all` is a new, non-conflicting route; 018 will point its "Browse" nav tab and Home rows at these two routes when it lands.

**Reason:** User's explicit call, to avoid regressing shipped behavior outside this ticket's scope.

### Q10: Browse-row affordance — plain "Join" button, or context-sensitive Join/Open?

**Answer:** Context-sensitive: "Join" if the viewer isn't yet a member of that row's game, "Open" (navigates to `/games/[address]`) if they already are.

**Decision:** Requires, for the whole browse list, one batched membership check: derive the viewer's expected ATA address for every active game's mint, then one `getMultipleAccounts` call (bounded by `MAX_ACTIVE_GAMES`) to determine which exist. Matches the reference design's `requestJoin`/action-label behavior (lines 109–126, 535–540 of the reference HTML).

**Reason:** User chose the richer affordance; the cost is one extra bounded batched RPC call per page load, not a scan, so it doesn't reopen the Q4/Q7 scan-aversion tension.

### Visual reference (not grilled, noted directly)

Browse list and game-detail page follow [`Kitty - Glass Vault.dc.html`](../../technical-related/ui-design/004-ui-sample/Kitty%20-%20Glass%20Vault.dc.html)'s `isBrowse` (lines 109–127) and `isGame` (lines 173–201, General Mode section only, per Q3) screens.

### Flagged: new frontend dependency likely needed

Deriving an Associated Token Account address and building its create-instruction client-side (for `joinGame`'s transaction, and for the browse page's per-row membership check) needs SPL Associated-Token-Account helpers not currently in `apps/frontend`'s or `apps/on-chain-client`'s dependencies (only `@solana/kit` is present today — see Design). The concrete package (likely `@solana-program/token`, or whatever Codama's IDL-driven generator emits for `associated_token::`-constrained accounts once the on-chain program declares them) will be confirmed during implementation and **flagged before installing**, per this repo's CLAUDE.md rule.

---

## Design

### On-chain program (`apps/on-chain-program`)

**`state/game.rs` changes:**
```rust
pub const MAX_PLAYERS_PER_GAME: usize = 20;

#[account]
#[derive(InitSpace)]
pub struct Game {
    pub bump: u8,
    pub mint_bump: u8,
    pub game_id: [u8; GAME_ID_BYTES],
    #[max_len(MAX_GAME_NAME_BYTES)]
    pub name: String,
    pub mode: GameMode,
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub player_count: u8,           // new
}
```
`Game::INIT_SPACE` sizing test updated (+1 byte).

**`instructions/game/create_game.rs` change:** handler sets `game.player_count = 0;` alongside its existing field assignments. (Only change to this file — everything else in 005 is untouched.)

**Extend `errors.rs`:**
```rust
#[msg("Game already has the maximum of 20 players")]
GameFull,
#[msg("You are already a player in this game")]
AlreadyJoinedGame,
```

**New `instructions/game/join_game.rs`:**
- Accounts (`#[instruction(game_id: [u8; 16], username: String)]`):
  - `admin: Signer<'info>` (`mut`, payer — system admin wallet, same role as every other instruction)
  - `user: Account<'info, User>` (seeds `[b"user", username.as_bytes(), admin.key().as_ref()]`, bump — the *joining* player's identity; named `user` not `player_user`, matching 005's Codama-canonicalization note so identically-seeded accounts across instructions don't get an arbitrary/colliding generated finder name)
  - `game: Account<'info, Game>` (`mut`, seeds `[b"game", game_id.as_ref()]`, bump = `game.bump`)
  - `mint: Account<'info, Mint>` (seeds `[b"mint", game.key().as_ref()]`, bump = `game.mint_bump` — read-only, needed for the ATA CPI)
  - `player_ata: UncheckedAccount<'info>` (`mut`) — the joining player's ATA; its expected address (`user`'s PDA as owner, `mint` as mint, under the Associated Token Program's standard derivation) is validated and its not-yet-initialized state is checked explicitly in the handler, not via a declarative `init` constraint (Q6)
  - `token_program: Program<'info, Token>`
  - `associated_token_program: Program<'info, AssociatedToken>`
  - `system_program: Program<'info, System>`
- Handler:
  1. `require!` the supplied `player_ata` address matches the deterministic ATA address for `(user, mint)` — cheap defensive check.
  2. `require!(game.player_count < MAX_PLAYERS_PER_GAME as u8, ErrorCode::GameFull)`.
  3. `require!(player_ata.data_is_empty(), ErrorCode::AlreadyJoinedGame)` — a never-created account is System-owned with zero lamports/data; an existing ATA is not.
  4. CPI: Associated Token Program's `create` instruction (payer = `admin`, owner = `user`, mint = `mint`) to create + initialize the ATA.
  5. `game.player_count += 1;`

**`lib.rs`:** add `join_game(ctx, game_id: [u8; 16], username: String)` dispatching to the new handler; `instructions/game/mod.rs` adds `pub mod join_game; pub use join_game::*;`.

### Off-chain (`apps/frontend/src/server`)

**`server/actions/game.ts` additions:**
- `joinGame(gameAddress: string): Promise<{ ok: true } | { ok: false; error: string }>` — session check; derives `user`/`game`/`mint`/`player_ata` addresses; builds and sends the `join_game` instruction signed by the admin signer; maps the on-chain `AlreadyJoinedGame`/`GameFull` errors to their messages (mirroring how `createGame` already surfaces on-chain errors).
- `listBrowseGames(): Promise<BrowseGame[]>` — fetches `Registry`, fetches every active `Game`, derives the current user's expected ATA address per game, and does one batched `getMultipleAccounts` to determine membership (Q10). Returns `{ address, name, mode, playerCount, isMember }[]`.
- `fetchGameDetail(gameAddress: string): Promise<GameDetail | null>` — fetches the `Game` account; runs the mint-filtered `getProgramAccounts` roster query (Q7); batch-resolves owners to usernames; finds the viewer's own balance from that same roster fetch (no extra call). Returns `{ address, name, mode, isAdmin, myBalance, players: { username, balance, isAdmin }[] }`, or `null` if the address isn't a real `Game`/the viewer isn't logged in.

### Frontend pages (`apps/frontend/src/app/(app)/games/`)

- `all/page.tsx` — "Browse games" list via `listBrowseGames()`; each row shows name, mode, `{playerCount}/20`, and a Join/Open button per row (Q10); Join calls `joinGame` then navigates to `/games/[address]` on success; Open navigates directly. Empty-registry state mirrors `/games`'s existing empty-state pattern. (Search/filter box from the reference design is **not** built — not asked for by the ticket's ACs; can be added later without any structural change.)
- `[address]/page.tsx` — game-detail page via `fetchGameDetail()`; renders header (name/mode, admin badge if `isAdmin`), your-balance card, and the players list (Q2/Q3 scope). Redirects to `/games/all` (or shows a not-found state) if the address isn't a real game or the user isn't logged in.

### Testing

- `cargo test`: `Game::INIT_SPACE` sizing guard updated for the new field; new pure-function unit tests for the capacity check (mirroring `ensure_registry_has_capacity`), e.g. `ensure_game_has_capacity(player_count: u8) -> Result<()>` — allows at `MAX_PLAYERS_PER_GAME - 1`, rejects at `MAX_PLAYERS_PER_GAME`.
- `on-chain-program-e2e` (`anchor test`): `join_game` happy path (ATA created, balance 0, `Game.player_count` incremented, admin unaffected since they never joined); duplicate-join rejected with `AlreadyJoinedGame`, state unchanged; cap-reached case (fill a game to 20 players via 20 `create_user` + `join_game` pairs, assert the 21st fails with `GameFull` and `player_count` stays at 20).
- Frontend vitest (colocated): `actions/game.test.ts` additions for `joinGame` (happy path, already-joined error, game-full error, unauthenticated), `listBrowseGames` (membership flags correct, empty registry), `fetchGameDetail` (roster/balance shape, non-existent game, non-member viewer); page tests for `all/page.tsx` and `[address]/page.tsx`.
- `apps/e2e` Playwright: register/login as a second user → Browse → see the first user's public game with a "Join" button and correct player count → Join → redirected to the game's detail page → sees self in the players list with a zero balance and the count incremented; re-visiting Browse now shows "Open" for that game.
- Manual verification against the local docker-compose/Surfpool stack (freshly reset, per Q8) before marking done, per this repo's Done-Means rule.

---

## Self-review

- No placeholders/TBDs remain except the one explicitly flagged, deliberate exception: the exact ATA-helper npm package name, which depends on what's actually available/generated once implementation starts and is flagged for install-approval rather than guessed at.
- Internally consistent: Q1's scalar-counter choice, Q6's manual-create-not-`init` choice, and Q7's roster-query choice all reinforce the same underlying rule (Q15-17's "ATA existence is the membership record") rather than fighting it — the design doesn't introduce a second, potentially-divergent source of truth for "who's a player."
- Scope: this ticket is join_game (on-chain) + `player_count` field + browse list + game-detail page (read-only roster/balance view). Explicitly does not include: admin auto-join at creation (Q4, deferred to a new ticket), transfers/quit/admin-controls/activity-log on the detail page (Q3, owned by 008/009/010/011), private-game passwords (007), or a browse search/filter box (not in the ticket's ACs).
- No requirement reads two ways: AC4's "player list visible to all current players" is now pinned to a concrete page and concrete data source (Q2/Q7), closing the ambiguity between "just a refreshed count" and "an actual roster" that the ticket text alone left open.
