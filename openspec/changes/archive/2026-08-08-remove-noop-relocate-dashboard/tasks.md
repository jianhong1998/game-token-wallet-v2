## 1. On-chain: remove `noop`

- [x] 1.1 Delete the `noop` handler and `Noop` accounts struct from `lib.rs`
- [x] 1.2 `anchor build` succeeds and regenerates the IDL without `noop`; `cargo test` passes

## 2. Client generation and e2e cleanup

- [x] 2.1 Run `pnpm codegen` to regenerate `on-chain-client` from the updated IDL (drops `getNoopInstruction`)
- [x] 2.2 Remove the "exports a noop instruction builder" assertion from `apps/on-chain-client/src/index.test.ts`; `on-chain-client` tests pass
- [x] 2.3 Delete `apps/on-chain-program-e2e/tests/noop.test.ts`; `anchor test` passes
- [x] 2.4 Delete `apps/e2e/tests/noop.spec.ts`

## 3. Frontend: shared transaction helper

- [x] 3.1 Extract the sign → assert-blockhash-lifetime → send-and-confirm sequence (currently duplicated in `noop.ts`, `auth.ts`, `registry.ts`, `game.ts`) into a new shared helper (e.g. `server/transaction.ts`), with unit tests covering the happy path and the blockhash-expiry rejection
- [x] 3.2 Migrate `server/actions/auth.ts`, `server/actions/registry.ts`, `server/actions/game.ts` to call the shared helper; existing tests for each still pass unchanged (behavior-preserving refactor)
- [x] 3.3 Delete `apps/frontend/src/server/actions/noop.ts`

## 4. Frontend: relocate dashboard to `/`

- [x] 4.1 Delete `apps/frontend/src/app/page.tsx` (no-op demo page)
- [x] 4.2 Move `apps/frontend/src/app/(app)/home/page.tsx` (+ colocated test) to `apps/frontend/src/app/(app)/page.tsx`
- [x] 4.3 Move `apps/frontend/src/app/(app)/home/LogoutButton.tsx` (+ colocated test) to `apps/frontend/src/app/(app)/LogoutButton.tsx`; update the import in the relocated page
- [x] 4.4 Confirm `apps/frontend/src/app/(app)/home/` directory is fully removed (no leftover files)

## 5. Middleware: gate `/`

- [x] 5.1 Remove `"/"` from `PUBLIC_PATHS` in `apps/frontend/src/middleware.ts`
- [x] 5.2 Update `middleware.test.ts`: replace the "allows the root noop demo page through without a session" case with one asserting an unauthenticated visitor to `/` is redirected to `/login`; add a case confirming an authenticated visitor to `/` is not redirected

## 6. Docs: amend ticket 018

- [x] 6.1 Update `docs/tickets/018-home-dashboard-nav-account.md` to reference `/` instead of `/home` throughout, `Blocked by` includes 019
- [x] 6.2 Update `docs/superpowers/specs/2026-07-26-home-dashboard-nav-account-design.md` to reference `/` instead of `/home` throughout

## 7. Verification

- [x] 7.1 `just lint && just typecheck` pass with no changes needed
- [x] 7.2 `just test` passes in full (cargo test, frontend vitest, on-chain-client vitest, on-chain-program-e2e, e2e Playwright)
- [x] 7.3 Manual verification against the local docker-compose/Surfpool stack: logged-out visitor to `/` redirected to `/login`; log in → lands on `/` showing the placeholder (welcome message + logout button); `/home` returns a 404
