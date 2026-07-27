# 020 — Redirect authenticated users off `/login` and `/register` — Design

Spec for [docs/tickets/020-block-authenticated-login-register.md](../../tickets/020-block-authenticated-login-register.md). Blocked by 001 (done), 003 (done), 019 (pending — supplies the `/` redirect target). Triggered by two independent observations while reviewing `apps/frontend/src/middleware.ts`: (1) it only gates the logged-out direction — an authenticated user can still open `/login` or `/register` freely; (2) Next.js 16.2.10's dev server logs `The "middleware" file convention is deprecated. Please use "proxy" instead.`

---

## Grill session — decisions

### Q1: Where should the "already logged in, keep out of `/login`/`/register`" check live?

**Answer:** Same `middleware.ts` (→ `proxy.ts`) function, next to the existing logged-out check.

**Decision:** No new file, no per-page `redirect()` in a `(auth)` layout. One function, one session-cookie parse, both directions of the check.

**Reason:** `middleware.ts` already parses the session cookie for every request and has full test coverage of the existing gating pattern (`middleware.test.ts`) to extend. A layout-level check would duplicate the cookie-verification logic that already exists here for no benefit.

### Q2: Next.js flags `middleware.ts` as deprecated in favor of `proxy.ts` — is that rename in scope for this ticket, or separate cleanup?

**Answer:** In scope, bundled into this ticket.

**Decision:** `middleware.ts` → `proxy.ts`, exported `middleware()` → `proxy()`, `middleware.test.ts` → `proxy.test.ts`. Confirmed via Next.js docs (`middleware-to-proxy` codemod) that this is a pure rename — `config.matcher`, the `NextRequest`/`NextResponse` signature, and all logic are unchanged.

**Reason:** This ticket is already editing this exact file for the new redirect logic. Deferring the rename to a separate ticket would mean touching the same file twice for two mechanically-unrelated-but-adjacent reasons; bundling costs nothing extra since the rename itself has zero logic risk.

### Q3: Where should an authenticated user hitting `/login` or `/register` be redirected — `/home` (today's landing route) or `/` (post-019 landing route)?

**Answer:** `/`, with this ticket blocked by 019.

**Decision:** `Blocked by: 001, 003, 019`. The redirect target is `/` directly — no intermediate `/home` version, no follow-up rework once 019 ships.

**Reason:** Ticket 019 (already drafted, not yet implemented) deletes the `/home` route outright and relocates the dashboard to `/`, updating `login/page.tsx`'s own post-login `router.push` target along the way. Targeting `/home` now would mean this ticket's redirect target goes stale the moment 019 lands, requiring a second edit to this same file for a problem entirely of this ticket's own making. Depending on 019 costs only sequencing (020 can't start until 019 is done); it avoids a guaranteed rework cycle.

---

## Design

*(Structural sketch — file-by-file implementation detail is for the writing-plans step.)*

- `apps/frontend/src/middleware.ts` → `apps/frontend/src/proxy.ts` — file renamed, `middleware()` → `proxy()`, `config.matcher` untouched. Existing logged-out-on-protected-route branch unchanged.
- New branch in the same function: if `pathname` is exactly `/login` or `/register` and `verifySessionCookie` resolves a valid session, `NextResponse.redirect(new URL("/", request.url))`. Falls through to existing public-path behavior otherwise.
- `apps/frontend/src/middleware.test.ts` → `apps/frontend/src/proxy.test.ts` — import path updated; new cases added alongside the existing ones (mirroring the existing `mockVerifySessionCookie` pattern) for: authed user on `/login` → redirected to `/`; authed user on `/register` → redirected to `/`; unauthenticated/invalid-cookie on either → unchanged (existing assertions preserved).
- `apps/frontend/src/server/session.ts` — the comment "this module works identically whether middleware.ts runs on the Edge or Node.js runtime" updated to say `proxy.ts`.

---

## Self-review

- Decisions resolve every branch raised: implementation location (Q1), the unrelated-but-adjacent deprecation warning and whether to bundle it (Q2), and the redirect-target/sequencing question forced by ticket 019's in-flight `/home` → `/` move (Q3).
- Verified against the actual codebase and Next.js docs rather than assumed: confirmed `PUBLIC_PATHS` currently has no logged-in-direction check (read `middleware.ts` directly), confirmed the proxy rename is signature-compatible (Context7 Next.js v16.2.9 docs — codemod + build-time deprecation source), confirmed no e2e/Playwright coverage exists for auth today so none is being skipped.
- Scope: touches only `proxy.ts` (nee `middleware.ts`), its test file, and one comment in `session.ts`. Does not touch ticket 019's own checklist — 019 lands first per the `Blocked by` order, so it correctly still refers to `middleware.ts` (the rename hasn't happened yet at that point).
