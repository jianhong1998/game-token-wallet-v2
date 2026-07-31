## 1. Prerequisites

- [ ] 1.1 Confirm change `remove-noop-relocate-dashboard` (019) has landed — `/` is the dashboard route and session-gated
- [ ] 1.2 Confirm ticket 006 (join public game) has landed — `Game.players: Vec<Pubkey>` and the public-games route exist

## 2. Frontend: server action for membership list

- [ ] 2.1 Extend `server/actions/game.ts` with a `listMyMemberGames()`-style action: fetch registry → fetch each game → filter to games where the current session's `User` PDA is in `players` or matches `admin` → resolve the user's ATA balance per matching game
- [ ] 2.2 Unit tests: user with 0 games, user with player-only games, user with admin-only games, user with mixed player+admin games, per-game balance resolution — mirroring `actions/game.test.ts`'s existing mocking pattern

## 3. Frontend: Home dashboard page

- [ ] 3.1 Rewrite `apps/frontend/src/app/(app)/page.tsx`: renders rows (name, mode, balance, admin badge) from `listMyMemberGames()`, empty state with Create/Browse actions, "Create" links to `/games/new`
- [ ] 3.2 Page tests: renders game rows correctly, admin badge shown only for admin rows, no aggregate balance rendered anywhere, empty state shown when the user has no games, rows have no click/nav handler

## 4. Frontend: delete `/games`

- [ ] 4.1 Delete `apps/frontend/src/app/(app)/games/page.tsx` and its colocated test
- [ ] 4.2 Confirm `apps/frontend/src/app/(app)/games/new/` is untouched and still reachable from Home's "Create" action

## 5. Frontend: bottom nav

- [ ] 5.1 New `components/BottomNav.tsx` (or equivalent): Home / Browse / You tabs, active-tab highlighting based on current route
- [ ] 5.2 Wire into `apps/frontend/src/app/(app)/layout.tsx`, rendered unconditionally
- [ ] 5.3 "Browse" tab links to ticket 006's public-games route
- [ ] 5.4 Component tests: all three tabs render with correct links, active tab reflects current route

## 6. Frontend: Account ("You") page

- [ ] 6.1 New `apps/frontend/src/app/(app)/account/page.tsx`: avatar/initials, username, game count (reuses `listMyMemberGames()` or a lightweight count-only variant), logout button (reuses existing `LogoutButton`)
- [ ] 6.2 Page tests: renders identity block and game count correctly, logout button present, no delete-account section rendered

## 7. Verification

- [ ] 7.1 `just lint && just typecheck` pass with no changes needed
- [ ] 7.2 `just test` passes in full
- [ ] 7.3 Manual verification against the local docker-compose/Surfpool stack: log in with a user in 0 games → Home empty state; join/create games → Home lists them with correct balances and admin badges; bottom nav visible and functional on Home, Browse, and You; You screen shows correct identity/count and logout works; `/games` returns a 404
