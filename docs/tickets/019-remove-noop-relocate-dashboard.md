# 019 — Remove no-op scaffolding; relocate dashboard to `/`

**What to build:** Delete the leftover `/` no-op connectivity demo (page, Server Action, on-chain instruction) from ticket 001, and relocate the authenticated dashboard to `/` so it's the app's real landing page once logged in. Lands before ticket 018 (home dashboard/nav/account), which is amended to target `/` directly rather than `/home`.

**Blocked by:** 001, 003

**Status:** ready-for-agent

**Spec:** [2026-07-26-remove-noop-relocate-dashboard-design.md](../superpowers/specs/2026-07-26-remove-noop-relocate-dashboard-design.md)

- [ ] On-chain: `noop` instruction and its `Noop` accounts struct removed from `lib.rs`.
- [ ] `apps/on-chain-program-e2e/tests/noop.test.ts` and `apps/e2e/tests/noop.spec.ts` deleted; `on-chain-client` regenerated so `getNoopInstruction` no longer exists; the "exports a noop instruction builder" assertion in `apps/on-chain-client/src/index.test.ts` removed.
- [ ] `apps/frontend/src/server/actions/noop.ts` deleted. The sign → assert-blockhash-lifetime → send-and-confirm sequence it explained is extracted into a shared helper (used by `auth.ts`, `registry.ts`, `game.ts`), removing the duplicated boilerplate and the now-dangling "see noop.ts" comments in `registry.ts`/`registry.test.ts`.
- [ ] `apps/frontend/src/app/page.tsx` (no-op demo) deleted. The page currently at `apps/frontend/src/app/(app)/home/` moves to `apps/frontend/src/app/(app)/page.tsx` (route group keeps the URL at `/`).
- [ ] Old `/home` route is deleted outright (no redirect — app isn't published yet).
- [ ] `middleware.ts`: `/` removed from `PUBLIC_PATHS`; the page at `/` is session-gated like every other `(app)` route.
- [ ] Ticket 018 (not yet implemented) is amended to target `/` instead of `/home`.
