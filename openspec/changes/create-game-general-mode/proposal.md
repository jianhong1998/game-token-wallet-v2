## Why

A logged-in user currently has no way to create a game. Ticket 005 is the first capability that lets any registered user tokenize an offline game session: they create a game, the program mints its own 2-decimal SPL token, and the creator becomes admin — unblocking every downstream ticket (006 join, 007 private games, 008 deposits, 009 transfers, ...) that assumes a `Game` already exists.

## What Changes

- New `create_game` on-chain instruction: takes a client-generated UUID v7 `game_id` and a `name`, creates the `Game` PDA (seeded `["game", game_id]`) and its own SPL mint (2 decimals, `Game` PDA as mint authority, legacy SPL Token program), sets the creator's `User` PDA as `Game.admin`, and appends the new `Game`'s address to the `Registry`.
- `Game` account stores `game_id`, `name`, a `mode` enum (`General`/`Poker`/`Pool` — only `General` is functional; no argument accepted for it yet), `admin`, and `mint`. No `is_private`/`password_hash` field yet (ticket 007) and no `players` list yet (ticket 006) — both are added later via account `realloc` when those tickets land.
- Registry insertion is rejected with a new `RegistryFull` error once `MAX_ACTIVE_GAMES` (128) is reached, leaving all state untouched (no partial/corrupted registry writes — Anchor transactions are all-or-nothing).
- Game name validation (3–32 UTF-8 bytes, Unicode letter/number/space charset, NFC-normalized, no case-folding) is enforced in the frontend form, the Next.js Server Action, and the on-chain program.
- New frontend: `/games/new` creation form (name only — no mode selector, General Mode is implicit) and `/games` "My Games" list (fetches the registry, filters to games the current user administers).
- Hand-rolled UUID v7 generator (`apps/frontend/src/server/game-id.ts`) — no new frontend dependency.
- New dependencies: `anchor-spl` (production, on-chain program) and `@solana-program/token` (test-only devDependency, `on-chain-program-e2e`).

## Capabilities

### New Capabilities
- `game`: creating a General Mode, public game — the `Game` account, its SPL mint, `create_game`, and the frontend creation form + "My Games" list.

### Modified Capabilities
- `registry`: the existing spec states active-game count is always 0 because "no capability currently adds entries to the list." That's no longer true — `create_game` now populates `Registry.active_games`, and insertion can fail with `RegistryFull` once the list is at capacity.

## Impact

- Affected on-chain: `apps/on-chain-program/programs/game_token_wallet/src/state/game.rs` (new), `src/errors.rs`, `src/instructions/game/create_game.rs` (new), `src/lib.rs`, `Cargo.toml` (new `anchor-spl` dependency).
- Affected client generation: `apps/on-chain-client` (regenerated from the updated IDL).
- Affected frontend: `apps/frontend/src/lib/game-name.ts` (new), `src/server/game-id.ts` (new), `src/server/actions/game.ts` (new), `src/app/(app)/games/new/page.tsx` (new), `src/app/(app)/games/page.tsx` (new).
- Affected tests: `apps/on-chain-program-e2e/tests/game/create_game.test.ts` (new, plus new `@solana-program/token` devDependency), `apps/e2e/tests/game-creation.spec.ts` (new).
- No changes to `user` capability or session/auth mechanics — `create_game` only reads an existing `User` account (the creator's), never writes one.
