## Context

`middleware.ts` currently gates only the logged-out direction (unauthenticated visitor on a protected route → `/login`). An authenticated user can still open `/login` or `/register` freely. Separately, Next.js 16.2.10's dev server logs `The "middleware" file convention is deprecated. Please use "proxy" instead.` Both were noticed while reviewing the same file. Depends on change `remove-noop-relocate-dashboard` (019, not yet landed) for the `/` redirect target.

Full grill session and decision rationale: [docs/superpowers/specs/2026-07-28-block-authenticated-login-register-design.md](../../../docs/superpowers/specs/2026-07-28-block-authenticated-login-register-design.md).

## Goals / Non-Goals

**Goals:**
- Redirect an authenticated visitor away from `/login` and `/register` to `/`.
- Leave existing logged-out-direction gating behavior unchanged.
- Rename `middleware.ts` → `proxy.ts` (`middleware()` → `proxy()`), matching the Next.js `middleware-to-proxy` codemod exactly (no logic change from the rename itself).

**Non-Goals:**
- No new file or per-page `redirect()` in an `(auth)` layout — this stays in the same function as the existing gating check.
- No redirect target other than `/` — no intermediate `/home` version.

## Decisions

- **Same function, same file, next to the existing check**: `proxy.ts` (nee `middleware.ts`) already parses the session cookie for every request and has full existing test coverage (`middleware.test.ts`) to extend. A layout-level check would duplicate cookie-verification logic that already exists here for no benefit.
- **Bundle the `proxy.ts` rename into this ticket**: this ticket is already editing this exact file for the new redirect logic. Deferring the rename to a separate ticket would mean touching the same file twice for two mechanically-unrelated-but-adjacent reasons. Confirmed via Next.js docs (`middleware-to-proxy` codemod) that this is a pure rename — `config.matcher`, the `NextRequest`/`NextResponse` signature, and all logic are unchanged.
- **Redirect target is `/`, gated on 019 landing first**: ticket/change 019 deletes `/home` outright and relocates the dashboard to `/`, updating `login/page.tsx`'s own post-login `router.push` target along the way. Targeting `/home` now would go stale the moment 019 lands, forcing a second edit to this same file for a problem entirely of this change's own making.

## Risks / Trade-offs

- [Renaming `middleware.ts` → `proxy.ts` could silently break Next.js's route-matching if the codemod assumption is wrong] → Mitigated: verified via Next.js docs that the rename is filename + export name only, `config.matcher` and signature are unchanged; covered by the renamed test suite still passing.
- [This change can't be verified end-to-end until 019 lands, since `/` doesn't yet host real dashboard content] → Accepted: `Blocked by` includes 019 explicitly; unit/proxy tests don't require the dashboard's actual content, only that the redirect target resolves to `/`.

## Migration Plan

1. Land change `remove-noop-relocate-dashboard` (019) first.
2. Rename `middleware.ts` → `proxy.ts`, `middleware()` → `proxy()`.
3. Add the new branch: authenticated + `/login` or `/register` → redirect to `/`.
4. Rename and extend `middleware.test.ts` → `proxy.test.ts` with the new cases.
5. Update the `session.ts` comment referencing "middleware.ts".

No rollback beyond standard revert — no data migration involved.

## Open Questions

None — all branches resolved during the grill session referenced above.
