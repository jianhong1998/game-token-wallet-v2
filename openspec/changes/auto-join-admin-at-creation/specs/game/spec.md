## MODIFIED Requirements

### Requirement: Game creation
The system SHALL allow a logged-in user to create a game with a name, defaulting to General Mode and public visibility, creating a per-game `Game` PDA (seeded `["game", game_id]`, where `game_id` is a client-generated UUID v7) and its own SPL mint (2 decimals, legacy SPL Token program, the `Game` PDA as mint authority, no freeze authority), signed and paid for by the system admin wallet. In the same instruction, the system SHALL also create the creator's own Associated Token Account (ATA) for that mint, so the creator is immediately a player with a zero balance — no separate join step is required.

#### Scenario: Successful creation
- **WHEN** a logged-in user submits a valid game name
- **THEN** the system creates the `Game` PDA and its mint on-chain, sets the creator as the game's admin, and appends the game's address to the `Registry`

#### Scenario: Creator is admin and a player from creation
- **WHEN** a game is created
- **THEN** the creator is recorded as the game's admin, and the system creates the creator's own ATA for the game's mint with a zero balance and sets `Game.player_count` to 1 — the creator appears in the game's player list immediately, with no separate `join_game` call
