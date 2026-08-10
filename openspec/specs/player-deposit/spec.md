## Purpose

Letting a game's admin mint tokens directly into an existing player's balance to represent an offline cash deposit, with admin identity enforced on-chain and the deposit reflected in balances without a manual reload.

## Requirements

### Requirement: Admin-only mint to a player's balance
The system SHALL allow a game's admin to mint an arbitrary, admin-specified positive amount directly into an existing player's Associated Token Account (ATA) for that game's SPL mint, to represent an offline cash deposit. There is no on-chain or off-chain conversion rate — the amount is entirely admin-discretionary.

#### Scenario: Successful deposit
- **WHEN** a game's admin submits a positive amount for a player who already holds an ATA for that game's mint
- **THEN** the system mints that amount into the player's ATA and the player's balance increases by exactly that amount

### Requirement: Admin identity enforced on-chain
The system SHALL restrict `mint_to_player` to the caller whose `User` PDA matches the game's recorded `admin`, verified independently on-chain (not only hidden in the UI) — since every transaction is signed by the same custodial system admin wallet regardless of which end user is acting, admin identity cannot be inferred from the transaction signer alone.

#### Scenario: Non-admin caller rejected
- **WHEN** a user who is not the game's admin attempts to call `mint_to_player` for that game
- **THEN** the system rejects the transaction with a `NotGameAdmin` error and no balance changes

### Requirement: Target must already be a player
The system SHALL reject a deposit targeting a user who does not already hold an ATA for the game's mint, rather than creating one — depositing never implicitly joins a player to the game.

#### Scenario: Deposit to a non-member rejected
- **WHEN** a game's admin attempts to deposit to a user who has not joined that game
- **THEN** the system rejects the transaction with a `PlayerNotInGame` error and no ATA is created

### Requirement: Deposit amount must be positive
The system SHALL reject a deposit amount that is not strictly greater than zero, both client-side before any transaction is built and independently on-chain.

#### Scenario: Zero or negative amount rejected before touching the chain
- **WHEN** an admin submits a deposit amount that is zero or negative on the deposit form
- **THEN** the system rejects the request client-side before sending any on-chain transaction, with a message describing the constraint

#### Scenario: On-chain program rejects a non-positive amount independently
- **WHEN** a `mint_to_player` transaction is submitted with a zero amount, bypassing the off-chain check
- **THEN** the on-chain program rejects the transaction

### Requirement: Admin-facing deposit form
The system SHALL let a game's admin, from that game's detail page, pick a player currently in the game and enter an amount, then submit a deposit — after which the admin's own view of that player's balance reflects the deposit without a manual page reload.

#### Scenario: Admin deposits via the form
- **WHEN** a game's admin picks a current player from the game's roster, enters a positive amount, and submits the deposit form
- **THEN** the system mints the amount to that player and the admin's view updates to show the player's new balance

#### Scenario: Player picker only offers current members
- **WHEN** a game's admin opens the deposit form
- **THEN** the list of selectable players contains only users who are already players in that game

### Requirement: Player balance reflects deposits on load
The system SHALL show a player their current game-token balance whenever they view a game they belong to, including any deposits credited since their last view.

#### Scenario: Balance is current on next view
- **WHEN** a player who received a deposit views the game's detail page after the deposit was made
- **THEN** the displayed balance includes that deposit
