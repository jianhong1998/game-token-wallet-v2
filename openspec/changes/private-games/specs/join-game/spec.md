## MODIFIED Requirements

### Requirement: Joining a public game
The system SHALL allow any logged-in user to join an active public game (`is_private` false) as a player without a password, creating their Associated Token Account (ATA) for that game's SPL mint, owned by their `User` PDA, signed and paid for by the system admin wallet. Joining a private game is specified by the `private-game` capability.

#### Scenario: Successful join
- **WHEN** a logged-in user who is not yet a player joins an active public game with fewer than 20 players
- **THEN** the system creates their ATA for that game's mint with a zero balance and increments the game's player count by one, and the join does not ask for or check a password
