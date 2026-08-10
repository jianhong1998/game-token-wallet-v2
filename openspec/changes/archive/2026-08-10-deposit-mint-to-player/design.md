## Context

`create_game` mints the creator's own zero-balance ATA and `join_game` creates a joining player's zero-balance ATA — no instruction exists yet that puts a positive balance into circulation. Real-world flow: a player hands the admin offline cash; the admin needs an on-chain action that credits that player's balance by an arbitrary, admin-chosen amount. Resolved via a grilling session on ticket 008 (docs/tickets/008-deposit-mint-to-player.md); decisions below are final, not open.

The custodial signing model (every tx signed by the single system admin wallet) means "restricted to the game's admin" cannot be a transaction-signer check — every tx signer is the same key regardless of which end user is acting. It must be an on-chain identity check against state (`Game.admin`), the same pattern `join_game`/`create_game` already use for their own `user` account.

## Goals / Non-Goals

**Goals:**
- A `mint_to_player` instruction that only the game's recorded admin can successfully invoke, minting an arbitrary admin-chosen amount into an existing player's ATA.
- An admin-only deposit form reachable from `/games/[address]`, matching the "Admin controls" modal pattern in `docs/technical-related/ui-design/004-ui-sample/Kitty - Glass Vault.dc.html`.
- Both the admin's own post-deposit view and the target player's next page load reflect the new balance.

**Non-Goals:**
- Any conversion-rate/FX concept between offline cash and tokens (admin-discretionary amount, full stop).
- Auto-joining a non-member player as a side effect of depositing.
- Live/push balance updates for a player already looking at the page while the deposit happens (no websocket/polling).
- Building the modal's "Transfer admin role" or "Close game" sections (tickets 010, 013) — only the deposit sub-form.
- Any change to private-game/password logic (ticket 007).

## Decisions

### On-chain: identity check, not signer check
`mint_to_player`'s `Accounts` struct takes `admin: Signer<'info>` (the system wallet — kept for consistency with `create_game`/`join_game`'s existing naming and Codama same-seed canonicalization) and `user: Account<'info, User>` (the acting caller's own PDA, seeds `[b"user", username, admin.key()]`). The handler asserts `user.key() == game.admin`, rejecting with `NotGameAdmin` otherwise. This mirrors `join_game`'s `require_keys_eq!` pattern for `player_ata` validation — checking derived/stored state rather than trusting a signer, since the signer is always the same key.

Alternative considered: adding a `has_one = admin` constraint directly on `Game`. Rejected — `Game.admin` stores a `User` PDA address, not the system wallet's address, and the constraint macro compares against the *account* field's key, so this needs to be `user`, not `admin`, in the constraint (or an explicit `require_keys_eq!` in the handler body, chosen here to keep it next to the other handler-body checks like `join_game.rs` already does for `player_ata`).

### Target player identified by a second `User` PDA, not by ATA address alone
New fields: `player_user: Account<'info, User>` + `player_username: String` instruction arg (target's `User` PDA, seeds `[b"user", player_username, admin.key()]`), plus `player_ata` (target's ATA for the game's mint). Two reasons to route through a second `User` account rather than trusting a client-supplied ATA address directly:
1. Consistency with `join_game`'s existing `get_associated_token_address(user, mint)`-derivation-then-compare pattern (defense against a malformed/wrong ATA address).
2. The field can't be named `user` (Anchor forbids duplicate accessor names within one `Accounts` struct, and the admin's own PDA already claims `user`) — `player_user` follows the same `player_`-prefix convention `join_game.rs` already uses for `player_ata`.

### Deposit requires an existing ATA — no auto-join
The instruction requires `player_ata` to already be initialized (owned by the token program, correct mint/owner) and rejects with `PlayerNotInGame` if not. Alternative considered: auto-create the ATA (auto-join) if missing, folding join+deposit into one instruction. Rejected — conflates two separate concerns (membership vs. funding), and there's no product requirement for "deposit implies join"; the frontend's player picker only ever offers existing roster members anyway, so this is a defense-in-depth on-chain-only path in practice.

### Frontend: client-component modal + `router.refresh()`, not a new query layer
`/games/[address]/page.tsx` is currently a plain async Server Component (no TanStack Query, unlike ticket 006's browse/roster pages). Rather than introducing a client-side query layer just for this one feature, the admin-controls button + modal becomes a small client-component island; on successful `depositToPlayer` Server Action call it invokes `router.refresh()`, which re-runs the server component and re-fetches `fetchGameDetail()` with fresh on-chain state. This keeps the page's data-fetching model consistent (still server-driven) while giving the admin an immediate updated view. The target player, if not currently on the page, simply sees the correct balance whenever they next load/navigate there — `fetchGameDetail()` already reads live on-chain state on every call, so no caching/invalidation problem exists on their side.

### Amount unit conversion lives in the Server Action, not the on-chain program
The mint's 2 decimals are already the display convention (`balance / 100` in `fetchGameDetail`/`listMyMemberGames`). The deposit form takes whole-token input (e.g. "5.00"); the Server Action multiplies by 100 (rounding to the nearest integer base unit) before building the instruction, matching how `on-chain-program` never sees decimal-aware logic anywhere else in the codebase — decimals are purely a display/input-parsing concern client-side.

## Risks / Trade-offs

- [Two-`User`-account instruction increases account count / tx size slightly versus a single-target design] → Within Solana's per-tx account limits by a wide margin (this instruction has ~7 accounts total, same order of magnitude as `join_game`); no chunking concern like the multi-recipient transfer case.
- [Client-side amount→base-units conversion could round unexpectedly for unusual decimal input] → `Number.parseFloat` + round-to-nearest-integer-cent is the same approach already implicit in the codebase's `/100` display convention; add a unit test for boundary cases (e.g. "0.005") during implementation.
- [`router.refresh()` reloads the whole server component tree, not just the balance] → Acceptable; this page is already a full-page fetch on every navigation, and `fetchGameDetail()` is a single batched RPC path (`getProgramAccounts` + `fetchAllUser`), not an expensive multi-round-trip one.
