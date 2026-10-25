## Purpose

Lets the current game admin hand the single admin role to another player already in the same game, without removing either player or moving their tokens.

## ADDED Requirements

### Requirement: Current admin can transfer the role to another player
The system SHALL let the current game admin transfer that role to another user who is already a player in the same game, by overwriting `Game.admin` with the target player's `User` PDA and changing nothing else on the account.

#### Scenario: Successful transfer
- **WHEN** the current admin submits `transfer_game_admin` naming another user who already holds an initialized associated token account for that game's mint
- **THEN** `Game.admin` becomes that user's `User` PDA, the `Game` account address and size are unchanged, and both players remain in the game

#### Scenario: A zero-balance player can become admin
- **WHEN** the current admin transfers the role to a player whose game-token balance is zero
- **THEN** the transfer succeeds and that player's balance stays zero

#### Scenario: Token balances are untouched
- **WHEN** a transfer succeeds
- **THEN** neither the former admin's nor the new admin's game-token balance changes

#### Scenario: Player count is untouched
- **WHEN** a transfer succeeds
- **THEN** `Game.player_count` is the same value it had before the transfer

### Requirement: Only the session's current admin may transfer
The system SHALL reject a transfer unless the acting user's session username resolves to the `User` PDA stored in `Game.admin`. The deployment's system wallet signs and pays for every transaction, so admin identity is that username check — the same one deposits use — and not which keypair signed.

#### Scenario: Non-admin caller rejected on-chain
- **WHEN** a `transfer_game_admin` transaction is submitted whose caller `User` PDA is not `Game.admin`
- **THEN** the on-chain program rejects it with `NotGameAdmin` and leaves `Game.admin` unchanged

#### Scenario: Caller identity comes from the session
- **WHEN** a signed-in user submits a transfer
- **THEN** the system uses that session's username as the caller and provides no field by which the request can name a different caller

#### Scenario: Signed-out request rejected before the chain
- **WHEN** a transfer is submitted with no signed-in session
- **THEN** the system rejects it with a not-signed-in error and sends no transaction

### Requirement: Transfer to self is rejected
The system SHALL reject a transfer whose target is the current admin, with the dedicated `CannotTransferAdminToSelf` error, and SHALL NOT treat that case as a successful no-op.

#### Scenario: Admin names themselves on-chain
- **WHEN** the current admin submits `transfer_game_admin` with their own user as the target
- **THEN** the on-chain program rejects it with `CannotTransferAdminToSelf` and leaves `Game.admin`, both balances, and `player_count` unchanged

#### Scenario: Self-transfer rejected before touching the chain
- **WHEN** the current admin submits a transfer naming their own username
- **THEN** the system rejects the request before sending a transaction, with a message that they cannot transfer the admin role to themselves

#### Scenario: Player picker excludes the current admin
- **WHEN** the current admin opens the transfer control
- **THEN** their own username is not listed as a choice

### Requirement: Target must already be a player in the game
The system SHALL accept a target only when an initialized associated token account for that user's `User` PDA and the game's mint is supplied, and SHALL NOT create one. A missing or uninitialized account is `PlayerNotInGame`. An account whose address is not that derivation is `InvalidPlayerAta`.

#### Scenario: Transfer to a non-member rejected on-chain
- **WHEN** the current admin submits `transfer_game_admin` for a user who has no initialized associated token account for that game's mint
- **THEN** the on-chain program rejects it with `PlayerNotInGame` and leaves `Game.admin` unchanged

#### Scenario: Wrong token-account address rejected on-chain
- **WHEN** a `transfer_game_admin` transaction supplies a token account that is not the associated token account for the target user and the game's mint
- **THEN** the on-chain program rejects it with `InvalidPlayerAta` and leaves `Game.admin` unchanged

#### Scenario: Non-member message before a successful write
- **WHEN** the current admin submits a transfer naming a user who is not a player in the game
- **THEN** the system reports that the player has not joined this game, and `Game.admin` is unchanged

