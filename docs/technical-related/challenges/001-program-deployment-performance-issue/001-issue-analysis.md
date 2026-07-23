# 001 - Anchor Program Deployment Performance Issue

## Description

`docker compose up` (via `program-deploy` service, built from `docker/local/Dockerfile.anchor`) is very slow to reach a usable state. The slow step is `anchor build`, which runs inside the container's `CMD` (i.e. at every `docker compose up`, not at image build time) and recompiles the Anchor program's Rust dependencies from scratch each run — there is no persisted Cargo/target build cache across container runs, so every run pays a cold compile.

Initial proposal: move the deploy-keypair `cp` and `anchor build` out of the runtime `CMD` and into the image build stage (`RUN` in `Dockerfile.anchor`), so the compiled program ships baked into the image.

### Why the naive version of that doesn't work

`docker-compose.yml`'s `program-deploy` service bind-mounts the whole repo over the workdir:

```yaml
volumes:
  - .:/workspace
```

`apps/on-chain-program/target/` is gitignored (`.gitignore:20`, only `target/idl/` is force-included back in). So on the host, `target/` doesn't exist. The moment the container starts, that bind mount overlays the host's repo (no `target/`) on top of `/workspace`, shadowing/erasing whatever `anchor build` produced into `/workspace/apps/on-chain-program/target` during `docker build`. Baking the build into the image at that path is therefore pointless as stated — it gets hidden immediately at runtime.

### Scope & notes

- Out of scope: host-native builds (`just deploy-program-local`, `just program-build`) already benefit from the host's own persistent disk for `target/` — this is a Docker-specific problem. CI (`docker-compose.e2e.yml`) runs the same `anchor build` on ephemeral runners where Docker named volumes don't survive between separate job runs, so fixing its build caching (if even slow there) is a separate concern with its own tooling (e.g. CircleCI cache steps).
- `apps/on-chain-program/target/idl` never needs to reach the host: `.gitignore`'s `!apps/on-chain-program/target/idl/` force-include exception is currently unused (`git ls-files apps/on-chain-program/target` is empty — nothing under `target/` is actually tracked). The client codegen step reads `target/idl/game_token_wallet.json` inside the same container run, after `anchor build` finishes and before the container exits; only its own output (`apps/on-chain-client/src/generated`) needs to land on the host, via the pre-existing `.:/workspace` bind mount. So parking all of `target/` (including `idl/`) in a container-only named volume is safe.

## Solutions & Trade-offs

### Option 1 — COPY source into the image and build at image-build time

Copy `apps/on-chain-program` (and required workspace files) into the image, run `anchor build` as a `RUN` step during `docker build`, ship the compiled program baked in.

- Fixes cold-build speed for the common case (image already built).
- **Breaks the live bind-mount dev loop.** Any edit to program source now requires a `docker build`, not just a container restart — bad fit for local dev, which is clearly designed around editing on the host and re-running the container.
- Also still has the bind-mount shadow problem: baked build output living under `/workspace` gets hidden by the `.:/workspace` mount at container start unless the build target path is moved outside `/workspace` (see Option 3-style mitigation) and explicitly copied/symlinked back in at container start — adds sync complexity.
- Rejected for local dev use case.

### Option 2 — Persist a cache volume for the Cargo/Anchor build cache

Add named Docker volumes for `apps/on-chain-program/target` and `~/.cargo/registry` (and `~/.cargo/git` if needed) on the `program-deploy` service, so the build cache survives across `docker compose down` / `up` cycles. `anchor build` keeps running at container start (in `CMD`, same as today), but after the first cold run it becomes an incremental compile.

- Preserves the live bind-mount dev loop — editing program source still just needs a container restart, no image rebuild.
- Fixes the actual root cause (no persisted compile cache across runs), not just moving where the cost is paid.
- First run after a fresh volume (e.g. new clone, `docker compose down -v`) is still a cold build — expected and acceptable.
- **Selected approach.**

### Option 3 — Build outside `/workspace`, copy/symlink into place at container start

Build in image at a path outside `/workspace` (e.g. `/root/build`), then copy or symlink the compiled output into `/workspace/apps/on-chain-program/target` at container start, avoiding the bind-mount shadow problem from Option 1.

- Makes "bake the build into the image" viable without the shadowing issue.
- Still requires an image rebuild on every program-source change to get any benefit — doesn't fix the dev-loop problem, just works around the mount conflict.
- Adds sync/copy complexity for marginal benefit over Option 2.
- Not selected.

## Implementation Outcome

