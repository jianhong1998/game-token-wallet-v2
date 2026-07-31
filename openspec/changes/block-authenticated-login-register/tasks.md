## 1. Prerequisites

- [ ] 1.1 Confirm change `remove-noop-relocate-dashboard` (019) has landed — `/` is the dashboard route and the redirect target this change uses

## 2. Rename `middleware.ts` → `proxy.ts`

- [ ] 2.1 Rename `apps/frontend/src/middleware.ts` to `apps/frontend/src/proxy.ts`; rename exported `middleware()` to `proxy()`; `config.matcher` unchanged
- [ ] 2.2 Rename `apps/frontend/src/middleware.test.ts` to `apps/frontend/src/proxy.test.ts`; update the import path
- [ ] 2.3 Existing tests in the renamed file pass unchanged (behavior-preserving rename)

## 3. Add logged-in-direction gating

- [ ] 3.1 In `proxy.ts`, add a branch: if `pathname` is exactly `/login` or `/register` and `verifySessionCookie` resolves a valid session, `NextResponse.redirect(new URL("/", request.url))`
- [ ] 3.2 Confirm the existing logged-out-on-protected-route branch is unchanged and still runs correctly alongside the new branch

## 4. Tests

- [ ] 4.1 `proxy.test.ts`: authenticated user on `/login` → redirected to `/`
- [ ] 4.2 `proxy.test.ts`: authenticated user on `/register` → redirected to `/`
- [ ] 4.3 `proxy.test.ts`: unauthenticated/invalid-cookie visitor on `/login` and `/register` → unaffected (existing assertions preserved)

## 5. Docs

- [ ] 5.1 Update the comment in `apps/frontend/src/server/session.ts` referencing "middleware.ts" to say "proxy.ts"

## 6. Verification

- [ ] 6.1 `just lint && just typecheck` pass with no changes needed
- [ ] 6.2 `just test` passes in full
- [ ] 6.3 Manual verification against the local docker-compose/Surfpool stack: log in, then navigate directly to `/login` and `/register` — both redirect to `/`; log out, then confirm `/login` and `/register` render normally
