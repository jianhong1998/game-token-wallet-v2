## Context

Ticket 005 (create game) shipped; ticket 006 (join public game, adds `players: Vec<Pubkey>` to `Game` and the joining player's ATA) is planned but not yet built. No prior ticket owned assembling the mockup's Home dashboard or the Home/Browse/You bottom nav — ticket 017 explicitly deferred nav/tab-bar to whichever ticket first needed it. This design assumes change `remove-noop-relocate-dashboard` (019) lands first, since it moves the app's root from a no-op connectivity demo to the dashboard location this change builds at, and assumes ticket 006 lands first, since Home's per-game balance and membership list depend on it.

Full grill session and decision rationale: [docs/superpowers/specs/2026-07-26-home-dashboard-nav-account-design.md](../../../docs/superpowers/specs/2026-07-26-home-dashboard-nav-account-design.md).

## Goals / Non-Goals

**Goals:**
- Home (`/`) lists every game the user belongs to (player or admin), each row showing name/mode and the user's own balance in that game's mint, with an admin badge where applicable.
- A persistent bottom nav (Home / Browse / You) rendered unconditionally on every `(app)` page.
- A minimal Account ("You") screen: avatar/initials, username, game count, logout button.
- Delete the now-superseded `/games` admin-only list page.

**Non-Goals:**
- No aggregate "total balance" across games (each game's SPL mint is independent — a cross-mint sum has no real meaning).
- No delete-account/danger-zone UI on the Account screen (ticket 012 adds this later).
- No per-game detail page — Home's rows are non-interactive; a future ticket (blocked by this one) will make them tappable.
- No placeholder `/browse` route — the nav's Browse tab links directly to ticket 006's route, so this change cannot ship correctly before 006 exists.

## Decisions

- **Membership semantics**: Home lists games where the user is a player (ticket 006's `players: Vec<Pubkey>`) or admin (`Game.admin`), not just admin-owned games. Today's `/games` (admin-only, ticket 005 Q8) is deleted once Home ships — 018 is the natural successor, not a parallel page.
- **No aggregate balance**: each `Game` owns its own independent SPL mint (architecture Q9); summing raw amounts across mints produces a number with no real meaning. Dropped entirely, even though the UI mockup shows one.
- **Nav renders on every `(app)` page, not just the 3 tab screens**: simplicity — a persistent nav that's always present is a strict subset of the mockup's screen-conditional visibility (never hidden when it should show) and costs nothing structurally. The nested-route-group approach (to scope the nav to only 3 screens) was considered and explicitly deferred.
- **Blocked by ticket 006 for Browse, no placeholder built**: 018 already can't ship a correct Home list without 006's player-list data, so gating the nav's Browse link on the same ticket adds no new sequencing cost. Building a placeholder Browse tab that 006 immediately replaces would be wasted work.
- **Account screen excludes delete-account**: ticket 012 (delete account) is blocked by a long chain (003, 011 ← 009 ← 008 ← 006). Requiring 018 to include delete-account UI would transitively block the whole nav/dashboard ticket on nearly the entire remaining backlog. Matches the "extend this same page later" pattern already used for 005→006.
- **Home rows non-interactive for now**: no existing ticket claims a per-game detail route. A stub detail page inside 018 was considered and rejected — non-interactive rows now plus a dedicated future ticket keeps 018's scope to exactly the list/dashboard.

## Risks / Trade-offs

- [Deleting `/games` removes the only admin-filtered view] → Mitigated: the admin badge on Home rows preserves the same information (which games the user administers), just merged into the fuller membership list rather than a separate page.
- [Non-interactive rows may feel like a regression vs. the mockup] → Accepted trade-off: keeps this change's scope to list/nav/account only; a follow-up ticket (blocked by this one) owns the detail page.
- [Blocked by ticket 006, which is not yet implemented] → Sequencing risk only, not a design risk: documented explicitly in `Blocked by` rather than worked around with a placeholder.

## Migration Plan

1. Land change `remove-noop-relocate-dashboard` (019) first — establishes `/` as the dashboard location.
2. Land ticket 006 (join public game) — supplies `players: Vec<Pubkey>` and the Browse route target.
3. Rewrite `apps/frontend/src/app/(app)/page.tsx` as the Home dashboard; delete `apps/frontend/src/app/(app)/games/page.tsx` and its test.
4. Add the bottom-nav component to `apps/frontend/src/app/(app)/layout.tsx`.
5. Add `apps/frontend/src/app/(app)/account/page.tsx`.

No rollback beyond standard revert — no on-chain state changes involved (frontend-only UI assembly).

## Open Questions

None — all branches resolved during the grill session referenced above.
