## Context

`Game` (005) currently has no notion of players at all — only an `admin: Pubkey`. Architecture decision Q15-17 already settled that game membership should be tracked implicitly via a player's per-game Associated Token Account (ATA) existence/balance, not a separate on-chain list, to avoid duplicate bookkeeping that can drift out of sync.

This ticket needs two things that don't fall out of pure ATA-existence tracking for free: an on-chain 20-player cap check, and a cheap way for a browse page to show each game's current player count without an RPC scan per game. It also needs a real per-game roster view (username + balance per player) — a grill session with the user confirmed this reading of "player list visible to all current players," beyond what the ticket's literal wording alone implied.

Full grill-session record (superseded as the spec-of-record by this openspec change, but kept for its reasoning): `docs/superpowers/specs/2026-08-06-join-game-public-design.md`.

## Goals / Non-Goals

**Goals:**
- Let a logged-in user join any active public game as a player, capped at 20 players, rejecting a duplicate join with a dedicated error.
- Let any logged-in user browse active public games with an accurate per-game player count.
- Let a player (or anyone browsing) view a game's player roster with usernames and balances.

**Non-Goals:**
- Admin auto-joining their own game at creation time (ticket 021).
- Any detail-page functionality beyond the read-only roster/balance view — no transfers (009), quit (011), admin controls (008/010), or activity log (no ticket owns this; deferred indefinitely).
- Private games / password gating (007) — every game reachable by this ticket is implicitly public, since no visibility field exists yet.
- A browse-page search/filter box — not asked for by the ticket's acceptance criteria.

## Decisions

### `player_count: u8` on `Game`, not a `Vec<Pubkey>` roster
A scalar counter, incremented atomically by `join_game` in the same instruction that creates the membership-proving ATA, so it can't drift the way a duplicated pubkey list could. Gives `join_game` a cheap in-instruction cap check and gives the browse page a free per-game count from the same `Game` fetch it already needs — no extra RPC calls, no reopening of Q4's scan-aversion stance. The actual roster (who, and their balance) stays derived off-chain from ATA state, preserving the "ATA is the membership record" principle; `player_count` is a derived cardinality cache of that fact, not a second copy of it.

*Alternative considered:* a `Vec<Pubkey>` player list (this is what 005's own design doc originally speculated 006 would add). Rejected — reintroduces exactly the duplicate-bookkeeping risk Q15-17 was written to avoid, for no benefit `player_count` doesn't already provide.

### ATA ownership: `authority = joining player's User PDA`
Matches the existing convention (`Game.admin` already stores a creator's `User` PDA address, not a wallet keypair — none exists in this custodial model). Verified against ticket 010 (admin transfer): `Game.admin` and player membership are decoupled axes, so this choice doesn't complicate that later instruction — transfer is a plain field write gated by requiring the new admin's ATA already exist.

### Dedicated `AlreadyJoinedGame` error, not a generic Anchor `init` failure
`join_game` does not use Anchor's declarative `#[account(init, associated_token::...)]` for the player's ATA — that surfaces a raw system/token-program error on a second join. Instead the ATA is taken as an unchecked/mutable account at its deterministic address; the handler explicitly checks whether it's already initialized (`data_is_empty()`) and `require!`s a custom `ErrorCode::AlreadyJoinedGame` before manually CPI-ing the Associated Token Program's `create` instruction.

### Per-game roster via bounded, mint-filtered `getProgramAccounts`
`getProgramAccounts(TOKEN_PROGRAM)` filtered by `dataSize = 165` + `memcmp(offset: 0, bytes: game.mint)` returns exactly that game's token accounts (bounded ≤20 by the player cap), each giving `owner` (a `User` PDA) and `amount`. Owners are then batch-resolved to usernames via one `getMultipleAccounts` call. This is the same query shape block explorers use for "holders of token X" — tightly bounded and exact-match filtered, unlike the unfiltered/global scan architecture Q4 rejected for game *discovery*. The browse page's per-row Join/Open affordance uses the same bounded-batch principle: one `getMultipleAccounts` call across all active games' derived ATA addresses for the viewer, not a scan.

### New routes: `/games/all` and `/games/[address]`
`/games` (005's admin-only "My games" list) stays untouched rather than being repurposed now — that would overwrite shipped, tested behavior ahead of ticket 018's own planned consolidation of these pages into a unified dashboard + nav.

### 005 touched minimally, not reworked
`create_game`'s handler gains exactly one line (`game.player_count = 0`). No other change to that already-shipped, already-tested instruction. Admin auto-join is deliberately deferred to a new ticket (021) rather than bundled here.

## Risks / Trade-offs

- **`Game` account layout change** → any `Game` accounts already created on local Surfpool/devnet during 005's testing won't deserialize against the new layout. Mitigation: reset local validator state and redeploy to devnet fresh before/during this ticket's verification (confirmed with the user — no persisted state needs to survive).
- **New frontend dependency likely needed** for deriving/creating an ATA client-side (nothing in `apps/frontend`/`apps/on-chain-client` today provides this beyond bare `@solana/kit`). Mitigation: confirm the exact package during implementation and flag it for install-approval before adding, per repo policy — do not guess now.
- **`getProgramAccounts` reliance** → if the target RPC provider (public devnet endpoint) throttles or restricts `memcmp`-filtered scans more aggressively than expected, the roster/browse-membership queries could get slow or fail. Mitigation: the queries are already as narrow as this API allows (exact `dataSize` + single `memcmp` on `mint`, bounded to ≤20 or ≤128 results); if this becomes a real problem in practice, the fallback is promoting `player_count`'s pattern further (e.g., a bounded on-chain roster) — not something to speculatively build now.

## Migration Plan

No production data exists yet (devnet-only, pre-launch). Deploy: reset local Surfpool state, rebuild/redeploy the on-chain program (new `Game` layout, new `join_game` instruction), regenerate `on-chain-client` from the updated IDL, redeploy to devnet. No rollback complexity beyond redeploying the prior program build if needed — no user-facing data to preserve across the change.
