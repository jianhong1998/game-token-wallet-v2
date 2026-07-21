# Code Review — Round 4

**Timestamp:** 2026-07-21T23:40:00Z (approx, orchestrator-recorded)
**Loop iteration:** 4 of ≤5
**Model tier:** Sonnet (diff: 9564 lines / 63 files changed)

## Findings

| ID  | Severity | Summary | Evidence (file:line) |
| --- | -------- | ------- | --------------------- |
| F1  | minor | Noop transaction-assembly duplicated verbatim between prod Server Action and on-chain-program-e2e test instead of a shared `on-chain-client` helper. | `apps/frontend/src/server/actions/noop.ts:24-40` vs `apps/on-chain-program-e2e/tests/noop.test.ts:48-67` |
| F2  | minor | `deriveWsUrl` infers WS port via a magic-number match on `8899` rather than an explicit `SOLANA_WS_URL` env var, inconsistent with the project's "always explicit" precedent for `SOLANA_RPC_URL`. | `apps/frontend/src/server/connection.ts:35-45` |
| F3  | minor | e2e compose's `tail -f /dev/null` + marker-file healthcheck workaround vs. changing the CI invocation shape instead — already a deliberate, discussed tradeoff. | `docker-compose.e2e.yml:16-45` |
| F4  | minor | Two sequential `solana airdrop` calls could run concurrently instead of serially. | `docker/local/Dockerfile.anchor:57`, `docker-compose.e2e.yml:51-52` |
| F5  | minor | `Justfile`'s `test` recipe fully serializes independent suites; CI already parallelizes the equivalent jobs. | `Justfile:27-33` |
| F6  | minor | Root `package.json`'s `"test"` script is dead (never invoked; would break if run since it'd fire infra-dependent e2e suites). | `package.json:11` |

Live re-verification this round: lint/typecheck clean across all packages, frontend/on-chain-client vitest suites pass, dev keypair fixture independently re-derived and confirmed consistent everywhere (`declare_id!`, `Anchor.toml`, both compose files, generated client). No regressions found in round-1/2 fixes.

## Disposition

- Actionable (blocking + important): none
- Deferred (minor — NOT handled yet): F1, F2, F3, F4, F5, F6 (plus all prior rounds' deferred minors, unchanged)

**Loop exits here — zero actionable issues. Proceeding to Stage 4 (final).**