### Requirement: Closed or unknown game is rejected
The system SHALL reject a transfer for a game account that does not exist, including a game that has already been closed, and SHALL NOT create or modify any account.

#### Scenario: Unknown or closed game rejected before sending
- **WHEN** a signed-in user submits a transfer for an address that is not a live `Game` account
- **THEN** the system rejects it with a game-not-found error and sends no transaction

#### Scenario: On-chain transfer against a missing game writes nothing
- **WHEN** a `transfer_game_admin` transaction names a game account that does not exist
- **THEN** the transaction fails and no account is created or modified

### Requirement: Admin powers follow the new admin
The system SHALL grant the existing admin-only actions to the user now stored in `Game.admin`, and SHALL deny them to the former admin, enforced on-chain and not only by hiding controls. Those actions are mint/deposit and close game. Private-game password management is not part of this change.

#### Scenario: Former admin can no longer deposit
- **WHEN** the former admin submits a deposit for this game after a successful transfer
- **THEN** the system rejects it with `NotGameAdmin` and no balance changes

#### Scenario: New admin can deposit
- **WHEN** the new admin submits a positive deposit for a player in this game
- **THEN** the system mints that amount into the target player's balance

#### Scenario: Former admin can no longer close the game
- **WHEN** the former admin submits a close-game request after a successful transfer
- **THEN** the system rejects it with `NotGameAdmin` and the game stays open

#### Scenario: New admin is the one authorized to close
- **WHEN** the new admin submits a close-game request that still has players
- **THEN** the system does not reject it as `NotGameAdmin`

### Requirement: Former admin can quit and the new admin cannot
The system SHALL allow the former admin, once they are no longer `Game.admin`, to leave through the existing quit-game flow, and SHALL keep rejecting quit from the user who now holds the role, with `AdminCannotQuitGame`.

#### Scenario: Former admin quits after transferring
- **WHEN** the former admin submits `quit_game` for that game after a successful transfer
- **THEN** the quit succeeds: their remaining balance is burned, their associated token account is closed, and `player_count` decreases by one

#### Scenario: New admin cannot quit
- **WHEN** the new admin submits `quit_game` for that game
- **THEN** the system rejects it with `AdminCannotQuitGame` and leaves their balance, their associated token account, and `player_count` unchanged

#### Scenario: Quit control follows the role in the UI
- **WHEN** each of them views the game detail page after a successful transfer
- **THEN** the former admin sees the quit action and the new admin does not

### Requirement: Transfer control on the game detail page
The system SHALL show a "Transfer admin role" action only to the current admin, on that game's detail page, listing the other current players. Choosing one and submitting transfers immediately: the new admin does not accept, and there is no second confirmation step. On success the same page updates in place.

#### Scenario: Admin sees the other players
- **WHEN** the current admin opens the transfer control and the game has other players
- **THEN** each other current player is listed as a choice, and the current admin is not

#### Scenario: Non-admin does not see the control
- **WHEN** a player who is not the current admin views the game detail page
- **THEN** the page does not show a transfer-admin action

#### Scenario: Empty selection rejected before the chain
- **WHEN** the current admin submits the transfer control without choosing a player
- **THEN** the system rejects the request before sending a transaction, with a message telling them to select a player

#### Scenario: Only player in the game has nobody to transfer to
- **WHEN** the current admin is the only player and opens the transfer control
- **THEN** the choice list has no player they can select

#### Scenario: Page updates in place after success
- **WHEN** the current admin successfully transfers the role
- **THEN** the system stays on that game's detail page, the former admin no longer sees admin-only actions, and the new admin sees them on their next load of the page

#### Scenario: Home list admin label follows the role
- **WHEN** both users view their games list after a successful transfer
- **THEN** the game is identified as administered by the new admin and not by the former admin, and it still appears for both while the former admin remains a player
