# 011 — Quit game

**What to build:** A player can leave a game, forfeiting their current in-game balance.

**Blocked by:** 009

**Status:** Done — PR [#33](https://github.com/jianhong1998/game-token-wallet-v2/pull/33), all CI checks passing (cargo-test, on-chain-program-e2e, web-unit-tests, e2e, lint, typecheck).

- [x] `quit_game` instruction burns the player's remaining game-token balance, closes their ATA (rent reclaimed), and removes them from the game's player list. (`apps/on-chain-program/programs/game_token_wallet/src/instructions/game/quit_game.rs`)
- [x] Allowed unconditionally — no blocking on round/pot state (per [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q11). This ticket only needs General Mode to exist, so there's no pot to reconcile yet.
- [x] Frontend has a "quit game" action with a confirmation step, since the burn is irreversible. (`apps/frontend/src/app/(app)/games/[address]/QuitGameButton.tsx`)
- [x] After quitting, the player no longer appears in the game's player list or in admin-facing recipient/payout pickers.

Design decisions recorded in `openspec/changes/quit-game/design.md` (D1: quitting player is caller, self-authorized like `TransferToken`; D3: `Game` account write-locking serializes concurrent quit/join for free; D4: burn amount is always the ATA's actual balance, never client-supplied; D5: reclaimed rent goes to `admin`, the fee-payer).
