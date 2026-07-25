## ADDED Requirements

### Requirement: Username/password registration
The system SHALL allow a new user to register with a username and password, creating a per-username on-chain `User` account (PDA seeded `["user", username, system_admin_pubkey]`) signed and paid for by the system admin wallet.

#### Scenario: Successful registration
- **WHEN** a visitor submits a username between 3 and 32 UTF-8 bytes (letters, numbers, and spaces only, case-insensitive/NFC-normalized) and a password between 8 and 20 characters (matching the allowed character set) with a matching confirmation
- **THEN** the system creates the `User` PDA on-chain and starts a signed-in session for that username

#### Scenario: Duplicate username rejected
- **WHEN** a visitor registers a username for which a `User` PDA already exists
- **THEN** the on-chain `init` constraint fails, the system re-checks the account and returns "Username already taken" without creating a session

#### Scenario: Invalid username rejected
- **WHEN** a visitor submits a username shorter than 3 bytes, longer than 32 bytes, or containing characters outside letters/numbers/spaces
- **THEN** the system rejects the registration before sending any on-chain transaction, with a message describing the constraint

#### Scenario: Invalid or mismatched password rejected
- **WHEN** a visitor submits a password shorter than 8 characters, longer than 20 characters, containing a disallowed character, or whose confirmation does not match
- **THEN** the system rejects the registration before sending any on-chain transaction

### Requirement: Password storage
The system SHALL never store or transmit a user's plaintext password. Each password SHALL be hashed with scrypt using a random 16-byte salt, producing a 64-byte hash, both stored as fields on the user's on-chain `User` account.

#### Scenario: Registration stores only a salt and hash
- **WHEN** registration succeeds
- **THEN** the `User` account holds a 16-byte salt and 64-byte scrypt hash, and the plaintext password is not persisted anywhere

### Requirement: Username/password login
The system SHALL allow a registered user to log in with their username and password, verifying the password against the on-chain stored hash and starting a session on success.

#### Scenario: Successful login
- **WHEN** a user submits the username and password matching an existing `User` account
- **THEN** the system verifies the scrypt hash with a timing-safe comparison and starts a signed-in session for that username

#### Scenario: Unknown username or wrong password rejected identically
- **WHEN** a user submits a username that has no `User` account, or an existing username with the wrong password
- **THEN** the system returns the same "Invalid username or password" error in both cases, and in the unknown-username case still runs a dummy scrypt computation of equivalent cost so response timing does not reveal whether the username exists

### Requirement: Session issuance and validation
On successful registration or login, the system SHALL issue an HMAC-SHA256-signed session cookie containing the username and a 7-day expiry, and SHALL treat a request as authenticated only if the cookie's signature is valid and unexpired.

#### Scenario: Valid session identifies the current user
- **WHEN** a request carries a session cookie with a valid HMAC signature and an expiry in the future
- **THEN** the system resolves the current username from the cookie payload

#### Scenario: Tampered or expired session is rejected
- **WHEN** a request carries a session cookie whose signature does not verify, or whose expiry has passed
- **THEN** the system treats the request as unauthenticated (no current username)

### Requirement: Logout
The system SHALL allow a signed-in user to log out, clearing their session cookie.

#### Scenario: Logout clears the session
- **WHEN** a signed-in user logs out
- **THEN** the system deletes the session cookie and subsequent requests are unauthenticated
