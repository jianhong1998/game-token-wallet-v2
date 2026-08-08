## Why

`apps/frontend/src/app/page.tsx` at `/` is still ticket 001's leftover connectivity smoke test (a "Send noop transaction" button calling the on-chain program's `noop` instruction) — never replaced with real app content — while the real authenticated placeholder lives at `/home` instead of the app's root. Ticket 018 (home dashboard/nav/account) needs to build its dashboard directly at `/`, so this scaffolding has to be cleared out and the dashboard relocated first, rather than building at `/home` and moving it later.

## What Changes

- **BREAKING**: On-chain `noop` instruction and its `Noop` accounts struct removed from `lib.rs`; `on-chain-client` regenerated so `getNoopInstruction` no longer exists.
- `apps/on-chain-program-e2e/tests/noop.test.ts`, `apps/e2e/tests/noop.spec.ts`, and the noop-builder assertion in `apps/on-chain-client/src/index.test.ts` deleted.
- `apps/frontend/src/server/actions/noop.ts` deleted; the sign → assert-blockhash-lifetime → send-and-confirm sequence it documented is extracted into a shared helper, adopted by `auth.ts`, `registry.ts`, and `game.ts` to remove duplicated boilerplate.
- `apps/frontend/src/app/page.tsx` (no-op demo) deleted. The existing authenticated placeholder at `apps/frontend/src/app/(app)/home/` moves to `apps/frontend/src/app/(app)/page.tsx`, making the dashboard the app's root (`/`). Old `/home` route is deleted outright — no redirect.
- **BREAKING**: `middleware.ts`'s `PUBLIC_PATHS` drops `"/"` — the root is now session-gated like every other `(app)` route (an unauthenticated visitor is redirected to `/login` instead of seeing the demo page).
- Ticket 018 (home dashboard/nav/account, not yet implemented) is amended to target `/` instead of `/home`, with `Blocked by` updated to include this change.

## Capabilities

### New Capabilities
- `app-shell`: which top-level routes require an authenticated session and what an authenticated vs. unauthenticated visitor sees at `/`. Previously untracked — `/` was a public no-op demo; this change makes it the session-gated dashboard placeholder.

### Modified Capabilities
(none — `noop` was never part of a tracked capability spec, and no requirement in the existing `registry` or `user` specs changes)

## Impact

- Affected on-chain: `apps/on-chain-program/programs/game_token_wallet/src/lib.rs` (remove `noop` handler + `Noop` struct).
- Affected client generation: `apps/on-chain-client` (regenerated), `apps/on-chain-client/src/index.test.ts`.
- Affected e2e: `apps/on-chain-program-e2e/tests/noop.test.ts` (deleted), `apps/e2e/tests/noop.spec.ts` (deleted).
- Affected frontend: `apps/frontend/src/server/actions/noop.ts` (deleted), new shared transaction helper (likely `server/connection.ts` or new `server/transaction.ts`), `apps/frontend/src/server/actions/{auth,registry,game}.ts` (switch to the shared helper), `apps/frontend/src/app/page.tsx` (deleted), `apps/frontend/src/app/(app)/home/*` → `apps/frontend/src/app/(app)/page.tsx` + `LogoutButton.tsx`, `apps/frontend/src/middleware.ts` (`PUBLIC_PATHS`), `apps/frontend/src/middleware.test.ts`.
- Affected docs: `docs/tickets/018-home-dashboard-nav-account.md` and its design doc, retargeted from `/home` to `/`.
