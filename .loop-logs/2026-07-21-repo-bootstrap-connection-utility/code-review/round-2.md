# Code Review — Round 2

**Timestamp:** 2026-07-21T22:55:00Z (approx, orchestrator-recorded)
**Loop iteration:** 2 of ≤5
**Model tier:** Sonnet (diff: 9523 lines / 62 files changed)

## Findings

| ID  | Severity  | Summary | Evidence (file:line) |
| --- | --------- | ------- | --------------------- |
| F1  | important | `cargo-test` job's image-choice comment still justifies tolerating `cimg/base:current`'s moving-tag risk via anchor-cli's GLIBC_2.39+ requirement, but the same commit that trimmed the job's toolchain install also states this job has no Solana/Anchor CLI dependency at all — the stated rationale no longer applies, stale comment left behind. | `.circleci/config.yml:87-100` |
| F2  | minor | `surfpool` service config (image/command/healthcheck) and `PROGRAM_ID`/`SYSTEM_ADMIN_SECRET_KEY` literals duplicated verbatim across `docker-compose.yml` and `docker-compose.e2e.yml` — future drift risk. | `docker-compose.yml:2-4,82-83` vs `docker-compose.e2e.yml:2-4,90-91` |
| F3  | minor | Keypair-seed + build + deploy + codegen pipeline duplicated verbatim between `Dockerfile.anchor`'s CMD and `docker-compose.e2e.yml`'s command override. | `docker/local/Dockerfile.anchor:57` vs `docker-compose.e2e.yml:47-52` |
| F4  | minor | No CircleCI caching (pnpm store, cargo registry, toolchain) — cost/time only. | `.circleci/config.yml:64-65,73-74,82-83,121-122` |
| F5  | minor | pnpm-setup boilerplate copy-pasted across 4 jobs instead of using the file's own established `command:` pattern. | `.circleci/config.yml:64-65,73-74,82-83,121-122` |
| F6  | minor | `web-unit-tests` serializes two independent test suites in one job instead of splitting, inconsistent with `cargo-test`/`on-chain-program-e2e` split. | `.circleci/config.yml:84-85` |
| F7  | minor | `on-chain-program-e2e`'s test hardcodes RPC/WS URL literals duplicating the 8899→8900 convention `deriveWsUrl()` already centralizes elsewhere. | `apps/on-chain-program-e2e/tests/noop.test.ts:22-23` |

Verified and ruled out: committed dev keypair address matches declare_id!/Anchor.toml/PROGRAM_ID; SYSTEM_ADMIN_SECRET_KEY derives to the claimed airdrop address; anchor-lang Cargo.lock pin matches anchor-cli version; `docker/deployment/Dockerfile`'s partial-workspace install builds successfully (live-tested). No net-new correctness bugs in the newest code (round-1 fixes + keypair-reproducibility fix all hold under independent scrutiny).

## Disposition

- Actionable (blocking + important) — to fix this iteration: F1
- Deferred (minor — NOT handled yet): F2, F3, F4, F5, F6, F7
