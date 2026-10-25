# Tasks

## 1. On-chain account and password checks

- [ ] 1.1 Update the `Game::INIT_SPACE` test in `state/game.rs` to expect `1 + SALT_BYTES + PASSWORD_HASH_BYTES` more (201), watch `cargo test --manifest-path apps/on-chain-program/Cargo.toml game_init_space` fail, then append `is_private`, `password_salt`, and `password_hash` after `player_count` using `super::user::{SALT_BYTES, PASSWORD_HASH_BYTES}` and watch that test pass
- [ ] 1.2 Add `instructions/game/game_password.rs` with `ensure_password_material` and `ensure_game_is_private`. Write the failing tests first (private + both non-zero ok; private + zero salt, zero hash, or both zero err; public + both zero ok; public + non-zero salt or hash err; `is_private` true ok; false err), then implement them and verify `cargo test --manifest-path apps/on-chain-program/Cargo.toml game_password` passes

## 2. Instructions

- [ ] 2.1 Append `InvalidGamePassword` ("A private game's password salt and hash must each contain a non-zero byte, and a public game's must each be all zeros") and `GameIsNotPrivate` ("Only a private game has a password") at the end of `ErrorCode`. On today's `main` those are `6015` / `0x177F` and `6016` / `0x1780`. If `CannotTransferAdminToSelf` is already last, append after it instead and recompute. Do not insert above an existing variant
- [ ] 2.2 Extend `create_game` with `is_private: bool`, `password_salt: [u8; 16]`, `password_hash: [u8; 64]` at the end of the argument list. Call `ensure_password_material` before writing the game. Set the three fields. Do not call `join_game`. Verify `cargo test --manifest-path apps/on-chain-program/Cargo.toml` passes
- [ ] 2.3 Add `set_game_password.rs` (`admin`, `user`, `game` mut) and the handler in design.md D4's order, calling `super::close_game::ensure_caller_is_admin` rather than defining a new one. Register it in `instructions/game/mod.rs` and `lib.rs`. `join_game` is untouched. Verify `cargo test --manifest-path apps/on-chain-program/Cargo.toml` passes

## 3. On-chain client

- [ ] 3.1 Extend `apps/on-chain-client/src/index.test.ts` so it fails before codegen: `getSetGamePasswordInstructionAsync` is a function, and the two new error constants are numbers. Assert `GAME_TOKEN_WALLET_ERROR__GAME_NOT_IN_REGISTRY` is still `0x177e` unless task 2.1 had to append after a newer variant, in which case assert the actual predecessor
- [ ] 3.2 `anchor build` and `pnpm --filter on-chain-client run codegen`. Confirm the generated `create_game` args are `isPrivate`, `passwordSalt`, `passwordHash` and that no instruction takes a plaintext password string. Verify `pnpm --filter on-chain-client run test` and `pnpm --filter on-chain-client run typecheck` pass
- [ ] 3.3 Pass `isPrivate: false` and 16/64 zero bytes at every existing `getCreateGameInstructionAsync` call site: `apps/on-chain-program-e2e/tests/game/{create_game,join_game,mint_to_player,quit_game,close_game}.test.ts` and `apps/on-chain-program-e2e/tests/general_mode/transfer_token.test.ts`. The frontend action is task 5. Do not change `join_game` call sites

## 4. On-chain integration tests

- [ ] 4.1 Add `apps/on-chain-program-e2e/tests/game/private_game.test.ts` with one shared system signer per test. Verify private create (exact salt and hash, `isPrivate`, `playerCount === 1`, creator ATA, raw length 209) and public create (flag false, both arrays zero). Extend the existing `create_game.test.ts` happy path with the same public-field asserts
- [ ] 4.2 In that file, verify the rejections: private create with a zero hash → `InvalidGamePassword` and no account; public create with a non-zero hash → the same; admin `set_game_password` replaces the bytes and leaves length, `playerCount`, and a second player's balance unchanged; non-admin on a private game → `NotGameAdmin` and bytes unchanged; admin on a public game → `GameIsNotPrivate` and zeros unchanged; zero hash on a private game → `InvalidGamePassword` and the previous bytes unchanged; a `gameId` that was never created writes nothing
- [ ] 4.3 In that file, verify `join_game` against a private game with room succeeds with no password argument, and a private game that already has 20 players still returns `GameFull` with `playerCount` left at 20

