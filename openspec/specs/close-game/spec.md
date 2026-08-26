## Purpose

Admin-only capability to permanently end a General Mode game: burning every remaining player's balance (including the admin's own), closing every player Associated Token Account (ATA) and the `Game` PDA, and pruning the game from the `Registry`. The game's SPL mint is not closable (legacy SPL Token program has no rent-reclaim instruction for a `Mint` account) and its rent is an accepted permanent per-game cost. Scope is General Mode only — Poker/Pool pot-burning (tickets 015/016) extend `close_game_player`/`close_game` later.

## Requirements

### Requirement: Admin can close out a single player during game closure
The system SHALL allow the game's admin to burn a single specified player's entire token balance and close that player's Associated Token Account (ATA) for a General Mode game, decrementing `Game.player_count` by one. This works identically whether the target player is the admin's own player slot or any other player — the same instruction and code path handles both.

#### Scenario: Admin closes a non-admin player with a positive balance
- **WHEN** the game's admin submits a `close_game_player` request targeting a player who holds a positive balance
- **THEN** the system burns that player's full balance, closes their ATA, transfers the reclaimed rent to the system admin wallet, and decrements `Game.player_count` by one

#### Scenario: Admin closes a player with a zero balance
- **WHEN** the game's admin submits a `close_game_player` request targeting a player whose balance is zero
- **THEN** the system closes their ATA and reclaims its rent without requiring a nonzero balance

#### Scenario: Admin closes their own player slot
- **WHEN** the game's admin submits a `close_game_player` request targeting their own username
- **THEN** the system burns the admin's own balance and closes the admin's own ATA exactly as it would for any other player, with no special-cased behavior

#### Scenario: Targeting a player who isn't in the game is rejected
- **WHEN** a `close_game_player` request targets a player whose ATA does not exist or does not match the expected derivation for their `User` PDA and the game's mint
- **THEN** the system rejects the request with an error indicating the target is not a player in that game

#### Scenario: Only the game's admin can close players out
- **WHEN** a `close_game_player` request is submitted by a caller who is not the game's recorded admin
- **THEN** the system rejects the transaction with an error indicating only the game's admin may perform this action

### Requirement: Admin can finalize closing an empty game
The system SHALL allow the game's admin to permanently close a General Mode game — closing the `Game` account itself and removing the game's entry from the `Registry` — only once every player (including the admin) has already been closed out via `close_game_player`, reclaiming that rent to the system admin wallet. This instruction makes no changes to any account if the precondition is not met. The game's SPL mint is not closed by this instruction: the legacy SPL Token program (used for every game's mint, per the `game` capability) has no instruction capable of closing or reclaiming rent from a `Mint` account, so the mint's rent remains permanently locked as an accepted, unavoidable per-game cost.

#### Scenario: Closing an empty game succeeds
- **WHEN** the game's admin submits a `close_game` request for a game whose `player_count` is zero
- **THEN** the system closes the `Game` account, removes the game's entry from the `Registry`'s active-games list, and transfers the `Game` account's reclaimed rent to the system admin wallet

#### Scenario: The game's mint is not closed
- **WHEN** a game is successfully closed via `close_game`
- **THEN** the game's SPL mint account continues to exist on-chain, unclosed, since the legacy SPL Token program provides no way to close or reclaim rent from a mint account

#### Scenario: Closing a game that still has players is rejected
- **WHEN** the game's admin submits a `close_game` request for a game whose `player_count` is greater than zero
- **THEN** the system rejects the transaction with a distinct error and makes no changes to the game's mint, the `Game` account, or the `Registry`

#### Scenario: Only the game's admin can finalize closure
- **WHEN** a `close_game` request is submitted by a caller who is not the game's recorded admin
- **THEN** the system rejects the transaction with an error indicating only the game's admin may perform this action

### Requirement: Game closure succeeds regardless of in-progress activity
The system SHALL NOT block a game closure attempt on any round, pot, or other in-progress activity state — General Mode has no such state to check, and this instruction is not gated on anything beyond the player-count precondition above.

#### Scenario: Closure is not blocked by unrelated game activity
- **WHEN** the game's admin closes out every player and finalizes closure
- **THEN** the system does not require any additional precondition beyond `player_count` being zero

### Requirement: Client-side close flow is resumable and reports partial progress
The system SHALL provide a single admin-facing action that discovers every current player of a game, closes each one out, and finalizes closure, reporting how many players were successfully closed if the flow does not complete, and SHALL make this action safe to retry from scratch at any point without requiring separate resume-state.

#### Scenario: Full success
- **WHEN** the admin triggers game closure and every player-close and the final close instruction all succeed
- **THEN** the system reports success and the game is fully closed

#### Scenario: Partial failure reports progress
- **WHEN** the admin triggers game closure and a player-close step fails partway through
- **THEN** the system reports how many players were successfully closed out of the total discovered, and does not report the closure as having succeeded

#### Scenario: Retrying after a partial failure resumes correctly
- **WHEN** the admin retries game closure after a previous partial failure
- **THEN** the system re-discovers which players still remain (based on live on-chain state, not any previously recorded progress) and continues closing only those, without attempting to re-close players already closed

#### Scenario: Retrying after a full success is handled gracefully
- **WHEN** the admin retries game closure after it already completed successfully
- **THEN** the system reports that the game no longer exists rather than throwing an unhandled error

### Requirement: Closed game disappears from all listings
The system SHALL ensure that once a game is fully closed, it no longer appears in the browse-games list or in any player's own member-games list, since both are derived from the `Registry`'s active-games list and live on-chain account state.

#### Scenario: Closed game is absent from browse listing
- **WHEN** a game has been fully closed
- **THEN** the browse-games list no longer includes that game

#### Scenario: Closed game is absent from a former player's own games list
- **WHEN** a game has been fully closed
- **THEN** it no longer appears in the game list of any user who was previously a player or admin of that game

### Requirement: Frontend close confirmation
The system SHALL present a "Close game" action on the game detail page to the game's admin only, requiring an explicit confirmation step in a styled in-app modal (not a native browser dialog) before submitting the closure, since the underlying burn and account closures are irreversible.

#### Scenario: Admin sees the close action
- **WHEN** the game's admin views their own game
- **THEN** the game detail page shows a "Close game" action

#### Scenario: Non-admin players do not see the close action
- **WHEN** a non-admin player views a game they belong to
- **THEN** the game detail page does not show a "Close game" action

#### Scenario: Confirmation required before closing
- **WHEN** the admin activates the "Close game" action
- **THEN** the system shows a styled confirmation modal explaining that the game and every player's balance will be permanently destroyed, and only submits the closure if the admin confirms

#### Scenario: Redirect after successful closure
- **WHEN** the admin's game closure completes successfully
- **THEN** the system redirects them to the home dashboard
