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
up-build:
  @docker compose up --build

[group: 'Dev']
down:
  @docker compose down --volumes

# Builds and deploys the on-chain program to localnet, seeding the fixed
# fixture keypair first so the deployed address stays reproducible instead
# of drifting from declare_id!/Anchor.toml/PROGRAM_ID (see
# docker/local/fixtures/README.md).
[group: 'Dev']
deploy-program-local:
  @mkdir -p apps/on-chain-program/target/deploy && \
    cp docker/local/fixtures/game_token_wallet-keypair.dev.json apps/on-chain-program/target/deploy/game_token_wallet-keypair.json && \
    cd apps/on-chain-program && anchor build && anchor deploy --provider.cluster localnet

[group: 'CI']
test:
  @cargo test --manifest-path apps/on-chain-program/Cargo.toml
  @pnpm --filter frontend run test
  @pnpm --filter on-chain-client run test
  @cd apps/on-chain-program && anchor test
  @docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e