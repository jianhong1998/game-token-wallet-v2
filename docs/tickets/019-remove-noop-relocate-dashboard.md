# 019 — Remove no-op scaffolding; relocate dashboard to `/`

**What to build:** Delete the leftover `/` no-op connectivity demo (page, Server Action, on-chain instruction) from ticket 001, and relocate the authenticated dashboard to `/` so it's the app's real landing page once logged in. Lands before ticket 018 (home dashboard/nav/account), which is amended to target `/` directly rather than `/home`.

**Blocked by:** 001, 003

**Status:** Done

**Spec:** [2026-07-26-remove-noop-relocate-dashboard-design.md](../superpowers/specs/2026-07-26-remove-noop-relocate-dashboard-design.md)
**Plan:** [2026-08-01-remove-noop-relocate-dashboard.md](../superpowers/plans/2026-08-01-remove-noop-relocate-dashboard.md)

- [x] On-chain: `noop` instruction and its `Noop` accounts struct removed from `lib.rs`.
- [x] `apps/on-chain-program-e2e/tests/noop.test.ts` and `apps/e2e/tests/noop.spec.ts` deleted; `on-chain-client` regenerated so `getNoopInstruction` no longer exists; the "exports a noop instruction builder" assertion in `apps/on-chain-client/src/index.test.ts` removed.
- [x] `apps/frontend/src/server/actions/noop.ts` deleted. The sign → assert-blockhash-lifetime → send-and-confirm sequence it explained is extracted into a shared helper (used by `auth.ts`, `registry.ts`, `game.ts`), removing the duplicated boilerplate and the now-dangling "see noop.ts" comments in `registry.ts`/`registry.test.ts`.
- [x] `apps/frontend/src/app/page.tsx` (no-op demo) deleted. The page currently at `apps/frontend/src/app/(app)/home/` moves to `apps/frontend/src/app/(app)/page.tsx` (route group keeps the URL at `/`).
- [x] Old `/home` route is deleted outright (no redirect — app isn't published yet).
- [x] `middleware.ts`: `/` removed from `PUBLIC_PATHS`; the page at `/` is session-gated like every other `(app)` route.
- [x] Ticket 018 (not yet implemented) is amended to target `/` instead of `/home`.

## Implementation notes

Implemented via 11 plan tasks (squash-merged, linear history) plus one code-review fix, all on `feat/019-remove-noop-relocate-dashboard`. Full verification (live browser walkthrough of every AC + complete `just test`, including the dockerized e2e suite) passed. Review loop: 2 rounds, 1 actionable issue found and fixed, 1 minor issue deferred. Logs, decisions, and a reviewer report live under `.loop-logs/2026-08-01-remove-noop-relocate-dashboard/`.

Scope addition beyond the checklist above (confirmed with the user during planning): `login/page.tsx` and `register/page.tsx` hardcoded `router.push("/home")`, and `apps/e2e/tests/auth.spec.ts` / `game-creation.spec.ts` asserted `toHaveURL(/\/home$/)`. Both were updated to `/` — otherwise login/register would have sent real users to the now-deleted 404 route.

**Deferred (not blocking):**

- Minor/cosmetic: the relocated dashboard component and its test `describe` block are still named `HomePage`/`"HomePage"` — a naming leftover from the `/home` → `/` move.
- Unrelated tooling gap found during final verification: `just test` run cold fails at `test-e2e-program` because that step assumes a validator is already listening on `127.0.0.1:8899`, which `just test`'s own recipe never starts — pre-existing gap in `justfile`, not introduced by this ticket. Worth a follow-up ticket.
