## MODIFIED Requirements

### Requirement: Active-game count reflects registry population, not yet game creation
The system SHALL report the `Registry` account's active-game count as the actual number of currently open games. `create_game` adds an entry to the list; closing a game via `close_game` removes its entry from the list via swap-remove.

#### Scenario: Count increases as games are created
- **WHEN** a user successfully creates a game via `create_game`
- **THEN** the `Registry`'s active-game count increases by one and its active-games list includes the new game's address

#### Scenario: No games exist yet
- **WHEN** the active-game count is read from a freshly initialized `Registry` account before any game has been created
- **THEN** the count is 0

#### Scenario: Count decreases as games are closed
- **WHEN** a game's admin successfully closes that game via `close_game`
- **THEN** the `Registry`'s active-game count decreases by one and its active-games list no longer includes that game's address
