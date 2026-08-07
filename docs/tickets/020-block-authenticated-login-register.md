# 020 — Redirect authenticated users off `/login` and `/register`

**What to build:** Today, `middleware.ts` only gates the logged-out direction (unauthenticated visitor on a protected route → redirected to `/login`); a logged-in user can still freely open `/login` or `/register`. Close that gap, and while touching this file, do the Next.js 16 `middleware.ts` → `proxy.ts` rename its build output already warns is required (mechanical: filename + exported function name only, no signature change).

**Blocked by:** 001, 003, 019

**Status:** done

**Spec:** [2026-07-28-block-authenticated-login-register-design.md](../superpowers/specs/2026-07-28-block-authenticated-login-register-design.md)

- [x] `apps/frontend/src/middleware.ts` renamed to `apps/frontend/src/proxy.ts`; exported `middleware()` renamed to `proxy()`. `config.matcher` unchanged. `middleware.test.ts` renamed to `proxy.test.ts`, imports updated to match.
- [x] The comment in `apps/frontend/src/server/session.ts` referencing "middleware.ts" updated to say "proxy.ts".
- [x] `proxy.ts`: a request to exactly `/login` or `/register` carrying a valid session cookie (per the existing `verifySessionCookie` check) is redirected to `/`. An invalid, expired, or missing cookie leaves the existing behavior unchanged (page renders normally).
- [x] `proxy.test.ts`: new cases covering an authenticated user redirected away from `/login` and from `/register`, plus confirming an unauthenticated/invalid-cookie visitor to either path is unaffected.

## Implementation notes

- Guard list constant named `GUEST_ONLY_PATHS` (not `AUTH_ONLY_PATHS`) — round-1 review flagged the original name as semantically inverted (reads as "requires auth" but actually gates guest-only routes); fixed same loop, round-2 review clean.
- Verification: 2 rounds, all 8 ACs PASS (live browser + lint/typecheck/test evidence).
- Known pre-existing gap (not introduced here, not fixed here): `just test`'s `test-e2e-program` step assumes a validator already listening on `127.0.0.1:8899` — fails cold on fresh checkout. CI doesn't hit this (runs unit + docker-compose e2e suites directly). Previously flagged against 019 too; needs its own follow-up ticket.
