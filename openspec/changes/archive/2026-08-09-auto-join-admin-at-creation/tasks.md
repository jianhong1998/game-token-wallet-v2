## 1. On-chain program

- [x] 1.1 In `apps/on-chain-program/programs/game_token_wallet/src/instructions/game/create_game.rs`, add `player_ata: Account<'info, TokenAccount>` to `CreateGame`'s accounts struct with `#[account(init, payer = admin, associated_token::mint = mint, associated_token::authority = user)]`, and add `associated_token_program: Program<'info, AssociatedToken>`.
- [x] 1.2 Update imports (`anchor_spl::associated_token::AssociatedToken`, `anchor_spl::token::TokenAccount`) accordingly.
- [x] 1.3 In the handler, set `game.player_count = 1;` alongside the existing field assignments. No new `require!` checks.
- [x] 1.4 `cargo test --manifest-path apps/on-chain-program/Cargo.toml` — confirm no regressions (no new unit tests expected per design.md Decision 2/3 rationale).

## 2. Client regeneration

- [x] 2.1 `cd apps/on-chain-program && anchor build` to regenerate the IDL with `create_game`'s new accounts.
- [x] 2.2 `pnpm --filter on-chain-client run codegen` to regenerate the Codama TS client.
- [x] 2.3 `pnpm --filter on-chain-client run test` — confirm the regenerated client builds/typechecks cleanly.

## 3. On-chain e2e coverage

- [x] 3.1 In `apps/on-chain-program-e2e/tests/game/create_game.test.ts`, extend the "creates the Game account, its mint, and appends it to the registry" test: derive the creator's `User` PDA and expected ATA (`findAssociatedTokenPda`), assert `fetchToken(rpc, playerAta)` returns `owner === userAddress` and `amount === 0n`, and assert `fetchGame(...).data.playerCount === 1`.
- [x] 3.2 `just test-e2e-program` — confirm the extended test and all existing `create_game`/`join_game` e2e tests still pass.

## 4. Verification

- [x] 4.1 `just up-build` (or `just up` if already built) against a freshly reset local stack; manually create a game as a logged-in user and confirm via the game-detail page (`/games/[address]`, from ticket 006) that the creator appears in the players list with a zero balance immediately, with no `join_game` call.
- [x] 4.2 `just lint` and `just typecheck` — confirm no regressions from the regenerated client.
- [x] 4.3 Update `openspec/changes/auto-join-admin-at-creation/tasks.md` checkboxes to reflect completion, then run `openspec-sync-specs` (or archive once ticket 021 is fully closed) to fold the delta spec into `openspec/specs/game/spec.md`.
- [x] 4.4 Update `docs/tickets/021-auto-join-admin-at-creation.md` (check off ACs) and `docs/tickets/000-index.md` (status → Done).
