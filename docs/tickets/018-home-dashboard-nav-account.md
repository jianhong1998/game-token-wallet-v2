# 018 — Home dashboard, bottom nav, and account screen

**What to build:** Replace the placeholder `/` dashboard page and the admin-only `/games` list with a unified Home dashboard, a persistent bottom nav (Home / Browse / You), and a minimal Account ("You") screen — closing the gap between the shipped tickets (005, 006) and the full-app UI design ([001-full-app-design.md](../technical-related/ui-design/001-full-app-design.md)), which no prior ticket owned (017 explicitly deferred the nav).

**Blocked by:** 005, 006, 019

**Status:** ready-for-agent

**Spec:** [2026-07-26-home-dashboard-nav-account-design.md](../superpowers/specs/2026-07-26-home-dashboard-nav-account-design.md)

**Plan:** [2026-08-08-home-dashboard-nav-account.md](../superpowers/plans/2026-08-08-home-dashboard-nav-account.md)

- [ ] `/` (the app root, per ticket 019) becomes the dashboard: lists every game the current user belongs to, as player or admin (per ticket 006's player list), each row showing the game's name/mode and the user's own token balance in that game's mint.
- [ ] Rows for games where `Game.admin` matches the current user additionally show an "Admin" badge.
- [ ] No aggregate "total balance" figure — each game has its own independent SPL mint (non-fungible across games), so no cross-game sum is shown.
- [ ] Existing `/games` (admin-only list) page is deleted. `/games/new` (create form) is unchanged and still reachable via a "Create" action from Home.
- [ ] Persistent bottom nav (Home / Browse / You) added to the `(app)` route group layout, rendered on every `(app)` page.
- [ ] "Browse" nav tab links to ticket 006's public-games page (route and content owned by 006, not built here).
- [ ] New Account ("You") page: avatar/initials, username, count of games the user belongs to, and a logout button. No delete-account/danger-zone section — ticket 012 extends this same page with that later.
- [ ] Game rows on Home are non-interactive for now (no per-game detail page yet — tracked as a separate future ticket, blocked by this one).
- [ ] Empty state (user belongs to no games) shows a message plus a way to Create or Browse.
