## Purpose

Letting players in a General Mode game send tokens directly to one or several other players in a single submit, safely batched and chunked across Solana's per-transaction limits, with partial-failure outcomes always surfaced honestly.

## Requirements

### Requirement: Single-recipient on-chain transfer
The system SHALL allow moving tokens from one player's Associated Token Account (ATA) to another player's ATA for the same General Mode game's SPL mint, via a fixed-account `transfer_token` instruction with no dynamic/`Vec` recipient list.

#### Scenario: Successful transfer between two members
- **WHEN** a player who holds a sufficient balance submits a positive amount for another player who already holds an ATA for that game's mint
- **THEN** the system moves that amount from the sender's ATA to the recipient's ATA and both balances reflect the change

### Requirement: Sender is always the authenticated caller
The system SHALL treat the transfer's sender as the session's own signed-in user — there is no parameter or code path by which one player can initiate a transfer that spends from a different player's balance.

#### Scenario: Request always spends from the caller's own balance
- **WHEN** a signed-in player submits a transfer request
- **THEN** the system spends only from that player's own ATA, regardless of any other identifier that might be present in the request

### Requirement: Self-transfer rejected
The system SHALL reject a transfer where the sender and recipient are the same player, both independently on-chain and before any on-chain request is built.

#### Scenario: Self-transfer rejected before touching the chain
- **WHEN** a player attempts to add themselves as a recipient in the transfer form
- **THEN** the system rejects the request client-side before sending any on-chain transaction

#### Scenario: On-chain program rejects a self-transfer independently
- **WHEN** a `transfer_token` transaction is submitted with the same account as both sender and recipient, bypassing the off-chain check
- **THEN** the on-chain program rejects the transaction with a `SelfTransfer` error and no balance changes

### Requirement: Recipient must already be a member
The system SHALL reject a transfer targeting a user who does not already hold an ATA for the game's mint, rather than creating one — transferring never implicitly joins a player to the game.

#### Scenario: Transfer to a non-member rejected on-chain
- **WHEN** a `transfer_token` transaction is submitted naming a recipient who has not joined that game
- **THEN** the system rejects the transaction with a `PlayerNotInGame` error and no balance changes

#### Scenario: Recipient picker only offers current members
- **WHEN** a player opens the transfer form
- **THEN** every recipient row's picker lists only users who are already players in that game

### Requirement: Transfer amount must be positive
The system SHALL reject a per-recipient transfer amount that is not strictly greater than zero, both client-side before any transaction is built and independently on-chain.

#### Scenario: Zero or negative amount rejected before touching the chain
- **WHEN** a player submits a transfer form with a recipient row whose amount is zero or negative
- **THEN** the system rejects the request client-side before sending any on-chain transaction, with a message describing the constraint

#### Scenario: On-chain program rejects a non-positive amount independently
- **WHEN** a `transfer_token` transaction is submitted with a zero amount, bypassing the off-chain check
- **THEN** the on-chain program rejects the transaction with an `InvalidTransferAmount` error

### Requirement: Insufficient balance fails cleanly
The system SHALL never report a transfer batch as fully succeeded if any part of it did not apply, and SHALL reject a batch whose total requested amount exceeds the sender's balance before sending any transaction when that shortfall is detectable up front.

#### Scenario: Batch total exceeds current balance
- **WHEN** a player submits a batch of recipients whose amounts sum to more than their current balance
- **THEN** the system rejects the entire batch before sending any transaction, and no recipient's balance changes

#### Scenario: Balance changes between submission and execution
- **WHEN** a player's balance becomes insufficient partway through a multi-transaction batch (e.g. due to a concurrent transfer) after earlier transactions in the batch already confirmed
- **THEN** the system stops sending further transactions in that batch, and reports how many recipients were actually paid rather than showing the batch as fully succeeded or fully failed

### Requirement: Duplicate recipients rejected
The system SHALL reject a transfer batch containing the same recipient more than once, rather than merging their amounts.

#### Scenario: Duplicate recipient in one submission
- **WHEN** a player submits a transfer batch listing the same recipient in two different rows
- **THEN** the system rejects the request before sending any on-chain transaction, with a message identifying the duplicate

#### Scenario: Recipient picker excludes already-chosen rows
- **WHEN** a player has already selected a recipient in one row of the transfer form
- **THEN** that recipient no longer appears as a choice in any other row's picker

### Requirement: Multi-recipient batch composed and chunked automatically
The system SHALL accept a list of `{recipient, amount}` pairs in a single submit action, compose one `transfer_token` instruction per recipient, and automatically split them across multiple transactions whenever a batch would not fit within Solana's per-transaction size limit — verified against a realistic worst case of transferring to close to 19 recipients at once (the maximum for a 20-player game).

#### Scenario: Small batch fits in a single transaction
- **WHEN** a player submits a transfer batch with few enough recipients to fit one transaction
- **THEN** the system sends exactly one transaction containing one instruction per recipient

#### Scenario: Large batch is split across multiple transactions
- **WHEN** a player submits a transfer batch large enough that its instructions do not fit within one transaction's size limit
- **THEN** the system splits the batch into multiple transactions, sent sequentially, each containing as many recipients as fit

### Requirement: Partial batch failure is surfaced, not hidden
The system SHALL report, for any batch that does not fully succeed, how many recipients were actually paid out of how many were requested — never a bare success for a partially-applied batch, and never a bare failure that hides recipients who were already paid before a later transaction in the batch failed.

#### Scenario: Full success
- **WHEN** every transaction in a batch confirms successfully
- **THEN** the system reports the transfer as fully succeeded

#### Scenario: Partial success surfaced to the user
- **WHEN** some transactions in a multi-transaction batch confirm before a later one fails
- **THEN** the system reports the count of recipients actually paid against the total requested, and the user-facing message names both counts

### Requirement: Transfer form on the game detail page
The system SHALL let any player, from a General Mode game's detail page, select one or more existing members as recipients with independent amounts and submit them as a single batch, without leaving the page.

#### Scenario: Player sends to multiple recipients in one submit
- **WHEN** a player adds several recipient rows with independent amounts and submits the form
- **THEN** the system sends the whole batch as described above and, on success, the player's own balance view updates without a manual page reload
