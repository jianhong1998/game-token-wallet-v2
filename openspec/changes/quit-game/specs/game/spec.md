## MODIFIED Requirements

### Requirement: Game player count
The system SHALL track a `player_count` on each `Game` account, initialized to 1 at creation (the creator counts as the first player — see Game creation), incremented by one each time a further player successfully joins, and decremented by one each time a player successfully quits. This count does not itself constitute a membership list — player membership remains tracked implicitly via each player's per-game Associated Token Account (ATA) existence/balance.

#### Scenario: Count starts at one
- **WHEN** a game is created
- **THEN** its `player_count` is 1, reflecting the creator's own auto-created ATA

#### Scenario: Count increases as players join
- **WHEN** a player successfully joins a game
- **THEN** the game's `player_count` increases by one

#### Scenario: Count decreases as players quit
- **WHEN** a player successfully quits a game
- **THEN** the game's `player_count` decreases by one
