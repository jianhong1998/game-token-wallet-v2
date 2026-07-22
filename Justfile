# Initialize repo (Git, PNPM)
[group: 'Init']
init:
  @cd ./scripts && \
    chmod +x init.sh && \
    ./init.sh

help:
  @just -l

# Run Lint check
[group: 'CI']
lint:
  @pnpm lint

# Run TypeScript type check
[group: 'CI']
typecheck:
  @pnpm typecheck

# Start all services in docker with rebuilding images
[group: 'Dev']
up-build:
  @docker compose up --build

# Start all services in docker
[group: 'Dev']
up:
  @docker compose up

# Stop all services in docker and clean up volumes
[group: 'Dev']
down-clean:
  @docker compose down --volumes

# Stop all services in docker
[group: 'Dev']
down:
  @docker compose down

# Fully wipe local Docker artifacts for this repo: named volumes AND
# locally-built images. Use this instead of `down-clean` when you need a
# genuine from-scratch rebuild — since `anchor build` now runs at image
# build time (see docs/technical-related/challenges/
# 001-program-deployment-performance-issue/001-issue-analysis.md), a fresh
# volume alone reseeds from the still-cached image and is no longer a true
# cold build.
[group: 'Dev']
clean-docker:
  @docker compose down --volumes --rmi local

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


[group: 'On-Chain Program']
program-build:
  @cd ./apps/on-chain-program && \
    anchor build

[group: 'On-Chain Program']
program-keys-sync:
  @cd ./apps/on-chain-program && \
    anchor keys sync