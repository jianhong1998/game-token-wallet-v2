# Configure Git Hooks
chmod +x ../.hooks/*
git config core.hooksPath ./.hooks
echo "✅ Git hooks are initialized"

# Setup Anchor program keypair
mkdir -p ../apps/on-chain-program/target/deploy
cp ../docker/local/fixtures/game_token_wallet-keypair.dev.json ../apps/on-chain-program/target/deploy/game_token_wallet-keypair.json
echo "✅ Program keypair is configured"