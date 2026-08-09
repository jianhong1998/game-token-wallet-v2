## Why

Tickets 005 (create game) and 006 (join public game) are shipped, but no ticket owns assembling them into the actual app UI: a Home dashboard listing the user's games, a persistent bottom nav, and an account screen. Ticket 017 explicitly deferred the nav/tab-bar to whichever ticket first needed it. This closes that gap, matching the full-app UI design ([001-full-app-design.md](../../../docs/technical-related/ui-design/001-full-app-design.md)).

## What Changes

- `/` (relocated by change `remove-noop-relocate-dashboard`) becomes the Home dashboard: lists every game the current user belongs to as player or admin, each row showing the game's name/mode and the user's own token balance in that game's mint, with an "Admin" badge where `Game.admin` matches the current user.
- No aggregate "total balance" figure across games — each game has its own independent SPL mint.
- **BREAKING**: existing `/games` (admin-only list) page is deleted; `/games/new` (create form) is unchanged and still reachable via a "Create" action from Home.
- Persistent bottom nav (Home / Browse / You) added to the `(app)` route group layout, rendered unconditionally on every `(app)` page.
- "Browse" nav tab links to ticket 006's public-games page (route/content owned by 006).
- New Account ("You") page: avatar/initials, username, count of games the user belongs to, and a logout button. No delete-account/danger-zone section (ticket 012 extends this page later).
- Home's game rows are interactive: each links to the per-game detail page (`/games/[address]`, shipped by ticket 006).
- Empty state (user belongs to no games) shows a message plus a way to Create or Browse.

## Capabilities

### New Capabilities
- `home-dashboard`: the `/` game list (membership-based, per-game balance, admin badge, empty state), the persistent Home/Browse/You bottom nav, and the Account ("You") screen.

### Modified Capabilities
(none — no existing `openspec/specs/` capability's requirements change; this assembles new UI on top of the `user` and future `game`/`registry` capabilities without altering their requirements)

## Impact

- Affected frontend: `apps/frontend/src/app/(app)/page.tsx` (rewritten — Home dashboard), `apps/frontend/src/app/(app)/games/page.tsx` (deleted, plus colocated test), `apps/frontend/src/app/(app)/account/page.tsx` (new), `apps/frontend/src/app/(app)/layout.tsx` (adds bottom nav), new `components/` bottom-nav component, new `lib/game-mode.ts` (mode-label util, extracted from the duplicated switch in `BrowseGameRow.tsx` and `games/[address]/page.tsx`, both updated to import it).
- Built on ticket 006 (join public game, shipped): `Game` has no `players: Vec<Pubkey>` field, so membership is determined by ATA-existence checks per game — the same pattern `listBrowseGames`'s `isMember` already uses — not by reading a players array. The "Browse" route target is 006's `/games/all`.
- Built on change `remove-noop-relocate-dashboard` (019, shipped), which relocated the dashboard placeholder to `/`.
