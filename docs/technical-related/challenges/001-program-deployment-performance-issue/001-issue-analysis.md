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
