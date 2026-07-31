## Why

`middleware.ts` only gates the logged-out direction today (unauthenticated visitor on a protected route → redirected to `/login`); a logged-in user can still freely open `/login` or `/register`. Closing that gap is straightforward while already touching this file — and Next.js 16.2.10's dev server already warns that the `middleware.ts` file convention is deprecated in favor of `proxy.ts`, a mechanical rename worth bundling in rather than deferring to a separate pass over the same file.

## What Changes

- **BREAKING**: `apps/frontend/src/middleware.ts` renamed to `apps/frontend/src/proxy.ts`; exported `middleware()` renamed to `proxy()`. `config.matcher` unchanged — pure rename, no signature change.
- A request to exactly `/login` or `/register` carrying a valid session cookie (per the existing `verifySessionCookie` check) is redirected to `/`. An invalid, expired, or missing cookie leaves the existing behavior unchanged.
- `middleware.test.ts` renamed to `proxy.test.ts`, with new cases covering an authenticated user redirected away from `/login` and `/register`, plus confirming unaffected behavior for unauthenticated/invalid-cookie visitors.
- The comment in `apps/frontend/src/server/session.ts` referencing "middleware.ts" updated to say "proxy.ts".

## Capabilities

### New Capabilities
- `app-shell`: extends the route-gating behavior established by change `remove-noop-relocate-dashboard` (root-route session gating) with the logged-in direction — an authenticated visitor is kept out of `/login` and `/register`. Listed as New here (not yet present in `openspec/specs/`) since this change is proposed alongside, not after, that change's archival; the two ADDED requirement sets fold into one `app-shell` spec when synced.

### Modified Capabilities
(none — no existing `openspec/specs/` capability's requirements change; `user`'s session issuance/validation requirements are read, not modified, by this change)

## Impact

- Affected: `apps/frontend/src/middleware.ts` → `apps/frontend/src/proxy.ts`, `apps/frontend/src/middleware.test.ts` → `apps/frontend/src/proxy.test.ts`, `apps/frontend/src/server/session.ts` (comment only).
- Depends on change `remove-noop-relocate-dashboard` (019) landing first — it supplies `/` as the redirect target and establishes the `app-shell` capability this change extends.
