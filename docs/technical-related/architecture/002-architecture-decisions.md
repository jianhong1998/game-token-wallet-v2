# V2 Architecture Decisions

Decision record from the `/grill-me` session that sharpened [001-PRD.md](../../business-related/001-PRD.md) into
buildable architecture, before ticket splitting. V2 is a **new repo**, not a
migration of this codebase — nothing here needs to preserve V1's on-chain
state or account layout, though V1's patterns (PDA seed conventions, SPACE
discriminator handling, `close_*` rent-reclaim instructions) are reused where
they still fit.

Still-open threads that came up during this session but weren't resolved are
tracked separately in [002-pending-discussion.md](../../business-related/002-pending-discussion.md).

---

## Q1: Is the wallet model custodial or does password derive a real signing key?

**Answer:** Custodial. Password is not a signing secret.

**Decision:** User PDA seeds stay exactly as in V1: `["user", username,
system_admin_pubkey]`. The hashed password is stored as a field inside the
`User` account's data, used purely for login/session gating. No client ever
holds or derives a signing keypair; every transaction is signed server-side,
same as V1's `FEE_PAYER` model (renamed conceptually to "system admin
wallet").

**Reason:** The product is for Web3-illiterate users (poker/mahjong night).
A real client-derived wallet (password → keypair) would mean unrecoverable
loss of funds on a forgotten password, and a much larger security surface,
for no product benefit — nobody needs self-custody here.

---

## Q2: Is game/user visibility scoped per-tenant or global?

**Answer:** Moot — multi-tenancy was dropped (see Q3 below). Single global
system admin wallet per deployment; all users/games in that deployment are
visible to each other, full stop.

---

## Q3: Multi-tenancy (PRD General items 5–6) — keep or drop?

**Answer:** Dropped.

**Decision:** One deployment = one system admin wallet, no per-tenant PDA
scoping, no per-tenant registries. PRD General items 5–6 (multi-tenant
self-hosting via distinct system admin wallets under one program deployment)
should be edited down to: "the client server holds a single system admin
wallet that signs all transactions and has control over all accounts."

**Reason:** Multi-tenancy introduced fanout complexity (per-tenant
registries, per-tenant discovery filtering) disproportionate to actual need.
If genuine multi-tenant hosting is wanted later, each tenant can just run
its own program deployment — simpler than one program serving many tenants.

---

## Q4: On-chain discovery — registry account or raw `getProgramAccounts` scans?

**Answer:** Registry account.

**Decision:** A single global `Registry` PDA (`["registry"]`, one per
deployment) holds a bounded list of currently-open game IDs (`Vec<Pubkey>`
capped at a fixed `MAX_ACTIVE_GAMES`), added on `create_game`, pruned on
`close_game`/`delete_game`. "Browse games" becomes one deterministic account
fetch instead of an RPC scan. User lookup by username stays a direct PDA
derivation (no registry entry needed) since the client already knows the
seed formula.

**Reason:** "No additional database" + a <1s response NFR for MY/SG users
rules out `getProgramAccounts` scans — many RPC providers throttle or refuse
unfiltered/discriminator-only scans, and cost grows with total open accounts
regardless of filtering. A bounded registry is the cheap, RPC-friendly
alternative, same category of account as V1's `Pool` used to be (see Q17).

---

## Q5: Scope of "standard Holdem rules" — full betting engine, or pot/token accounting only?

**Answer:** Token/pot accounting only.

**Decision:** The program does not model betting rounds (preflop/flop/turn/
river), turn order, check/call/raise/fold as distinct instructions, or
min-raise validation. Cards and betting decisions happen at the physical
table; the program only needs two primitives — `transfer` (voluntary
contribution to the active pot) and `showhand` (all-in) — plus admin-declared
winners per pot at resolution.

**Reason:** This tokenizes an offline, in-person game. The humans at the
table already enforce turn order and know who folded; encoding a full poker
engine on-chain (hand ranking, betting validation) is scope the PRD never
actually asked for and is a large surface area to get right.

---

## Q6/Q7: Side-pot mechanics — how are side pots created and who is eligible?

