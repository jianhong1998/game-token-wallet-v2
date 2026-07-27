# 020 — Redirect authenticated users off `/login` and `/register`

**What to build:** Today, `middleware.ts` only gates the logged-out direction (unauthenticated visitor on a protected route → redirected to `/login`); a logged-in user can still freely open `/login` or `/register`. Close that gap, and while touching this file, do the Next.js 16 `middleware.ts` → `proxy.ts` rename its build output already warns is required (mechanical: filename + exported function name only, no signature change).

**Blocked by:** 001, 003, 019

**Status:** ready-for-agent

- [ ] `apps/frontend/src/middleware.ts` renamed to `apps/frontend/src/proxy.ts`; exported `middleware()` renamed to `proxy()`. `config.matcher` unchanged. `middleware.test.ts` renamed to `proxy.test.ts`, imports updated to match.
- [ ] The comment in `apps/frontend/src/server/session.ts` referencing "middleware.ts" updated to say "proxy.ts".
- [ ] `proxy.ts`: a request to exactly `/login` or `/register` carrying a valid session cookie (per the existing `verifySessionCookie` check) is redirected to `/`. An invalid, expired, or missing cookie leaves the existing behavior unchanged (page renders normally).
- [ ] `proxy.test.ts`: new cases covering an authenticated user redirected away from `/login` and from `/register`, plus confirming an unauthenticated/invalid-cookie visitor to either path is unaffected.
