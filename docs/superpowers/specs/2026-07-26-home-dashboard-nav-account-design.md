# 018 — Home dashboard, bottom nav, and account screen — Design

Spec for [docs/tickets/018-home-dashboard-nav-account.md](../../tickets/018-home-dashboard-nav-account.md). Blocked by 005 (create game, done), 006 (join game public, not yet built), and 019 (remove no-op scaffolding, relocate dashboard to `/`, not yet built). This design assumes 006 lands first, since it adds `players: Vec<Pubkey>` to `Game` and creates the joining player's ATA that Home's per-game balance reads from — and assumes 019 lands first, since it moves the app's root from a no-op connectivity demo to the dashboard location this ticket builds at. Closes a gap identified when comparing shipped tickets 005/006 against the full-app design mockup ([004-ui-sample/Kitty - Glass Vault.dc.html](../../technical-related/ui-design/004-ui-sample/Kitty%20-%20Glass%20Vault.dc.html)) — no prior ticket owned assembling the mockup's Home dashboard or the Home/Browse/You bottom nav (017 explicitly deferred nav/tab-bar to whichever ticket first needed it, and none had until now).

**Note (amended after ticket 019 was scoped):** this design originally targeted `/home` as the dashboard route. Ticket 019 relocates the app's root (`/`) from a leftover connectivity demo to the dashboard, so every `/home` reference below now means `/`. Amending here rather than building at `/home` and moving it, since nothing in this design had been implemented yet.

---

## Grill session — decisions

### Q1: What does "Your games" on the Home dashboard list — admin-only, or every game the user belongs to?

**Answer:** Every game the user belongs to, as player or admin.

**Decision:** Home lists games where the current user is a player (per ticket 006's `players: Vec<Pubkey>`) or admin (`Game.admin`), each row showing the user's own balance in that game's mint. Today's `/games` page (admin-only filter, ticket 005 Q8) is deleted once Home ships.

**Reason:** The mockup's Home screen shows a per-game balance next to each row — that's only meaningful for games the user actually holds tokens in, i.e. games they've joined. Ticket 005's `/games` page only filtered by `admin` because at the time no player list existed (005 Q4). Extending to full membership makes 018 the natural successor to `/games`, not a parallel page — hence deleting `/games` rather than keeping both.

### Q2: Does Home show an aggregate "Total balance" across all games, per the mockup?

**Answer:** No.

**Decision:** Dropped entirely. Home goes straight from the header to the "Your games" list — no cross-game sum anywhere.

**Reason:** Each `Game` owns its own independent SPL mint (architecture Q9) — tokens from different games are not fungible. Summing raw amounts across mints produces a number with no real meaning (50 chips in one game plus 50 in another isn't "100" of anything). The mockup's total-balance card predates that architecture decision being locked in, so it doesn't get carried into this implementation.

### Q3: Does the bottom nav (Home/Browse/You) only render on the 3 tab screens (matching the mockup's `showNav` logic), or on every `(app)` page?

**Answer:** Every `(app)` page.

**Decision:** Nav bar lives in the existing `(app)/layout.tsx`, unconditionally rendered — no nested route group to scope it to just the 3 tab screens, no back-arrow-only variant for `/games/new` or future game-detail pages.

**Reason:** Simplicity. The mockup's screen-conditional nav visibility is a polish detail, not a functional requirement — a persistent nav that's always present is a strict subset of the mockup's behavior (never hidden when it should be shown) and costs nothing structurally. The nested-route-group approach was considered and explicitly deferred rather than built now.

### Q4: Is 018 blocked by ticket 006 for the "Browse" nav tab, or does 018 build a placeholder `/browse`?

**Answer:** Blocked by 006.

**Decision:** No placeholder built. 018's nav links "Browse" to wherever ticket 006 builds its public-games page; 018 cannot ship its nav correctly until 006 exists. Same underlying dependency already established by Q1 (player-membership data also requires 006).

**Reason:** Building a placeholder Browse tab that 006 immediately has to replace is wasted work with no decoupling benefit — 018 already can't ship a correct Home list without 006's player-list data, so gating the nav on the same ticket adds no new sequencing cost.

### Q5: Does the Account ("You") screen include the mockup's "Delete account" danger-zone section?

**Answer:** No.

**Decision:** 018 builds only the identity block (avatar/initials, username, count of games) and a logout button. The danger-zone/delete-account section is added later, by ticket 012, extending this same page.

**Reason:** Ticket 012 (delete account) is blocked by 003 and 011, and 011 is itself blocked by 009 → 008 → 006 — a long chain. Requiring 018 to include delete-account UI would transitively block the entire nav/dashboard ticket on nearly the whole remaining backlog, defeating the purpose of shipping 018 soon to close the current UI gap. Matches the "extend this same page later" pattern already used for 005→006 (005 Q8).

### Q6: Are Home's game-list rows tappable, linking to a per-game detail page?

**Answer:** No — non-interactive for now.

**Decision:** Rows show name, mode, balance, and admin badge where applicable, but have no `onClick`/navigation. A `/games/[gameId]` detail page is tracked as a separate future ticket, blocked by 018, which will make these rows interactive.

**Reason:** No existing ticket claims a per-game detail route — it's implicitly something 008/009/010/011/013 would each extend as they land. Building a stub detail page inside 018 was considered, but non-interactive rows now plus a dedicated future ticket for the interactive page keeps 018's scope to exactly what it already owns (the list/dashboard), rather than also owning the first cut of a page whose real content belongs to later tickets.

---

## Design

*(Structural sketch based on the decisions above — file-by-file implementation detail is for the writing-plans step.)*

- `apps/frontend/src/app/(app)/page.tsx` (the app root, `/`, per ticket 019) — rewritten: fetches games where the current user is player or admin (extends the `listMyGames`-style server action to use ticket 006's player list), renders each as a row (name, mode, balance, admin badge where `Game.admin` matches), empty state with Create/Browse actions. Replaces the placeholder content ticket 019 relocates there (welcome message + logout button).
- `apps/frontend/src/app/(app)/games/page.tsx` and its colocated test — deleted. `apps/frontend/src/app/(app)/games/new/` (create form) — unchanged, still linked from Home's "Create" action.
- `apps/frontend/src/app/(app)/account/page.tsx` — new: avatar/initials, username, game count, logout button (reuses existing `LogoutButton`).
- `apps/frontend/src/app/(app)/layout.tsx` — adds a bottom nav bar component (new in `components/`) linking Home / Browse / You, rendered unconditionally for the whole `(app)` group.
- Nav's "Browse" link points at ticket 006's route (exact path owned by 006).

---

## Self-review

- Decisions cover every scope boundary raised during grilling: membership semantics (Q1), aggregate balance (Q2), nav scope (Q3), Browse dependency (Q4), Account screen contents (Q5), row interactivity (Q6).
- Internally consistent: Q1 and Q4 both resolve to "blocked by 006" for related but distinct reasons (data need vs. nav-link target), stated separately rather than conflated.
- Follows the same deferral pattern already established in ticket 005 (extend-this-page-later) for Q5 and Q6, rather than inventing a new convention.
- Scope: dashboard list + nav + minimal account screen only. Does not reach into per-game detail, delete-account UI, or Browse's own content — correctly deferred per Q4/Q5/Q6.