**Answer:** Contributor-based eligibility, side pots auto-created on
`showhand`, admin picks winners **per pot** from that pot's contributor list.

**Decision (mechanical rule):**

1. A round has an ordered list of pots; exactly one is "active" (accepting
   contributions) at a time, starting with Pot 0.
2. `transfer(player, amount)` adds to the currently active pot and records
   `player` as a contributor of it.
3. `showhand(player)`:
   - sweeps the player's entire remaining game-token balance into the active
     pot, recording them as a contributor there;
   - marks the player `capped` for the rest of the round;
   - counts remaining **non-capped** players in the round — if ≥2, freezes
     the active pot (no further contributions ever) and opens a new pot as
     the new active one; if ≤1, the active pot stays open.
4. At round resolution, admin names winner(s) **per pot**, chosen only from
   that pot's contributor list (program-enforced membership check — this was
   the deciding simplification over auto-computed threshold-layering). A
   pot's total splits evenly among its named winners.
5. Remainder/odd-chip handling: goes to whichever winner is listed **first**
   in the admin's submitted winner list for that pot (Q9). Deterministic,
   no seating-order concept needed since none exists in this app.
6. Folded players aren't tracked on-chain at all (per Q5) — their
   contributed chips simply stay in whichever pot they were in, and admin
   just never names them a winner. A pot can end up opened-but-empty if the
   only "non-capped" players left had actually folded in real life
   (undetectable on-chain) — harmless, settles at zero.

**Reason:** Reproduces standard cardroom side-pot behavior (a capped player
is only eligible for pots that existed at/before their cap) purely from
event sequence (transfers + showhand calls), without needing to track bet
sizes, turn order, or fold state — consistent with the Q5 scope decision.
Deriving pot boundaries and eligibility mechanically (rather than trusting
admin arithmetic) removes a dispute surface at the table.

---

## Q8: Is a poker round (hand) a persistent on-chain account, or reset in place?

**Answer:** Ephemeral, reset in place.

**Decision:** `Game` holds a single embedded "current round" struct (pot
list, contributors, capped flags). `end_round` pays out winners then resets
that same state for the next hand — no new account per hand, no on-chain
hand-history log.

**Reason:** Matches this codebase's existing philosophy that on-chain state
is disposable/session-scoped, not a permanent ledger. A persistent
per-round account (one PDA per hand) would accrue rent per hand across a
whole poker night, paid for by the system admin wallet, for history value
nobody asked for.

---

## Q9: Odd-chip remainder on uneven pot splits.

**Answer:** First-listed winner in the admin's submitted list for that pot
gets the remainder. Also: **SPL token uses 2 decimals** (not the Solana
default 6/9).

**Reason:** Cheapest deterministic rule; no seating-order concept exists to
do anything more "fair," and remainders are sub-unit dust regardless.

---

## Q10: General Pool Mode (Mode 3) — same eligibility rules as Poker mode?

**Answer:** No. Much simpler: single continuous pool for the game's
lifetime, no rounds, no showhand, no capping, no contributor-eligibility
restriction.

**Decision:** Players `transfer` into the pool whenever. Admin can
`pool_payout(player, amount)` to _any_ player in the game, for any amount up
to the pool balance, at any time, as many times as needed. No fairness
constraint is enforced on-chain — this mode is explicitly admin-discretionary
by design (unlike Poker mode, where contributor-eligibility exists
specifically to remove admin arbitrariness).

**Reason:** PRD text for Mode 3 gives the admin sole authority over payouts
and never mentions rounds/showhand — reading it as "admin is trusted,
full stop" is both simpler and matches what's actually written.

---

## Q11: Quitting mid-round with unresolved pot contributions.

**Answer:** Quit is always allowed; pot contributions are forfeited/left in
the pot, not refunded.

**Decision:** `quit_game` burns the player's remaining wallet balance and
removes them from the player list. Any tokens already sitting in an active
or frozen pot from earlier `transfer`/`showhand` calls stay there
permanently — same as a real-life fold. `end_round`'s winner selection must
validate the named winner is still an **active player** in the game (not
just "was a contributor at some point"), so a departed player can never be
paid out even accidentally.