Implemented Option 2: added three named Docker volumes to `program-deploy` in `docker-compose.yml` — `on_chain_program_target` (`/workspace/apps/on-chain-program/target`), `cargo_registry` (`/root/.cargo/registry`), `solana_platform_tools_cache` (`/root/.cache/solana`). No Dockerfile or CMD changes.

Measured (`docker compose logs -t program-deploy`, first-to-last log line timestamp):
- Baseline (pre-change, cold): 145s (2026-07-22T12:57:01.938Z → 12:59:26.690Z)
- Post-change, cold (first run on fresh volumes): 201s (13:00:49.438Z → 13:04:10.134Z)
- Post-change, warm (second run, same volumes): 53s (13:04:34.287Z → 13:05:27.596Z)

Regression check (Task 4): confirmed `docker compose up --build` from a fully wiped state (`just down-clean`) still succeeds — the cache volumes are purely additive.

## Pivot: Bake `anchor build` Into the Image

After shipping Option 2, observed that `just down-clean` (`docker compose down --volumes`) — which wipes the three cache volumes — is triggered more often in practice than `apps/on-chain-program` source actually changes. That flips the trade-off Option 1 was rejected on: paying a rebuild on every source edit (rare here) is cheaper than paying a cold compile on every `down-clean` (frequent here).

Plain Option 1 (bake `anchor build` into the image, stop) still doesn't work as stated: `anchor deploy`, the airdrop steps, `pnpm install`, and codegen (`pnpm --filter on-chain-client run codegen`, whose output must land on the host) all require the live `surfpool` validator and must stay in `CMD` — they can't move to `docker build` time. And the `.:/workspace` bind mount is still required for those, not just for editing program source live.

The design that resolves both: bake only the `anchor build` *compile* step into the image (`COPY` the on-chain-program source + fixed deploy keypair fixture, `RUN anchor build` in `Dockerfile.anchor`). Leave `docker-compose.yml` untouched — `on_chain_program_target`, `cargo_registry`, and `solana_platform_tools_cache` are already named volumes mounted at the exact paths the image now has content at, and Docker's documented behavior (an empty named volume mounted over a path that has content in the image gets seeded from that image content on first use) means a fresh volume after `down-clean` is no longer cold. `CMD` still runs `anchor build` before `anchor deploy` exactly as before — required anyway since deploy must run at runtime — so it's now a fast incremental compile off a warm seed, and the live bind-mount dev loop is preserved as a side effect rather than the goal.

Teardown was split in two, since making `down-clean` also blow away the image would just relocate the "frequent cold build" problem it wiped out: `down-clean` stays a cheap, volume-only reset (`docker compose down --volumes`); a new `clean-docker` recipe (`docker compose down --volumes --rmi local`) covers the rare "wipe genuinely everything, including the image" case. `docker builder prune` (BuildKit's layer cache) was deliberately left out of `clean-docker` — it's host-wide, not scoped to this repo, and would clear build cache for unrelated projects on the same machine.

Verified compatible with CI's `docker-compose.e2e.yml`: it reuses the same `Dockerfile.anchor` but fully overrides `command:`, so the image simply arrives with `anchor build` already done — no CI changes needed.

`clean-docker`'s `--rmi local` note: it only removes images without a custom `image:` tag in the compose file, i.e. the two images this repo builds (`program-deploy`, `frontend`). The pulled `surfpool/surfpool@sha256:...` base image (explicit `image:` field) is intentionally left alone — it's not something this repo builds, and blowing it away would just force a multi-hundred-MB re-pull for no benefit.

Measured (`docker compose logs -t program-deploy`, first-to-last log line timestamp):
- Baseline (pre-Option-2, cold): 145s
- Option 2, cold (fresh volumes, pre-image-bake): 201s
- Option 2, warm (same volumes): 53s
- Post-pivot, fresh volumes + pre-baked image (the `down-clean` case this pivot targets): 33.4s (2026-07-22T14:29:27.941Z → 14:30:01.330Z)

## Update (2026-07-23): `CMD` extracted into `scripts/deploy-local.sh`

The runtime deploy logic described above as living in `CMD` was extracted out
of `docker/local/Dockerfile.anchor`'s `CMD` into `scripts/deploy-local.sh`,
invoked via `ENTRYPOINT ["scripts/deploy-local.sh"]` — a maintainability fix
(the `CMD` string had grown too long to read/edit), not a behavior or
performance change. The script isn't `COPY`ed into the image; it arrives via
the same `.:/workspace` bind mount as the rest of the repo, same as before.

Every `CMD` reference elsewhere in this doc describes the pre-extraction
mechanism; the steps and their ordering (seed keypair → airdrop → `anchor
build` → `anchor deploy` → codegen) are unchanged.
