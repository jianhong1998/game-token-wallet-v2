## ADDED Requirements

### Requirement: Player can quit a General Mode game
The system SHALL allow a logged-in player who holds an Associated Token Account (ATA) for a General Mode game's mint to quit that game unconditionally (no blocking on any round/pot state), burning their entire current token balance and closing their ATA, with the reclaimed rent returned to the deployment's admin/system signer.

#### Scenario: Player with a positive balance quits
- **WHEN** a player who holds a positive balance in a game's token submits a `quit_game` request for that game
- **THEN** the system burns their full balance, closes their ATA, and the ATA's rent-exempt lamports are transferred to the admin/system signer

#### Scenario: Player with a zero balance quits
- **WHEN** a player whose game-token balance is zero submits a `quit_game` request
- **THEN** the system closes their ATA and reclaims its rent, without requiring a nonzero balance

#### Scenario: Quitting player no longer appears in player-facing or admin-facing listings
- **WHEN** a player successfully quits a game
- **THEN** they no longer appear in that game's player list, nor in any admin-facing recipient or payout picker, since those are derived from live token accounts for the game's mint and the player's ATA no longer exists

#### Scenario: A player who is not part of the game cannot quit it
- **WHEN** a `quit_game` request is submitted for a game where the caller's ATA does not exist or does not match the expected derivation for their `User` PDA and the game's mint
- **THEN** the system rejects the request with an error indicating the caller is not a player in that game

### Requirement: Game admin cannot quit their own game
The system SHALL reject a `quit_game` request from the player recorded as the game's admin, with a distinct error, since quitting would leave the game permanently without an admin.

#### Scenario: Admin attempts to quit
- **WHEN** the game's admin submits a `quit_game` request for their own game
- **THEN** the system rejects the transaction with an `AdminCannotQuitGame` error and makes no changes to the admin's balance, ATA, or the game's player count

### Requirement: A quit player can rejoin the same game
The system SHALL allow a player who has quit a game to subsequently rejoin it via the existing join flow, since a closed ATA is indistinguishable from having never joined.

#### Scenario: Rejoin after quitting
- **WHEN** a player who previously quit a game submits a join request for that same game
- **THEN** the system creates a new ATA for them with a zero balance, exactly as it would for a first-time joiner

### Requirement: Frontend quit confirmation
The system SHALL present a "Quit game" action on the game detail page to non-admin players only, requiring an explicit confirmation step in a styled in-app modal (not a native browser dialog) before submitting the quit, since the underlying burn is irreversible.

#### Scenario: Non-admin player sees the quit action
- **WHEN** a non-admin player views a General Mode game they belong to
- **THEN** the game detail page shows a "Quit game" action

#### Scenario: Admin does not see the quit action
- **WHEN** the game's admin views their own game
- **THEN** the game detail page does not show a "Quit game" action

#### Scenario: Confirmation required before quitting
- **WHEN** a non-admin player activates the "Quit game" action
- **THEN** the system shows a styled confirmation modal explaining the balance will be burned and cannot be recovered, and only submits the quit transaction if the player confirms

#### Scenario: Redirect after successful quit
- **WHEN** a player's quit transaction succeeds
- **THEN** the system redirects them to the home dashboard
