# 005 — Create game (General Mode, public) — Design

Spec for [docs/tickets/005-create-game-general-mode.md](../../tickets/005-create-game-general-mode.md). Blocked by 002 (registry init) and 003 (user registration/login), both done. Builds on architecture decisions Q4 (`Registry` singleton discovery index), Q9 (2-decimal SPL mint per game), Q13 (admin can optionally also be a player), Q14 (client-composed multi-recipient transfers — not relevant to creation itself, but confirms the single-recipient philosophy this ticket's neighbors follow), and Q17 (`Game` owns its own mint, no `Pool`-style shared account).

This is the first ticket to create an SPL mint (introduces the `anchor-spl` dependency and the legacy SPL Token program — no prior ticket needed a token program), and the first ticket to populate `Registry.active_games` (ticket 002 only initialized the empty registry).

---

## Grill session — decisions

### Q1: Game PDA seed and how the client-generated UUID v7 becomes the on-chain identity

**Answer:** `seeds = [b"game", game_id.as_ref()]`, where `game_id: [u8; 16]` is the raw UUID v7 bytes. Both `game_id` and `name` are stored as fields on `Game`.

**Reason:** `Registry.active_games: Vec<Pubkey>` (already typed this way since ticket 002) can only hold addresses, so each registry entry is naturally the `Game` PDA's own address — the UUID itself is seed material, not what's stored in the registry. Unlike `User`'s seed (`["user", username, system_admin_pubkey]`), no admin pubkey is needed in the `Game` seed: the UUID is already globally unique (client-generated) and there is only one system admin wallet per deployment (multi-tenancy dropped, architecture Q3), so including it would add nothing. Storing `game_id` and `name` on the account mirrors `User.username`'s reasoning (ticket 003 Q3): PDA derivation is one-way, and the Next.js app needs to reconstruct/display both from a fetched account with no off-chain database to fall back on.

### Q2: Does `Game` need an explicit `mode` field in this ticket?

**Answer:** Yes — a 3-variant enum (`General`, `Poker`, `Pool`), stored now even though only `General` has working instructions.

**Decision:** `GameMode` enum added to `state/game.rs`; `create_game` always stores `GameMode::General` (no mode argument accepted from the client in this ticket — see Q9 below on why the selector itself stays hidden). Future tickets (014 poker, 016 pool) add the instructions that read this field; they don't need to touch `Game`'s layout to add it.

**Reason:** Cheap to add now (1 byte) and avoids a future `realloc` migration, consistent with `Registry` pre-declaring `MAX_ACTIVE_GAMES` capacity upfront (ticket 002) rather than growing the account later. The ticket text itself mentions "mode" as part of the creation form, so the concept belongs on `Game` from the start even though only one variant is functional yet.

### Q3: Does `Game` need an `is_private` field in this ticket?

**Answer:** No.

**Decision:** No visibility/privacy field is added. Every `Game` created by this ticket is implicitly public. Ticket 007 adds `is_private: bool` and `password_hash: Option<[u8; 64]>` together via `realloc` when private games actually land.

**Reason:** Unlike `mode` (explicitly named in this ticket's checklist), "visibility" isn't something this ticket's requirements ask for — ticket 005's own scope line says "defaulting to General Mode, public visibility," i.e. this ticket only ever produces public games. Anchor's `realloc` is a normal, well-supported pattern in this stack, so there's no structural cost to deferring. Pre-declaring every field a future ticket might eventually want would snowball (password hash, player-list capacity, admin-transfer history, ...) — YAGNI wins here where it didn't for `mode`, because `mode` was actually asked for by this ticket and visibility wasn't.

### Q4: Does `Game` need a `players: Vec<Pubkey>` field in this ticket?

**Answer:** No.

**Decision:** `Game` in this ticket has no player list, only `admin: Pubkey`. Ticket 006 adds `players: Vec<Pubkey>` (`#[max_len(20)]`, per PRD's `MAX_PLAYER_PER_GAME`) via `realloc` when join-game lands.

**Reason:** Same deferral logic as Q3 — ticket 006 explicitly owns "adds them to the game's player list, capped at 20 players," so that field belongs to that ticket. This also resolves how "creator sees themselves listed as game admin ... and the game appears in their own game list" is satisfied without a player list: it's purely `Game.admin` matching the logged-in user, and does **not** imply the creator is auto-joined as a player — consistent with architecture Q13 ("game admin *can* be a player at the same time," not automatically *is* one).

### Q5: Mint authority — the `Game` PDA itself, or the system admin wallet keypair directly?

**Answer:** The `Game` PDA.

**Decision:** `create_game` initializes the mint with `mint::authority = game` (the `Game` PDA), not the admin signer. Later instructions that mint (ticket 008) or close the mint (ticket 013) sign via CPI using the `Game` PDA's seeds (`invoke_signed` under the hood, via Anchor's PDA-signer support), not the admin keypair directly.

**Reason:** Idiomatic Anchor pattern for a program-owned resource — scopes minting authority to the specific game rather than layering it onto the admin wallet's already-total power over every other account in this single-tenant deployment. Reads more naturally against ticket 013's wording ("closes the game's mint") — that's the game's own PDA cooperating in its own closure, not a global admin operation that happens to target this mint.

### Q6: Game name validation — length bounds, charset, normalization

**Answer:** Same rules as `username` (ticket 003 Q1/Q2), enforced at all three layers (frontend UI, Next.js server, on-chain program).

**Decision:** `MIN_GAME_NAME_BYTES = 3`, `MAX_GAME_NAME_BYTES = 32` (UTF-8 bytes), charset `/^[\p{L}\p{N} ]+$/u` (Unicode letter, Unicode number, or space), normalized via `input.normalize("NFC")` only — **no case-folding** (unlike username, a display name isn't used for lookup/uniqueness, so case is preserved). Game names are **not** required to be unique; the UUID is the real identity.

**Reason:** Reuses an already-settled, already-reasoned-through rule set instead of inventing a new one; the byte-length ceiling isn't seed-driven here (unlike username, which is capped by Solana's 32-byte seed limit) but 32 bytes is still a sensible display-name bound and keeps account sizing consistent with the one existing precedent in this codebase. Three-layer enforcement (browser → Next.js Server Action → on-chain `require!`) mirrors the defense-in-depth pattern already established for username/password (ticket 003 Q8).

### Q7: UUID v7 generation — hand-roll or add a package?

**Answer:** Hand-roll.

**Decision:** New `server/game-id.ts` with `generateGameId(): Uint8Array` (16 bytes), built from `Date.now()` (48-bit millisecond timestamp per RFC 9562's v7 layout) plus `crypto.getRandomValues()` for the random/version/variant bits. No new npm dependency.

**Reason:** Node's built-in `crypto.randomUUID()` only produces v4, not the time-ordered v7 this ticket calls for, and no `uuid`/`uuidv7` package currently exists in `apps/frontend/package.json`. Hand-rolling ~20 lines follows the exact precedent set by ticket 003's session-cookie HMAC signing (Q6: "Hand-rolled ... via Web Crypto, not a library ... zero new dependencies") rather than pulling in a package for a small, well-specified, easily-tested primitive.

### Q8: Post-creation flow — what page shows "the game appears in their own game list"?

**Answer:** A new "My Games" list page.

**Decision:** `app/(app)/games/page.tsx` fetches `Registry.active_games`, fetches each referenced `Game` account, filters to `admin === currentUser`, and lists them. `app/(app)/games/new/page.tsx` is the creation form; on success it redirects to `/games`.

**Reason:** The ticket's literal wording is "the game appears in their own game list," not "a game detail page" — a list page is the more direct reading. With no player list yet (Q4) and ticket 006 owning the separate *public browse* list, this ticket needs its own minimal admin-scoped list rather than retrofitting one later; ticket 006 can extend this same page or build alongside it without either blocking the other.

### Q9: Poker/Pool mode selector — hidden or visible-but-disabled?

**Answer:** Hidden.

**Decision:** The creation form shows only a "General Mode" label — no real selector control, since ticket 005's `create_game` doesn't accept a mode argument at all (Q2: always stores `GameMode::General`). Tickets 014/016 build the selector UI when they add working alternate modes.

**Reason:** Consistent with the Q3/Q4 deferral principle — don't build UI (or an instruction argument) for functionality two-plus tickets away. The ticket text explicitly permits either treatment ("selectable-but-inert or hidden"), so this is a pure simplicity call, not a requirements gap.

### Q10: SPL Token program — legacy `spl-token` or Token-2022?

**Answer:** Legacy SPL Token.

**Decision:** New `anchor-spl = "1"` dependency (matching the existing `anchor-lang = "1"` version line), using `anchor_spl::token::Token` — not `token_2022`/`token_interface`. `create_game`'s mint uses the classic Token program throughout.

**Reason:** No requirement anywhere in the PRD or architecture docs calls for a Token-2022 extension (transfer fees, non-transferable tokens, on-chain metadata pointer — the game name/mode already live on the `Game` account, not as token metadata). Legacy Token has the widest wallet/explorer/tooling support and the simplest CPI surface. This choice is inherited by every subsequent ticket that touches tokens (006 ATA creation, 008 mint-to, 009 transfers, 011 burn-on-quit, 012 burn-on-delete, 013 close), so it's deliberately locked in here rather than left to drift.

### Q11: What does `Game.admin: Pubkey` actually store, given users have no wallet/keypair?

**Answer:** The creator's `User` PDA address, passed into `create_game` as a read-only `Account<'info, User>`, not a bare `Pubkey` argument.

**Decision:** `create_game` takes an additional read-only account, `creator_user: Account<'info, User>` (seeds `[b"user", username, system_admin_pubkey]`, derived server-side from the current session's username). `Game.admin = creator_user.key()`. Anchor's account deserialization rejects the transaction if that address isn't actually an initialized `User` account.

**Reason:** There's no such thing as "the user's own wallet pubkey" in this custodial model (architecture Q1) — the only real per-user on-chain identity is the `User` PDA. Passing it as a typed `Account<User>` (rather than a plain `Pubkey` argument, which would mirror `delete_user`'s client-supplied-list trust model from Q15-17) costs nothing extra here and buys a free existence/type check: a stale or malformed session can never produce a `Game` whose `admin` doesn't correspond to a real registered user. This differs from Q15-17's "trust the server" call because that case's worst outcome was orphaned rent dust; here the equivalent mistake would silently mint a `Game` no real account can ever match against in the "My Games" filter.

### Visual reference (not grilled, noted directly)

The creation form and "My Games" list should follow the visual language of [`docs/technical-related/ui-design/004-ui-sample/Kitty - Glass Vault.dc.html`](../../technical-related/ui-design/004-ui-sample/Kitty%20-%20Glass%20Vault.dc.html).

---

## Design

### On-chain program (`apps/on-chain-program`)

**New dependency**, `programs/game_token_wallet/Cargo.toml`:
```toml
anchor-spl = "1"
```

**New `state/game.rs`:**
```rust
use anchor_lang::prelude::*;

pub const MIN_GAME_NAME_BYTES: usize = 3;
pub const MAX_GAME_NAME_BYTES: usize = 32;
pub const GAME_ID_BYTES: usize = 16;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum GameMode {
    General,
    Poker,
    Pool,
}

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
}
```
Inline `#[cfg(test)] mod tests` guards `Game::INIT_SPACE` sizing, same pattern as `Registry`/`User`.

**Extend `errors.rs`:**
```rust
#[msg("Game name must be between 3 and 32 bytes")]
InvalidGameNameLength,
#[msg("Registry is full")]
RegistryFull,
```

**New `instructions/game/create_game.rs`:**
- Accounts:
  - `admin: Signer<'info>` (`mut`, payer — the system admin wallet, same signer role as every other instruction)
  - `creator_user: Account<'info, User>` (read-only, seeds `[b"user", username.as_bytes(), admin.key().as_ref()]` — the game creator's `User` PDA; existence is enforced by Anchor's account deserialization, per Q11)
  - `registry: Account<'info, Registry>` (`mut`, existing — seeds `[b"registry"]`)
  - `game: Account<'info, Game>` (`init`, payer = admin, space = `8 + Game::INIT_SPACE`, seeds `[b"game", game_id.as_ref()]`, bump)
  - `mint: Account<'info, Mint>` (`init`, payer = admin, `mint::decimals = 2`, `mint::authority = game`, seeds e.g. `[b"mint", game.key().as_ref()]`, bump — freeze authority left unset; nothing in the PRD calls for freezing)
  - `token_program: Program<'info, Token>`
  - `system_program: Program<'info, System>`
- Instruction args (via `#[instruction(game_id: [u8; 16], name: String, username: String)]`): `game_id`, `name`, `username` (needed to derive `creator_user`'s seeds).
- Handler:
  1. `require!` name's UTF-8 byte length within `MIN_GAME_NAME_BYTES..=MAX_GAME_NAME_BYTES` and charset (Unicode letters/numbers/space) — `ErrorCode::InvalidGameNameLength`.
  2. `require!` `registry.active_games.len() < MAX_ACTIVE_GAMES` — `ErrorCode::RegistryFull`. (Checked before mutating registry state; since the whole instruction is one atomic transaction, an error here reverts everything, including the just-`init`'d `game`/`mint` accounts — no orphaned accounts, no corrupted registry state.)
  3. Set `game.bump`, `game.mint_bump`, `game.game_id`, `game.name`, `game.mode = GameMode::General`, `game.admin = creator_user.key()`, `game.mint = mint.key()`.
  4. `registry.active_games.push(game.key())`.

**`lib.rs`:** add `create_game(ctx, game_id: [u8; 16], name: String)` dispatching to the new handler; add `mod instructions::game;` wiring alongside existing `registry`/`user`.

### Off-chain (`apps/frontend/src/server`)

**`server/game-id.ts`:**
- `generateGameId(): Uint8Array` — 16 bytes: first 6 bytes = big-endian `Date.now()` (48-bit ms timestamp), next byte = version nibble (`0111`) + 4 random bits, next byte = variant bits (`10`) + 6 random bits, remaining 8 bytes = random, per RFC 9562 §5.7. Uses `crypto.getRandomValues()` (Web Crypto, same runtime-portability reasoning as `session.ts`'s choice in ticket 003 Q6).

**`server/game-name.ts`:**
- `normalizeGameName(input: string): string` — `input.normalize("NFC")` (no case-fold).
- `validateGameName(normalized: string): { valid: true } | { valid: false; reason: string }` — byte length 3–32, charset `/^[\p{L}\p{N} ]+$/u`.

**`server/actions/game.ts`:**
- `createGame({ name }): Promise<{ gameId: string }>` — requires a valid session (re-verifies per ticket 003 Q8's per-action pattern); normalizes/validates name server-side; generates `game_id` via `generateGameId()`; derives the creator's `User` PDA from the session's username, and the `Game`/mint PDAs, via the generated `on-chain-client`; sends `create_game` (accounts per Q11: `admin`, `creator_user`, `registry`, `game`, `mint`, `token_program`, `system_program`) signed by the admin signer; returns the new game's id (hex-encoded for use in a route segment).
- `listMyGames(): Promise<Array<{ gameId: string; name: string }>>` — fetches `Registry`, fetches each `Game` account, derives the current session's `User` PDA (same derivation `auth.ts` already uses), and filters to `game.admin === thatUserPda` (per Q11 — `Game.admin` stores the creator's `User` PDA, not the shared system admin wallet, which is the same signer for every game and useless as a per-creator filter).

### Frontend pages (`apps/frontend/src/app/(app)/games/`)

- `new/page.tsx` — name input (client-side validation reusing `normalizeGameName`/`validateGameName`), "General Mode" label (no selector, Q9), submits to `createGame`, redirects to `/games` on success. Styled per the `Kitty - Glass Vault` reference.
- `page.tsx` — "My Games" list via `listMyGames()`; each entry shows name + an admin badge; empty state links to `/games/new`.

### Testing

- `cargo test`: `Game::INIT_SPACE` sizing guard (mirrors `Registry`/`User`).
- `on-chain-program-e2e` (`anchor test`): `create_game` happy path (asserts `Game` fields, mint decimals/authority, registry entry appended); name below/above byte bounds rejected with `InvalidGameNameLength`; name with disallowed characters rejected; registry-full case (fill to `MAX_ACTIVE_GAMES`, assert the next `create_game` fails with `RegistryFull` and leaves registry/accounts untouched).
- Frontend vitest (colocated): `game-id.test.ts` (16-byte length, version/variant nibbles correct, monotonic-ish timestamp ordering across calls, uniqueness across many calls); `game-name.test.ts` (mirrors `username.test.ts`'s cases minus case-folding); `actions/game.test.ts` (create happy path, invalid name rejected before any on-chain send, unauthenticated rejected); page tests for `new` and the list.
- `apps/e2e` Playwright: log in → create game with a valid name → redirected to `/games` → new game visible with admin badge; creating with an invalid name shows a client-side error and never navigates away.
- Manual verification against the local docker-compose/Surfpool stack before marking done, per this repo's Done-Means rule.

---

## Self-review

- No placeholders/TBDs remain — every field on `Game`, the mint's authority/decimals, the token program choice, name validation bounds/charset, UUID generation strategy, `Game.admin`'s actual meaning, and the post-creation UI surface are all concrete decisions with stated reasoning.
- Internally consistent: the "defer visibility/player-list to 007/006" calls (Q3/Q4) are checked against the "pre-declare mode now" call (Q2) and don't contradict — the distinguishing factor (explicitly asked for by *this* ticket vs. not) is stated directly rather than left implicit. Q11 resolves a real internal-consistency gap (custodial no-wallet model vs. a naive "admin pubkey" field) as an explicit, user-confirmed decision rather than an assumption buried in prose.
- Scope: single ticket — on-chain `Game` account + `create_game` instruction + mint creation, off-chain UUID/name-validation utilities, creation form + "My Games" list. Does not reach into joining, private-game passwords, deposits/minting-to-players, or closing — correctly deferred per Q3/Q4/Q9.
- No requirement reads two ways: "the game appears in their own game list" is now pinned to a concrete page (Q8) and a concrete comparison (`Game.admin` == creator's `User` PDA, per Q11), closing an ambiguity a naive reading (comparing against a nonexistent per-user wallet) would have hit during implementation.
