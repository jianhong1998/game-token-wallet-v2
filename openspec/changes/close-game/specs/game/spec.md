## MODIFIED Requirements

### Requirement: Game player count
The system SHALL track a `player_count` on each `Game` account, initialized to 1 at creation (the creator counts as the first player — see Game creation), incremented by one each time a further player successfully joins, and decremented by one each time a player successfully quits or is closed out by the game's admin during game closure. This count does not itself constitute a membership list — player membership remains tracked implicitly via each player's per-game Associated Token Account (ATA) existence/balance.

#### Scenario: Count starts at one
- **WHEN** a game is created
- **THEN** its `player_count` is 1, reflecting the creator's own auto-created ATA

#### Scenario: Count increases as players join
- **WHEN** a player successfully joins a game
- **THEN** the game's `player_count` increases by one

#### Scenario: Count decreases as players quit
- **WHEN** a player successfully quits a game
- **THEN** the game's `player_count` decreases by one

#### Scenario: Count decreases as the admin closes players during game closure
- **WHEN** the game's admin successfully closes out a player (including the admin's own player slot) as part of closing the game
- **THEN** the game's `player_count` decreases by one, exactly as it does when a player quits