## 5. Server Actions

- [ ] 5.1 Extend `createGame` so `isPrivate !== true` sends zeros and does not call `hashPassword`, and `isPrivate: true` runs `validatePassword` then `hashPassword` and sends those bytes. Extend `joinGame(gameAddress, password?)` with design.md D5's order. Add `changeGamePassword({ gameAddress, password })` per design.md D4. List and detail reads add `isPrivate` and do not put the salt or hash on `BrowseGame`, `MemberGame`, or `GameDetail`
- [ ] 5.2 Extend `game.test.ts` (mock `@/server/password` and the two new error codes) and verify: public create does not hash; private create sends the mocked salt and hash and does not include the plaintext; empty and `"Abcdef 12"` on create do not touch the chain; public join does not call `verifyPassword`; wrong password does not call `getJoinGameInstructionAsync` and returns "Incorrect password."; empty join password does not call `verifyPassword`; unknown address returns "Game not found" without `verifyPassword`; already-member and full-game return the existing messages without `verifyPassword`; a correct password joins; an admin with no ATA still needs a password; change-password not signed in, invalid password, game not found, non-admin, and public game each send nothing; success calls `hashPassword` (new salt) with the session username and no caller field on the input; `NotGameAdmin`, `GameIsNotPrivate`, and `InvalidGamePassword` map to the messages in design.md D4. Run `pnpm --filter frontend exec vitest run src/server/actions/game.test.ts`

## 6. Frontend UI

- [ ] 6.1 Create page: Public default, Private reveals `data-testid="create-game-password"`, switching back to Public hides it. Browse row: visibility label, "Enter password" prompt (`data-testid="join-password-form"`), cancel, empty error. Home and detail: the same Public/Private word (`data-testid="game-visibility"`). `AdminControlsModal`: change-password form only when `isPrivate` is true; success closes and calls `router.refresh()`; no second dialog
- [ ] 6.2 Component tests: create form public submit `{ name, isPrivate: false }`, private empty and too-short do not call, private valid calls with the password, toggling back to Public does not require a password (update the existing success assertion, which today expects `{ name }` only). Browse: public Join calls `joinGame(address)` only; private "Enter password" does not call until submit; empty prompt does not call; member Open does not prompt. Home and detail render Private vs Public and do not render a hash. Modal: form present only when private; empty submit does not call; success refreshes; a returned error stays in the modal. Detail page: a non-admin fixture does not render Admin controls. Run the vitest files for those components

## 7. End-to-end

- [ ] 7.1 Add `apps/e2e/tests/private-game.spec.ts` (three contexts, unique usernames, game password distinct from the login password). Verify against the running stack: create private, home shows Private, the creator is a member without a join prompt, the joiner sees the row and "Enter password", a wrong password leaves them on browse with the count still `1/20`, the right password joins, the admin changes the password with no second confirmation, the first joiner still has Open and is still on the roster, and a third user fails the old password and joins with the new one. Existing `game-creation.spec.ts` and `game-joining.spec.ts` stay green with the Public default

## 8. Integration gate

- [ ] 8.1 Run `just lint` and `just test` and confirm the cargo, on-chain e2e, frontend, and Playwright cases above pass. No CircleCI config change. Local or devnet games created before the layout change are unreadable until reset (`just down-clean`); do not add a realloc instruction to make them load

## Workflow follow-up

- After implementation lands and review is satisfied, check off this file, run `openspec-archive-change` for `private-games`, and set ticket 007 to Done in `docs/tickets/007-private-games.md` and `docs/tickets/000-index.md`.
