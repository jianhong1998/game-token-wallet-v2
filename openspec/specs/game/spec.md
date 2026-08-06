## Purpose

Per-game on-chain state: a `Game` PDA and its own SPL mint, created by a logged-in user who becomes its admin. Currently covers General Mode, public-visibility creation only — joining as a player, private games, deposits, transfers, and other modes are future work.

## Requirements

### Requirement: Game creation
The system SHALL allow a logged-in user to create a game with a name, defaulting to General Mode and public visibility, creating a per-game `Game` PDA (seeded `["game", game_id]`, where `game_id` is a client-generated UUID v7) and its own SPL mint (2 decimals, legacy SPL Token program, the `Game` PDA as mint authority, no freeze authority), signed and paid for by the system admin wallet.

#### Scenario: Successful creation
- **WHEN** a logged-in user submits a valid game name
- **THEN** the system creates the `Game` PDA and its mint on-chain, sets the creator as the game's admin, and appends the game's address to the `Registry`

#### Scenario: Creator is admin, not automatically a player
- **WHEN** a game is created
- **THEN** the creator is recorded as the game's admin, but is not added to any player list — joining as a player is a separate capability

### Requirement: Game admin identity
The system SHALL identify a game's admin by the creator's `User` PDA address, not by a wallet keypair — there is no per-user wallet in this deployment's custodial model.

#### Scenario: Admin field references a real registered user
- **WHEN** a game is created
- **THEN** the on-chain program verifies the creator's `User` account exists and records its address as `Game.admin`, rejecting the transaction if no such `User` account exists

### Requirement: Game name validation
The system SHALL require a game name between 3 and 32 UTF-8 bytes, containing only Unicode letters, numbers, and spaces, NFC-normalized (no case-folding), enforced identically in the frontend form, the Next.js Server Action, and the on-chain program.

#### Scenario: Valid name accepted
- **WHEN** a user submits a name between 3 and 32 UTF-8 bytes using only letters, numbers, and spaces
- **THEN** the system accepts it and creates the game

#### Scenario: Invalid length rejected before touching the chain
- **WHEN** a user submits a name shorter than 3 bytes or longer than 32 bytes
- **THEN** the system rejects the request client-side and server-side before sending any on-chain transaction, with a message describing the constraint

#### Scenario: Invalid characters rejected before touching the chain
- **WHEN** a user submits a name containing a character other than a Unicode letter, number, or space
- **THEN** the system rejects the request client-side and server-side before sending any on-chain transaction

#### Scenario: On-chain program rejects invalid names independently
- **WHEN** an on-chain `create_game` transaction is submitted with a name outside the length or character constraints, bypassing the off-chain checks
- **THEN** the on-chain program rejects the transaction with a distinct error for a length violation versus a character-set violation

### Requirement: Game mode defaults to General
The system SHALL create every game with `mode` set to General; no other mode is selectable or functional yet, and the creation form does not expose a mode selector.

#### Scenario: Game is created in General Mode
- **WHEN** a user creates a game
- **THEN** the game's mode is General

### Requirement: Creator sees their own games
The system SHALL let a logged-in user view a list of the games they administer, showing each game's name.

#### Scenario: Newly created game appears in the creator's list
- **WHEN** a user creates a game and then views their own games list
- **THEN** the newly created game appears in that list, identified as one they administer

#### Scenario: Empty state before any game is created
- **WHEN** a logged-in user with no created games views their own games list
- **THEN** the system shows an empty state rather than an empty or missing list
