# Code Review — Round 1

**Timestamp:** 2026-07-21T20:30:00Z (approx, orchestrator-recorded)
**Loop iteration:** 1 of ≤5
**Model tier:** Sonnet (diff: 9411 lines / 60 files changed — note: over the 3000-line/20-file threshold that calls for Sonnet[1m]; standard Sonnet was used as the closest available tier via the Agent tool's model parameter)

## Findings

| ID  | Severity  | Summary | Evidence (file:line) |
| --- | --------- | ------- | --------------------- |
| F1  | important | `packages/on-chain-client`'s own unit test suite is never executed by CI or the Justfile — both only ever run the frontend's tests, so `on-chain-client`'s tests are dead code. | `.circleci/config.yml:71`, `Justfile:30`, `packages/on-chain-client/src/index.test.ts`, `package.json:11` |
| F2  | important | The WS pub-sub URL is derived by guessing `rpc_port + 1` on the same host — correct for local validators but wrong for public devnet/mainnet-beta endpoints. `connection.ts`'s singleton doesn't own an `rpcSubscriptions` client, so `noop.ts` reinvents URL derivation itself, violating the ticket's own rule that nothing else constructs a Connection/RPC client directly. | `apps/frontend/src/server/actions/noop.ts:23-32`, `apps/frontend/src/server/connection.ts:1-45`, `docker/deployment/.env.template:3` |
| F3  | important | `surfpool/surfpool:latest` is a floating tag in both compose files — the one unpinned dependency in a diff that otherwise pins everything else precisely. | `docker-compose.yml:3`, `docker-compose.e2e.yml:3` |
| F4  | important | CircleCI's `cargo-test` job runs the full Anchor/Solana toolchain install just to run `cargo test` on a crate with one trivial macro-generated test — verified `cargo test` passes with `solana` removed from PATH entirely. Burns CI minutes for zero benefit to this job. | `.circleci/config.yml:79-88`, `.circleci/config.yml:21-43` |
| F5  | minor | `.gitignore`'s `!apps/on-chain-program/target/idl/` negation is a no-op (git can't re-include under an excluded parent). Harmless today, inherited verbatim from the plan. | `.gitignore:20-21` |
| F6  | minor | `apps/e2e` has no `tsconfig.json`/typecheck script — same class of gap as the already-known `on-chain-program-e2e` gap. | `apps/e2e/package.json` |

## Disposition

- Actionable (blocking + important) — to fix this iteration: F1, F2, F3, F4
- Deferred (minor — NOT handled yet): F5, F6
