## Context

Tickets 005 (create game) and 006 (join public game) and change `remove-noop-relocate-dashboard` (019) have all shipped. No prior ticket owned assembling the mockup's Home dashboard or the Home/Browse/You bottom nav — ticket 017 explicitly deferred nav/tab-bar to whichever ticket first needed it. Ticket 006 shipped without a `players: Vec<Pubkey>` field on `Game` (the field this design originally assumed) — actual player membership is determined by ATA-existence per game, the same pattern `listBrowseGames`'s `isMember` already uses. Ticket 006 also shipped a per-game detail page at `/games/[address]` (used by `BrowseGameRow` for joined games), which this design originally assumed didn't exist yet.

Full grill session and decision rationale: [docs/superpowers/specs/2026-07-26-home-dashboard-nav-account-design.md](../../../docs/superpowers/specs/2026-07-26-home-dashboard-nav-account-design.md).

## Goals / Non-Goals

**Goals:**
- Home (`/`) lists every game the user belongs to (player or admin), each row showing name/mode and the user's own balance in that game's mint, with an admin badge where applicable.
- A persistent bottom nav (Home / Browse / You) rendered unconditionally on every `(app)` page.
- A minimal Account ("You") screen: avatar/initials, username, game count, logout button.
- Delete the now-superseded `/games` admin-only list page.
- Home rows link to the existing per-game detail page (`/games/[address]`, shipped by ticket 006).

**Non-Goals:**
- No aggregate "total balance" across games (each game's SPL mint is independent — a cross-mint sum has no real meaning).
- No delete-account/danger-zone UI on the Account screen (ticket 012 adds this later).
- No new per-game detail page is built here — ticket 006 already shipped `/games/[address]`; this change only links Home's rows to it.
- No placeholder `/browse` route — the nav's Browse tab links directly to ticket 006's `/games/all` route.

## Decisions

- **Membership semantics**: Home lists games where the user is a player or admin, not just admin-owned games. Since `Game` has no `players` array, player membership is determined by an ATA-existence check per active game — compute the user's ATA address for the game's mint and check existence via batched `getMultipleAccounts`, the same pattern `listBrowseGames`'s `isMember` already uses (not `fetchGameDetail`'s heavier token-program-wide holder scan, which isn't needed here since we only need one specific ATA's existence/balance per game). Today's `/games` (admin-only, ticket 005 Q8) is deleted once Home ships — 018 is the natural successor, not a parallel page.
- **Admin without an ATA still shows, with balance 0**: ticket 021 ("auto-join admin as player at game creation") hasn't shipped, so a freshly created game's admin may have no ATA yet. The admin's own game still appears on Home (per the "player or admin" rule above), showing a balance of `0` when no ATA exists. This self-corrects once 021 ships or the admin manually joins.
- **No aggregate balance**: each `Game` owns its own independent SPL mint (architecture Q9); summing raw amounts across mints produces a number with no real meaning. Dropped entirely, even though the UI mockup shows one.
- **Nav renders on every `(app)` page, not just the 3 tab screens**: simplicity — a persistent nav that's always present is a strict subset of the mockup's screen-conditional visibility (never hidden when it should show) and costs nothing structurally. The nested-route-group approach (to scope the nav to only 3 screens) was considered and explicitly deferred.
- **Browse links directly to ticket 006's `/games/all`**: no placeholder was needed since 006 shipped before this change was implemented.
- **Account screen excludes delete-account**: ticket 012 (delete account) is blocked by a long chain (003, 011 ← 009 ← 008 ← 006). Requiring 018 to include delete-account UI would transitively block the whole nav/dashboard ticket on nearly the entire remaining backlog. Matches the "extend this same page later" pattern already used for 005→006.
- **Account screen's game count reuses `listMyMemberGames()`**: takes `.length` of the same result Home renders, rather than a separate lightweight count-only action — one membership code path to maintain; the extra balance-fetch cost is negligible at this app's scale (max 20 players/game).
- **Avatar is initials-only**: a CSS circle showing the first letter(s) of the username. No image upload exists anywhere in this app, so there's nothing else to render.
- **Home rows are interactive, linking to `/games/[address]`**: ticket 006 already shipped this detail page (used by `BrowseGameRow` for joined games) — building non-interactive rows on purpose would reintroduce a gap that's already closed. Overturns this design's original Q6 call, which assumed the detail page didn't exist yet.
- **Extract `gameModeLabel` to `lib/game-mode.ts`**: the mode-label switch is already duplicated in `BrowseGameRow.tsx` and `games/[address]/page.tsx`; Home's row needs the same mapping. Extracting now (and updating both existing call sites) avoids adding a third copy-paste. Small, low-risk pure-function move.

## Risks / Trade-offs

- [Deleting `/games` removes the only admin-filtered view] → Mitigated: the admin badge on Home rows preserves the same information (which games the user administers), just merged into the fuller membership list rather than a separate page.
- [Extracting `gameModeLabel` touches two existing files (`BrowseGameRow.tsx`, `games/[address]/page.tsx`) outside this change's original file list] → Accepted: it's a pure-function move with no behavior change, low risk relative to the duplication it removes.
- [Admin rows showing balance 0 before the admin has joined as a player could read as a bug rather than expected state] → Accepted trade-off: matches the "player or admin" membership rule; resolves itself once ticket 021 (auto-join admin) ships or the admin manually joins.

## Migration Plan

1. ~~Land change `remove-noop-relocate-dashboard` (019)~~ — done; `/` is the dashboard location.
2. ~~Land ticket 006 (join public game)~~ — done; supplies the ATA-existence membership pattern and the Browse route target (`/games/all`).
3. Extract `lib/game-mode.ts`; update `BrowseGameRow.tsx` and `games/[address]/page.tsx` to use it.
4. Add `listMyMemberGames()` to `server/actions/game.ts`.
5. Rewrite `apps/frontend/src/app/(app)/page.tsx` as the Home dashboard (rows link to `/games/[address]`); delete `apps/frontend/src/app/(app)/games/page.tsx` and its test.
6. Add the bottom-nav component to `apps/frontend/src/app/(app)/layout.tsx`.
7. Add `apps/frontend/src/app/(app)/account/page.tsx`.

No rollback beyond standard revert — no on-chain state changes involved (frontend-only UI assembly).

## Open Questions

None — all branches resolved during the grill session referenced above.
