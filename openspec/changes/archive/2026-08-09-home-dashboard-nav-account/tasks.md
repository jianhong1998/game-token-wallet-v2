## 1. Prerequisites

- [x] 1.1 Confirm change `remove-noop-relocate-dashboard` (019) has landed — `/` is the dashboard route and session-gated
- [x] 1.2 Confirm ticket 006 (join public game) has landed — the public-games route (`/games/all`) and per-game detail route (`/games/[address]`) exist. Note: `Game` has no `players: Vec<Pubkey>` field — membership is derived via ATA-existence check instead (see section 2)

## 2. Frontend: server action for membership list

- [x] 2.1 Extend `server/actions/game.ts` with a `listMyMemberGames()`-style action: fetch registry → fetch each game → for each, compute the user's ATA address for that game's mint and batch-check existence via `getMultipleAccounts` (same pattern as `listBrowseGames`'s `isMember`) → include the game if the user is the ATA holder or `Game.admin` → decode the user's balance from the ATA when it exists, else `0`
- [x] 2.2 Unit tests: user with 0 games, user with player-only games, user with admin-only games, user with mixed player+admin games, admin game where the admin has no ATA yet (balance 0), per-game balance resolution — mirroring `actions/game.test.ts`'s existing mocking pattern

## 3. Frontend: Home dashboard page

- [x] 3.0 Extract `lib/game-mode.ts` (`gameModeLabel(mode)`); update `BrowseGameRow.tsx` and `games/[address]/page.tsx` to import it instead of their inline switches
- [x] 3.1 Rewrite `apps/frontend/src/app/(app)/page.tsx`: renders rows (name, mode, balance, admin badge) from `listMyMemberGames()`, each row linking to `/games/[address]`; empty state with Create/Browse actions, "Create" links to `/games/new`
- [x] 3.2 Page tests: renders game rows correctly, admin badge shown only for admin rows, no aggregate balance rendered anywhere, empty state shown when the user has no games, each row links to its game's detail page

## 4. Frontend: delete `/games`

- [x] 4.1 Delete `apps/frontend/src/app/(app)/games/page.tsx` and its colocated test
- [x] 4.2 Confirm `apps/frontend/src/app/(app)/games/new/` is untouched and still reachable from Home's "Create" action

## 5. Frontend: bottom nav

- [x] 5.1 New `components/BottomNav.tsx` (or equivalent): Home / Browse / You tabs, active-tab highlighting based on current route
- [x] 5.2 Wire into `apps/frontend/src/app/(app)/layout.tsx`, rendered unconditionally
- [x] 5.3 "Browse" tab links to ticket 006's public-games route
- [x] 5.4 Component tests: all three tabs render with correct links, active tab reflects current route

## 6. Frontend: Account ("You") page

- [x] 6.1 New `apps/frontend/src/app/(app)/account/page.tsx`: initials-derived avatar circle, username, game count (`listMyMemberGames().length`), logout button (reuses existing `LogoutButton`)
- [x] 6.2 Page tests: renders identity block and game count correctly, logout button present, no delete-account section rendered

## 7. Verification

- [x] 7.1 `just lint && just typecheck` pass with no changes needed
- [x] 7.2 `just test` passes in full
- [x] 7.3 Manual verification against the local docker-compose/Surfpool stack: log in with a user in 0 games → Home empty state; join/create games → Home lists them with correct balances and admin badges (including an admin-only game showing balance 0 before joining); clicking a Home row navigates to `/games/[address]`; bottom nav visible and functional on Home, Browse, and You; You screen shows correct identity/count and logout works; `/games` returns a 404
