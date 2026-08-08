## ADDED Requirements

### Requirement: Game player count
The system SHALL track a `player_count` on each `Game` account, initialized to 0 at creation and incremented by one each time a player successfully joins. This count does not itself constitute a membership list — player membership remains tracked implicitly via each player's per-game Associated Token Account (ATA) existence/balance.

#### Scenario: Count starts at zero
- **WHEN** a game is created
- **THEN** its `player_count` is 0

#### Scenario: Count increases as players join
- **WHEN** a player successfully joins a game
- **THEN** the game's `player_count` increases by one
