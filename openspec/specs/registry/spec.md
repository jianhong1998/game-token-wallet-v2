## Purpose

Singleton on-chain discovery index for the deployment, avoiding `getProgramAccounts` scans for "browse games" (see project context — architecture Q4). Population happens on game creation, bounded by a fixed capacity.

## Requirements

### Requirement: Registry initialization
The system SHALL provide a singleton on-chain `Registry` account (PDA seeded `["registry"]`, one per program deployment) that will hold the bounded list of currently-open game IDs (capacity `MAX_ACTIVE_GAMES` = 128), created and paid for by the system admin wallet.

#### Scenario: First initialization creates the account
- **WHEN** the `Registry` PDA does not yet exist for this deployment and initialization is requested
- **THEN** the system creates it on-chain with an empty active-games list and returns an active-game count of 0

#### Scenario: Idempotent on repeat initialization
- **WHEN** initialization is requested and the `Registry` PDA already exists
- **THEN** the system does not send a duplicate on-chain transaction and instead returns the existing account's current active-game count

#### Scenario: Concurrent initialization race is handled
- **WHEN** two initialization requests race and the on-chain `init` constraint fails for the second one because the first already created the account
- **THEN** the system re-checks the account, finds it exists, and returns its active-game count as a successful outcome rather than surfacing an error

### Requirement: Active-game count reflects registry population, not yet game creation
The system SHALL report the `Registry` account's active-game count as the actual number of open games created via `create_game`. Game creation is the capability that adds entries to the list (closing/quitting a game will later prune it, per tickets 011/013 — still out of scope here).

#### Scenario: Count increases as games are created
- **WHEN** a user successfully creates a game via `create_game`
- **THEN** the `Registry`'s active-game count increases by one and its active-games list includes the new game's address

#### Scenario: No games exist yet
- **WHEN** the active-game count is read from a freshly initialized `Registry` account before any game has been created
- **THEN** the count is 0

### Requirement: Registry capacity enforcement
The system SHALL reject a `create_game` transaction with a clear `RegistryFull` error once the `Registry`'s active-games list is already at `MAX_ACTIVE_GAMES` (128) capacity, leaving the registry and all other state untouched — no partial insertion, no corrupted registry state.

#### Scenario: Registry at capacity rejects the next game creation
- **WHEN** the `Registry`'s active-games list already holds 128 entries and another game creation is attempted
- **THEN** the system rejects the entire transaction with a `RegistryFull` error, and the registry's active-games list is left unchanged
