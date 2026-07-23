# Persist Anchor Build Cache Across Docker Runs

## Context

`docker compose up` (the `program-deploy` service, built from
`docker/local/Dockerfile.anchor`) is very slow to reach a usable state. The
slow step is `anchor build`, which runs inside the container's `CMD` — i.e.
at every `docker compose up`, not at image build time — and recompiles the
Anchor program's Rust dependencies from scratch every run: there is no
persisted Cargo/Anchor build cache across container recreations, so every
run pays a cold compile.

Full analysis (including why the naive "bake `anchor build` into the image"
approach doesn't work) is recorded in
[001-issue-analysis.md](../../technical-related/challenges/001-program-deployment-performance-issue/001-issue-analysis.md).

## Questions & Answers

**Q: Why not just move `anchor build` (and the deploy-keypair `cp`) into
the image build stage, so the compiled program ships baked into the
image?**
A: `docker-compose.yml`'s `program-deploy` service bind-mounts the whole
repo over the workdir (`.:/workspace`). `apps/on-chain-program/target/` is
gitignored, so it doesn't exist on the host. The moment the container
starts, that bind mount overlays the host's repo (no `target/`) on top of
`/workspace`, shadowing/erasing whatever `anchor build` produced into
`/workspace/apps/on-chain-program/target` during `docker build`. Baking the
build into the image at that path is pointless — it gets hidden immediately
at runtime. Working around this (building outside `/workspace`, copying/
symlinking in at container start) was considered and rejected — see Option
3 in the linked issue analysis.

**Q: If we don't bake the build into the image, how else do we avoid a
cold compile every run?**
A: Keep `anchor build` running where it already runs (in `CMD`, at
container start), but stop discarding its build cache every time the
container is recreated. Persist the paths Cargo/Anchor actually cache into
across runs as named Docker volumes:
- `apps/on-chain-program/target` — the Rust/Anchor build output
  (`.fingerprint`, `incremental`, `deps`, plus Anchor's own `idl`/`types`/
  `deploy` subdirs). This is what makes a second `anchor build` incremental
  instead of from-scratch.
- `/root/.cargo/registry` — downloaded crate sources (crates.io index +
  package cache). Without this, every run re-fetches every dependency even
  if `target/` itself is cached.
- `/root/.cache/solana` — the Solana BPF/SBF `platform-tools` toolchain
  that `cargo build-sbf` (invoked internally by `anchor build`) downloads
  on first use if not already present. Same class of repeated one-time
  cost as the crate downloads.

**Q: Does anything on the host need `apps/on-chain-program/target/idl` to
be populated after a run — e.g. for `git` tracking or codegen reading it
from the host?**
A: No. `.gitignore` has `!apps/on-chain-program/target/idl/` (a force-
include exception), but `git ls-files apps/on-chain-program/target` shows
nothing is actually tracked there today — the exception is currently
unused. And the client codegen (`apps/on-chain-client/scripts/
generate-client.mjs`) reads `apps/on-chain-program/target/idl/
game_token_wallet.json` via a relative path resolved *inside the same
container*, in the same `CMD` run, after `anchor build` finishes and before
the container exits — it never needs that file to exist on the host. Its
own output (`apps/on-chain-client/src/generated`) is what needs to reach
the host, and that's already achieved via the pre-existing `.:/workspace`
bind mount (not touched by this change). So putting all of `target/`
(including `idl/`) inside a container-only named volume is safe.

**Q: Does this affect `just deploy-program-local` / `just program-build`
(host-native `anchor build`, not via Docker) or `docker-compose.e2e.yml`
(CI)?**
A: No, both are out of scope. `just deploy-program-local` /
`just program-build` run directly on the host and already benefit from the
host's own persistent disk for `target/` — this problem is Docker-specific.
`docker-compose.e2e.yml` runs the same `anchor build` but on ephemeral CI
runners where Docker named volumes don't survive between separate CI job
runs; fixing CI build caching (if it's even slow there) is a separate
concern with its own tooling (e.g. CircleCI's own cache steps), not this
plan.

**Q: Any risk of the new volumes becoming a hidden functional dependency
(i.e. the stack silently breaking if they don't exist yet, such as on a
fresh clone)?**
A: No — they're purely a performance optimization. Docker creates named
volumes empty on first use if they don't already exist, so a fresh
`docker compose up --build` with no pre-existing volumes behaves exactly as
it does today (cold build), just via a volume mount instead of the
container's ephemeral writable layer. The implementation plan includes an
explicit regression check for this (fresh `down --volumes` then
`up --build` still succeeds).

## Decision

Implement Option 2 from the linked issue analysis: add three named Docker
volumes to the `program-deploy` service in `docker-compose.yml` —
`on_chain_program_target` (→ `/workspace/apps/on-chain-program/target`),
`cargo_registry` (→ `/root/.cargo/registry`), and
`solana_platform_tools_cache` (→ `/root/.cache/solana`). No changes to
`docker/local/Dockerfile.anchor` or its `CMD` — `anchor build` keeps
running at container start exactly as today; only the paths it reads/
writes now persist across container recreations instead of being wiped
every time the container is recreated.

Rejected: Option 1 (COPY source into the image, build at image-build time)
— breaks the live bind-mount dev loop (any program source edit would need
a full `docker build`, not just a container restart), which defeats the
point of the existing `.:/workspace` bind mount this Dockerfile is
designed around.

## Verification

No unit-test framework applies — this is Docker Compose infra config, not
application code. Per this repo's "Done Means" rule (behavior observed on
the running system, not inferred):

1. Baseline: `docker compose up --build -d` on a clean slate (`just
   down-clean` first), record `program-deploy`'s wall-clock duration via
   `docker compose logs -t program-deploy` first/last timestamp.
2. After the change: same measurement, twice — once cold (fresh volumes,
   expect similar to baseline) and once warm (`docker compose down` without
   `--volumes`, then `up --build -d` again — expect markedly shorter).
3. Regression check: `just down-clean` (wipes the new volumes too) then
   `docker compose up --build` once more still succeeds — proves the
   volumes are additive, not a hidden dependency.
4. Functional check: `apps/on-chain-client/src/generated` still gets
   written correctly by codegen (no unexpected diff), confirming
   `target/idl` living in a container-only volume didn't break the
   in-container codegen step.

Full step-by-step commands are in the implementation plan:
[2026-07-22-anchor-build-cache-volumes.md](../plans/2026-07-22-anchor-build-cache-volumes.md).

## Branch

Current branch (`feat/001-repo-bootstrap-connection-utility`) is scoped to
a different ticket. This work goes on its own branch:
`perf/000-anchor-build-cache-volumes`.
