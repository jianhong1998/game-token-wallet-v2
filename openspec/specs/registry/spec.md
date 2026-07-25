## Purpose

Singleton on-chain discovery index for the deployment, avoiding `getProgramAccounts` scans for "browse games" (see project context — architecture Q4). Currently covers initialization only; population by game creation is future work.

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
The system SHALL report the `Registry` account's active-game count as-is; population of that list (adding game IDs on creation, pruning on close/delete) is out of scope of this capability and not yet implemented, so the count is always 0 until a game-creation capability exists.

#### Scenario: No games exist yet
- **WHEN** the active-game count is read from a freshly initialized or existing `Registry` account today
- **THEN** the count is 0, since no capability currently adds entries to the list
