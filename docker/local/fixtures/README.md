# Local-dev fixtures

## `game_token_wallet-keypair.dev.json`

A throwaway, non-secret Solana keypair — **not** a mainnet/devnet key, and
not meant to hold real value. It exists solely as the `game_token_wallet`
program's fixed **deploy identity** for the local Docker Compose dev loop
(and CI's `docker-compose.e2e.yml` stack), committed deliberately so the
deployed program address is reproducible across machines and rebuilds.

Same pattern as `SYSTEM_ADMIN_SECRET_KEY` in `docker-compose.yml` /
`docker-compose.e2e.yml`: a fixed, committed, throwaway keypair beats a
gitignored one for local dev, because gitignored keypairs regenerate
randomly whenever they go missing (fresh clone, another `anchor build`
elsewhere on the host, etc.), silently drifting out of sync with the
`declare_id!`/`Anchor.toml`/`PROGRAM_ID` values that are committed to
source.

`docker/local/Dockerfile.anchor`'s CMD copies this file to
`apps/on-chain-program/target/deploy/game_token_wallet-keypair.json`
*before* running `anchor build`, so every container run builds and
deploys the program to the exact same address:
`FHRNx4KK4WzMxXx7X6sK84RvKTKuDVtTGduW3eH9QN9t`

That address must always match:
- `declare_id!(...)` in `apps/on-chain-program/programs/game_token_wallet/src/lib.rs`
- `[programs.localnet]` in `apps/on-chain-program/Anchor.toml`
- `PROGRAM_ID` in `docker-compose.yml` and `docker-compose.e2e.yml`
- `GAME_TOKEN_WALLET_PROGRAM_ADDRESS` in the generated on-chain-client
  (`packages/on-chain-client/src/generated/`)

If this keypair is ever regenerated, re-run `anchor build && anchor keys
sync && anchor build` locally with the new keypair at
`apps/on-chain-program/target/deploy/game_token_wallet-keypair.json`, then
update all of the above to match, then regenerate the client
(`pnpm --filter on-chain-client run codegen`).
