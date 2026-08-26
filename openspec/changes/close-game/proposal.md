## Why

A game admin currently has no way to end a General Mode game. Once created, a
game's mint, `Game` PDA, and every player's Associated Token Account (ATA)
persist forever, and its entry in the `Registry` is never pruned (the
`registry` capability's active-game count only ever grows). Ticket 013
requires the admin to be able to permanently close a game — burning
outstanding balances and reclaiming all rent — so finished games stop
cluttering the browse list and stop occupying on-chain rent.

## What Changes

- Add a new admin-authorized `close_game_player` instruction: burns whatever
  balance a single specified player's ATA holds, closes that ATA (rent to the
  system admin signer), and decrements `Game.player_count` by one. Works
  identically whether the target is the admin's own player slot or another
  player's — same code path, no special-casing.
- Add a new admin-authorized `close_game` instruction: requires
  `Game.player_count == 0` (every player, including the admin, already closed
  out via `close_game_player`) — **BREAKING for callers who skip that
  precondition**: it hard-rejects with a distinct error and makes no state
  changes otherwise. On success, closes the `Game` PDA itself (full rent
  reclaim, no trace left) and removes the game's entry from
  `Registry.active_games` via swap-remove. The game's mint is **not**
  closed — the legacy SPL Token program has no instruction capable of
  closing/reclaiming rent from a `Mint` account (only Token-2022's
  `MintCloseAuthority` extension supports that, which this project's mints
  don't use); its one-time rent is a permanent, accepted per-game cost.
- Add a `closeGame` Server Action that discovers every current player of a
  game (reusing the existing token-program scan already used by
  `fetchGameDetail`), chunks `close_game_player` calls across transactions
  (reusing the existing chunking helper), then sends the final `close_game`
  instruction. The whole action is idempotent/safely re-invocable: a partial
  failure can be resumed by calling it again, since player discovery always
  re-scans live state.
- Add an admin-only "Close game" action on the game detail page, gated behind
  a styled in-app confirmation modal (mirroring the existing quit-game
  confirmation), warning that the game and all balances are permanently and
  irreversibly destroyed.
- Prune the `Registry`'s active-games list on game closure — the first
  consumer of removal from that list (previously append-only).

Scope is General Mode only. Poker/Pool pot-burning (tickets 015/016) will
later extend `close_game_player`/`close_game`, but nothing Poker/Pool-specific
is built here.

## Capabilities

### New Capabilities
- `close-game`: admin-only capability to permanently end a General Mode game
  — burning every remaining player's balance (including the admin's own),
  closing every player ATA and the `Game` PDA, and pruning the game from the
  `Registry` (the mint itself is not closable and its rent is a permanent
  cost — see design.md), with a resumable/idempotent client-side close flow
  and an in-app confirmation UI.

### Modified Capabilities
- `registry`: adds the first removal path for `Registry.active_games`
  (swap-remove on game closure), fulfilling the "closing/quitting will later
  prune it" note already in that spec's requirements.
- `game`: `Game.player_count` can now also reach zero via admin-driven
  `close_game_player` calls (not just player-initiated quits), and the `Game`
  account itself can now be closed entirely as part of game closure.

## Impact

- **On-chain program** (`apps/on-chain-program`): two new instructions
  (`close_game_player`, `close_game`), a new error variant for the
  non-empty-game rejection, registry swap-remove logic, `Game`-account
  closing (the mint is read-only in `close_game_player` and untouched by
  `close_game` — see design.md for why it can't be closed).
- **On-chain client** (`apps/on-chain-client`): regenerated IDL/Codama client
  picks up the two new instructions and error variant automatically.
- **Frontend** (`apps/frontend`): new `closeGame` Server Action in
  `src/server/actions/game.ts`; new admin-only "Close game" UI + confirmation
  modal on the game detail page; `listBrowseGames`/`listMyMemberGames`
  automatically reflect closure once the registry entry and `Game` account
  are gone (no code change needed there, but covered by tests).
- **Tests**: on-chain Rust unit tests (inline, per instruction file),
  `on-chain-program-e2e` integration tests, Server Action unit tests,
  frontend component tests for the confirmation modal.
