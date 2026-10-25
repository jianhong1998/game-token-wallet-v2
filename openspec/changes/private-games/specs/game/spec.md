## MODIFIED Requirements

### Requirement: Game creation
The system SHALL allow a logged-in user to create a game with a name, defaulting to General Mode. Visibility is chosen at creation and defaults to public when the creator does not choose private. A public game stores no password. A private game stores a password salt and hash. Either choice creates a per-game `Game` PDA (seeded `["game", game_id]`, where `game_id` is a client-generated UUID v7) and its own SPL mint (2 decimals, legacy SPL Token program, the `Game` PDA as mint authority, no freeze authority), signed and paid for by the system admin wallet. In the same instruction, the system SHALL also create the creator's own Associated Token Account (ATA) for that mint, so the creator is immediately a player with a zero balance — no separate join step, and no password check, including when the game is private.

#### Scenario: Successful creation
- **WHEN** a logged-in user submits a valid game name and does not choose private
- **THEN** the system creates the `Game` PDA and its mint on-chain, sets the creator as the game's admin, records the game as public with an all-zero password salt and hash, and appends the game's address to the `Registry`

#### Scenario: Creator is admin and a player from creation
- **WHEN** a game is created, whether public or private
- **THEN** the creator is recorded as the game's admin, and the system creates the creator's own ATA for the game's mint with a zero balance and sets `Game.player_count` to 1 — the creator appears in the game's player list immediately, with no separate `join_game` call and without the password being checked

## ADDED Requirements

### Requirement: Game password fields
The system SHALL store a game's privacy in three fields appended after `player_count`, so every field that already exists keeps its offset: `is_private: bool`, `password_salt: [u8; 16]`, and `password_hash: [u8; 64]`. The salt and hash widths match `User`'s `SALT_BYTES` and `PASSWORD_HASH_BYTES`. `Game::INIT_SPACE` is 201 (120 today, plus 81). A public game has `is_private` false and both arrays all zeros. A private game has `is_private` true and both arrays non-zero. The plaintext password is not a field. This change does not realloc a `Game` account that was created at the previous size.

#### Scenario: New games allocate the larger account
- **WHEN** a game is created
- **THEN** the `Game` account data is `8 + Game::INIT_SPACE` bytes (209) and the three new fields can be read back

#### Scenario: Public game stores no password
- **WHEN** a public game is created
- **THEN** `is_private` is false, `password_salt` is 16 zero bytes, and `password_hash` is 64 zero bytes

#### Scenario: Private game stores a salt and a hash
- **WHEN** a private game is created with a salt and hash that are each non-zero
- **THEN** `is_private` is true and the account stores those exact salt and hash bytes

#### Scenario: Public create that carries a hash writes nothing
- **WHEN** `create_game` is submitted with `is_private` false and a salt or hash that is not all zeros
- **THEN** the program rejects it with `InvalidGamePassword` and no `Game` account exists afterward

#### Scenario: Private create without a hash writes nothing
- **WHEN** `create_game` is submitted with `is_private` true and a salt or hash that is all zeros
- **THEN** the program rejects it with `InvalidGamePassword` and no `Game` account exists afterward
