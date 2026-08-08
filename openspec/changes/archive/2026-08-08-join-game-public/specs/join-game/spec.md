## ADDED Requirements

### Requirement: Joining a public game
The system SHALL allow any logged-in user to join an active game as a player, creating their Associated Token Account (ATA) for that game's SPL mint, owned by their `User` PDA, signed and paid for by the system admin wallet.

#### Scenario: Successful join
- **WHEN** a logged-in user who is not yet a player joins an active game with fewer than 20 players
- **THEN** the system creates their ATA for that game's mint with a zero balance and increments the game's player count by one

### Requirement: Player cap enforcement
The system SHALL reject a join attempt with a dedicated `GameFull` error once a game already has 20 players (the PRD's fixed per-game player cap), leaving all state untouched.

#### Scenario: Game at capacity rejects the next join
- **WHEN** a game already has 20 players and another user attempts to join
- **THEN** the system rejects the transaction with a `GameFull` error and the game's player count remains 20

### Requirement: Duplicate join rejection
The system SHALL reject a join attempt with a dedicated `AlreadyJoinedGame` error if the user is already a player in that game, rather than a generic account-creation failure.

#### Scenario: Already-joined user attempts to join again
- **WHEN** a user who already has an ATA for a game's mint attempts to join that same game again
- **THEN** the system rejects the transaction with an `AlreadyJoinedGame` error and the game's player count is unchanged

### Requirement: Browsing active games
The system SHALL let any logged-in user view a list of every active game currently in the `Registry`, each showing its name, mode, and current player count.

#### Scenario: Browse list reflects registry population
- **WHEN** a logged-in user views the browse-games page
- **THEN** the system shows every game currently in the `Registry`, each with its current player count

#### Scenario: Row reflects the viewer's own membership
- **WHEN** a logged-in user views the browse-games page
- **THEN** each row indicates whether the viewer is already a player in that game (offering to open it) or not (offering to join it)

### Requirement: Viewing a game's player roster
The system SHALL let a logged-in user view a given game's details: its name and mode, an admin indicator when the viewer is that game's admin, the viewer's own token balance in that game, and the full list of current players with each player's username and balance.

#### Scenario: Roster shows all current players
- **WHEN** a logged-in user views an active game's detail page
- **THEN** the system shows every player currently holding a balance-tracking ATA for that game's mint, each with their username and current balance

#### Scenario: Roster updates after a new join
- **WHEN** a new player joins a game and the detail page is viewed again
- **THEN** the newly joined player appears in the roster with a zero balance