**Reason:** Mirrors real poker (chips in the pot aren't yours anymore
regardless of what you do next); needs no extra state or guard.

---

## Q12: `close_game` and outstanding pot balances.

**Answer:** `close_game` burns **all** outstanding balances tied to the
game — player wallets _and_ any pot/pool token accounts still holding a
balance — then closes the game's token accounts and mint back to the system
admin (rent reclaimed). No blocking on active-round state; closing is a hard
stop regardless.

**Reason:** Avoids the fund-accounting bug of burning player wallets while
an equal amount sits orphaned in a pot account forever. Reuses the existing
`close_pool.rs`-style pattern, applied to game-scoped accounts.

---

## Q13: Game admin transfer semantics.

**Answer:**

- New admin must already be a player in the game.
- Outgoing admin remains a regular player (not auto-removed).
- Single admin only, no co-admin concept.

**Reason:** Matches PRD phrasing ("transferred to other user in the game",
"game admin can be a player at the same time", singular "the game admin"
throughout).

---

## Q14: Multi-recipient transfers (General Mode) — batched instruction or client-composed?

**Answer:** Client-composed. The on-chain `transfer_token` instruction
handles exactly one recipient (fixed, statically-typed accounts — no
`Vec<Pubkey>` argument, no `ctx.remaining_accounts` looping). "Transfer to
multiple players" is expressed client-side as multiple single-recipient
instructions, chunked across multiple transactions if a batch doesn't fit
within Solana's per-transaction account/byte-size ceiling (all still signed
server-side, so no added UX friction).

**Reason:** Keeps the program instruction simple and safe to audit (fixed
accounts, no dynamic-length remaining-accounts validation, which is an easy
place to introduce a subtle bug). Note: this does **not** raise the
transaction-level ceiling — total unique accounts referenced in one
transaction is roughly the same whether expressed as one instruction with a
`Vec` or N single-recipient instructions. The ceiling is handled by the
client deciding how many instructions fit per transaction, not by the
program.

---

## Q15/Q16/Q17: Account deletion and game-membership tracking.

**Answer:** `delete_user` rejects if the user is still an active player in
any game. Game membership is tracked implicitly via the existence of the
user's per-game token account (ATA) — no separate `active_games` list on
`User`.

**Decision:**

- `join_game` creates the user's ATA for that game's SPL mint; `quit_game`
  burns its balance and closes it (reclaiming rent) — the ATA's
  existence/balance _is_ the membership record, avoiding duplicate
  bookkeeping that could drift out of sync.
- `delete_user` takes the client-supplied list of the user's currently-open
  game ATAs (queried off-chain via `getTokenAccountsByOwner`, since Solana
  programs cannot natively enumerate "all accounts owned by X") as
  `remaining_accounts`, and verifies each has a zero balance before allowing
  deletion.
- This is not airtight enumeration — if the client's off-chain query missed
  an ATA, the program can't detect that independently, leaving a small
  orphaned/dust account. Accepted as fine given the single-trusted-server
  threat model (no adversarial third party can construct a bypassing
  transaction); worst case is wasted rent, not a fund-safety or security
  issue.

**Reason:** Avoids adding and syncing a bounded `active_games: Vec<Pubkey>`
list (with its own cap decision) when the ATA set already encodes the same
information as a natural side effect of the token model.

---

## Q17 (structural): Does V1's `Pool` account carry forward?

**Answer:** No. Retired entirely.

**Decision:** New top-level account set: `Registry` (singleton, discovery
index — Q4), `User` (per-username, holds password hash), `Game` (owns its
own SPL mint + embedded ephemeral round/pot state — Q8). Nothing plays
`Pool`'s old role (mint + pool-token-account owner, one per admin).

**Reason:** V1's `Pool` existed to scope a mint/token-account pair per
admin under the old per-`Pool` token model. V2 mints one SPL token per
_game_ instead (Game Token Module), and multi-tenancy (the other thing
`Pool` implicitly supported) was dropped in Q3 — nothing left needs that
account shape.
