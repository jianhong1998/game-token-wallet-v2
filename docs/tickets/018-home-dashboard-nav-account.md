# 018 — Home dashboard, bottom nav, and account screen

**What to build:** Replace the placeholder `/` dashboard page and the admin-only `/games` list with a unified Home dashboard, a persistent bottom nav (Home / Browse / You), and a minimal Account ("You") screen — closing the gap between the shipped tickets (005, 006) and the full-app UI design ([001-full-app-design.md](../technical-related/ui-design/001-full-app-design.md)), which no prior ticket owned (017 explicitly deferred the nav).

**Blocked by:** 005, 006, 019

**Status:** Done

**Spec:** [2026-07-26-home-dashboard-nav-account-design.md](../superpowers/specs/2026-07-26-home-dashboard-nav-account-design.md)

**Plan:** [2026-08-08-home-dashboard-nav-account.md](../superpowers/plans/2026-08-08-home-dashboard-nav-account.md)

- [x] `/` (the app root, per ticket 019) becomes the dashboard: lists every game the current user belongs to, as player or admin (per ticket 006's player list), each row showing the game's name/mode and the user's own token balance in that game's mint.
- [x] Rows for games where `Game.admin` matches the current user additionally show an "Admin" badge.
- [x] No aggregate "total balance" figure — each game has its own independent SPL mint (non-fungible across games), so no cross-game sum is shown.
- [x] Existing `/games` (admin-only list) page is deleted. `/games/new` (create form) is unchanged and still reachable via a "Create" action from Home.
- [x] Persistent bottom nav (Home / Browse / You) added to the `(app)` route group layout, rendered on every `(app)` page.
- [x] "Browse" nav tab links to ticket 006's public-games page (route and content owned by 006, not built here).
- [x] New Account ("You") page: avatar/initials, username, count of games the user belongs to, and a logout button. No delete-account/danger-zone section — ticket 012 extends this same page with that later.
- [x] Game rows on Home link to the per-game detail page — ticket 006 had already shipped `/games/[address]` by the time this ticket was implemented, so rows are interactive rather than the originally-scoped non-interactive placeholder (superseding, not deferring, the "future ticket" this line originally anticipated).
- [x] Empty state (user belongs to no games) shows a message plus a way to Create or Browse.

**Verification note:** All ACs confirmed via 3 live-browser verification rounds (Playwright MCP) + 2 code-review rounds (2 issues fixed: dead `listMyGames` code removed, `listMyMemberGames`/`listBrowseGames` fetch-pipeline duplication deduped into a shared helper) + full `just lint`/`just typecheck`/`just test` green, including `apps/on-chain-program-e2e` and the Playwright `apps/e2e` suite. Verification round 1 caught a real regression (game-creation flow still redirected to the deleted `/games` route, 404) — fixed and reconfirmed. Final full-suite pass also caught and fixed 3 pre-existing `apps/e2e` specs (`auth.spec.ts`, `game-creation.spec.ts`, `game-joining.spec.ts`) still asserting the old `/games` route and Home-page logout button. Branch: `feat/018-home-dashboard-nav-account`.
