#!/usr/bin/env bash
# Local-dev container entrypoint (docker/local/Dockerfile.anchor), run on
# every `docker compose up` against the `.:/workspace` bind mount — not
# baked into the image, so edits here take effect without a rebuild.
set -euo pipefail

# Seeds target/deploy/game_token_wallet-keypair.json from the committed
# throwaway fixture (docker/local/fixtures/game_token_wallet-keypair.dev.json,
# see the README alongside it) BEFORE `anchor build` runs. That gitignored
# keypair file is what determines the program's actual deployed address;
# without seeding it here, `anchor build` mints a brand-new random keypair
# whenever it's missing (fresh clone, another `anchor build` elsewhere on
# the host, etc.), silently drifting the deployed address out of sync with
# the `declare_id!`/`Anchor.toml`/`PROGRAM_ID` values committed to source.
# Seeding from a fixed, committed fixture guarantees the same deployed
# address on every container run, on every machine.
mkdir -p apps/on-chain-program/target/deploy
cp docker/local/fixtures/game_token_wallet-keypair.dev.json apps/on-chain-program/target/deploy/game_token_wallet-keypair.json

# Airdrops to two distinct wallets: this container's fixed deployer keypair
# (seeded in the Dockerfile, pays for `anchor build`/`anchor deploy`) and,
# separately, the frontend's SYSTEM_ADMIN_SECRET_KEY dev wallet (address
# 8BLQ33YJwJriwmS5RYYzkUfQp6ZwViXodKf1LcEZSsVV, a fixed key set directly in
# docker-compose.yml) — that wallet pays for every `noop` transaction the
# frontend submits, and without funding it here every transaction fails
# with "Attempt to debit an account but found no record of a prior credit."
solana airdrop 10 --url "$ANCHOR_PROVIDER_URL"
solana airdrop 10 8BLQ33YJwJriwmS5RYYzkUfQp6ZwViXodKf1LcEZSsVV --url "$ANCHOR_PROVIDER_URL"

cd apps/on-chain-program
anchor build
anchor deploy --provider.cluster "$ANCHOR_PROVIDER_URL"
cd ../..

pnpm install --frozen-lockfile
pnpm --filter on-chain-client run codegen
