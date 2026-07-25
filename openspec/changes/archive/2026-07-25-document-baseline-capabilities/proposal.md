## Why

OpenSpec was just initialized for this repo, but two capabilities are already shipped and undocumented in `openspec/specs/`: user registration/login and registry-account initialization. This change back-fills baseline specs for exactly what exists in code today, so future proposals have real ground truth to diff against instead of starting from nothing.

## What Changes

- Document the `user` capability as it exists today: registration (on-chain `create_user` + off-chain scrypt password hashing) and login (credential verification + HMAC-signed session cookie).
- Document the `registry` capability as it exists today: idempotent initialization of the singleton `Registry` PDA. Population of the active-game list is explicitly out of scope — no `create_game` instruction exists yet.
- No code changes. This is retroactive documentation of already-shipped behavior (tickets 002, 003).

## Capabilities

### New Capabilities
- `user`: registration and login for username/password accounts backed by a per-user on-chain PDA.
- `registry`: singleton on-chain discovery index, initialization only.

### Modified Capabilities
(none — both capabilities are new to `openspec/specs/`)

## Impact

- Affected: `openspec/specs/user/spec.md`, `openspec/specs/registry/spec.md` (created).
- Source of truth used: `apps/frontend/src/server/actions/{auth,registry}.ts`, `apps/frontend/src/server/{password,session}.ts`, `apps/on-chain-program/programs/game_token_wallet/src/instructions/{user/create_user,registry/initialize}.rs`.
- Game creation, general/poker/pool modes, deposit/mint, admin transfer, quit/close/delete (tickets 005–016) are architecturally decided but not implemented — deliberately excluded from this baseline; they become their own openspec changes when actually built.
