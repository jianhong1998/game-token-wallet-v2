# Code Review — Round 3

**Timestamp:** 2026-07-21T23:15:00Z (approx, orchestrator-recorded)
**Loop iteration:** 3 of ≤5
**Model tier:** Sonnet (diff: 9525 lines / 62 files changed)

## Findings

| ID  | Severity  | Summary | Evidence (file:line) |
| --- | --------- | ------- | --------------------- |
| F5  | important | CI's `typecheck`/`lint` jobs silently no-op for 3 of 4 TS packages (`pnpm -r --if-present run <script>` skips packages without the script — only `apps/frontend` has one). Confirmed a REAL, presently-shipping `TS2345` type error in `apps/on-chain-program-e2e/tests/noop.test.ts:58` (missing the `assertIsTransactionWithBlockhashLifetime` narrowing already used correctly in `apps/frontend/src/server/actions/noop.ts:36`) that nothing in CI catches, since neither `typecheck` nor `test` (esbuild transpile-only) type-check that package. | `package.json:9-10`, `.circleci/config.yml:68-85`, `packages/on-chain-client/package.json`, `apps/on-chain-program-e2e/package.json`, `apps/e2e/package.json` (no tsconfig.json at all), live error at `apps/on-chain-program-e2e/tests/noop.test.ts:58` |
| F6  | minor | `setValidEnv()` test helper duplicated verbatim across `env.test.ts`/`connection.test.ts`. | `apps/frontend/src/server/env.test.ts:6-12`, `apps/frontend/src/server/connection.test.ts:3-9` |

Re-confirmed no regression in committed dev keypair / SYSTEM_ADMIN_SECRET_KEY derivations. No escalation evidence for the 6 previously-deferred minors from round 2.

## Disposition

- Actionable (blocking + important) — to fix this iteration: F5
- Deferred (minor — NOT handled yet): F6, plus round-2's 6 deferred minors (unchanged)
