## MODIFIED Requirements

### Requirement: Game admin identity
The system SHALL identify a game's admin by a registered user's `User` PDA address stored in `Game.admin`, not by a wallet keypair — there is no per-user wallet in this deployment's custodial model. At creation that address is the creator's. Transferring the admin role overwrites that same field in place and does not resize the account.

#### Scenario: Admin field references a real registered user
- **WHEN** a game is created
- **THEN** the on-chain program verifies the creator's `User` account exists and records its address as `Game.admin`, rejecting the transaction if no such `User` account exists

#### Scenario: Admin field stays a User PDA after transfer
- **WHEN** the admin role is transferred to another player in the game
- **THEN** `Game.admin` is that player's `User` PDA, still not a wallet keypair, and the `Game` account is not resized
