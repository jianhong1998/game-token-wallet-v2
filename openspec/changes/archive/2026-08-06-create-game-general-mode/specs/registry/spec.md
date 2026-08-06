## MODIFIED Requirements

### Requirement: Active-game count reflects registry population, not yet game creation
The system SHALL report the `Registry` account's active-game count as the actual number of open games created via `create_game`. Game creation is the capability that adds entries to the list (closing/quitting a game will later prune it, per tickets 011/013 — still out of scope here).

#### Scenario: Count increases as games are created
- **WHEN** a user successfully creates a game via `create_game`
- **THEN** the `Registry`'s active-game count increases by one and its active-games list includes the new game's address

#### Scenario: No games exist yet
- **WHEN** the active-game count is read from a freshly initialized `Registry` account before any game has been created
- **THEN** the count is 0

## ADDED Requirements

### Requirement: Registry capacity enforcement
The system SHALL reject a `create_game` transaction with a clear `RegistryFull` error once the `Registry`'s active-games list is already at `MAX_ACTIVE_GAMES` (128) capacity, leaving the registry and all other state untouched — no partial insertion, no corrupted registry state.

#### Scenario: Registry at capacity rejects the next game creation
- **WHEN** the `Registry`'s active-games list already holds 128 entries and another game creation is attempted
- **THEN** the system rejects the entire transaction with a `RegistryFull` error, and the registry's active-games list is left unchanged
