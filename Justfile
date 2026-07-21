# Initialize repo (Git, PNPM)
[group: 'Init']
init:
  @chmod +x ./.hooks/* && \
    git config core.hooksPath ./.hooks && \
    echo "✅ Git hooks are initialized"

help:
  @just -l

[group: 'CI']
lint:
  @pnpm lint

[group: 'CI']
typecheck:
  @pnpm typecheck

[group: 'Dev']
dev-up:
  @docker compose up --build

[group: 'Dev']
dev-down:
  @docker compose down --volumes

[group: 'CI']
test:
  @cargo test --manifest-path apps/on-chain-program/Cargo.toml
  @pnpm --filter frontend run test
  @cd apps/on-chain-program && anchor test
  @docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e