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
# program-identity keypair (reproducible address) and deploying with the
# fixed deployer keypair (reproducible upgrade authority) so this works
# whether the program was previously deployed by `just up-build`'s Docker
# path or by this recipe itself — see docker/local/fixtures/README.md.
[group: 'Dev']
deploy-program-local:
  @mkdir -p apps/on-chain-program/target/deploy && \
    cp docker/local/fixtures/game_token_wallet-keypair.dev.json apps/on-chain-program/target/deploy/game_token_wallet-keypair.json && \
    solana airdrop 10 docker/local/fixtures/deployer-keypair.dev.json --url http://127.0.0.1:8899 && \
    cd apps/on-chain-program && anchor build && anchor deploy --provider.cluster localnet --provider.wallet ../../docker/local/fixtures/deployer-keypair.dev.json

[group: 'CI']
test:
  @cargo test --manifest-path apps/on-chain-program/Cargo.toml
  @pnpm --filter frontend run test
  @pnpm --filter on-chain-client run test
  @cd apps/on-chain-program && anchor test
  @docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e