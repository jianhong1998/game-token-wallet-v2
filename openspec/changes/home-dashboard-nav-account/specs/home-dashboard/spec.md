## ADDED Requirements

### Requirement: Home lists every game the user belongs to
The system SHALL render, at `/`, a row for every `Game` where the current user is a player or the admin, showing the game's name, mode, and the user's own token balance in that game's mint. Rows for a game where `Game.admin` matches the current user SHALL additionally show an "Admin" badge. No cross-game aggregate balance SHALL be shown.

#### Scenario: User with games sees a row per membership
- **WHEN** a signed-in user who is a player or admin in one or more games requests `/`
- **THEN** the system renders one row per game showing that game's name, mode, and the user's balance in that game's mint, with an "Admin" badge on rows where the user is the admin

#### Scenario: No aggregate balance shown
- **WHEN** a signed-in user belongs to two or more games
- **THEN** the system does not display any summed or total balance figure across those games

### Requirement: Home empty state
The system SHALL show an empty-state message plus a way to Create or Browse when the current user belongs to no games.

#### Scenario: New user with no games
- **WHEN** a signed-in user who belongs to no games requests `/`
- **THEN** the system shows an empty-state message and actions to create a game or browse public games

### Requirement: Home rows are non-interactive
The system SHALL NOT provide navigation from a Home game row to a per-game detail page.

#### Scenario: Game row has no click-through
- **WHEN** a signed-in user views a game row on Home
- **THEN** the row displays name, mode, balance, and admin badge where applicable, but has no link or click handler to a detail page

### Requirement: Persistent bottom navigation
The system SHALL render a bottom navigation bar with Home, Browse, and You tabs on every page within the `(app)` route group, unconditionally.

#### Scenario: Nav present on every app page
- **WHEN** a signed-in user is on any `(app)` route
- **THEN** the bottom nav bar with Home, Browse, and You tabs is visible

### Requirement: Account ("You") screen
The system SHALL provide an Account page showing the current user's avatar/initials, username, and count of games they belong to, plus a logout action. The Account screen SHALL NOT include account-deletion controls.

#### Scenario: Account screen shows identity and game count
- **WHEN** a signed-in user visits the You tab
- **THEN** the system shows their avatar/initials, username, the count of games they belong to, and a logout button

#### Scenario: No delete-account UI present
- **WHEN** a signed-in user visits the You tab
- **THEN** no delete-account or danger-zone control is shown
