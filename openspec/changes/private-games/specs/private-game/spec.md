## Purpose

Password-protected games that stay visible in the browse list. Joining requires the current password. Only the user whose `User` PDA is stored in `Game.admin` can set or replace that password, and doing so does not remove anyone already in the game.

## ADDED Requirements

### Requirement: Creating a private game
The system SHALL let a logged-in user create a private game by choosing private and supplying a password. The server SHALL hash that password with the same function used for user login (`hashPassword` in `apps/frontend/src/server/password.ts`: Node `crypto.scrypt`, N=16384, r=8, p=1, a new random 16-byte salt, a 64-byte hash) and SHALL send only the salt and the hash. Those bytes are written into that game's `Game` account as `password_salt: [u8; 16]` and `password_hash: [u8; 64]` (see the `game` capability's "Game password fields" requirement). The password SHALL satisfy the same rules as a login password (`validatePassword` in `apps/frontend/src/lib/password-rules.ts`: length 8–20, charset `/^[A-Za-z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/`). The creator becomes a player through `create_game`'s existing auto-join, not through `join_game`, and does not have to enter the password a second time.

#### Scenario: Private game stores the hash and the creator is a player
- **WHEN** a logged-in user creates a game as private with a password that passes `validatePassword`
- **THEN** the game is private, the `Game` account's `password_salt` (16 bytes) and `password_hash` (64 bytes) are the bytes `hashPassword` produced for that password, `player_count` is 1, the creator's ATA exists with a zero balance, and no `join_game` instruction was submitted

#### Scenario: Empty password rejected before the chain
- **WHEN** a logged-in user chooses private and submits the create form with an empty password
- **THEN** the system rejects it with "Password must be between 8 and 20 characters" and sends no transaction

#### Scenario: Password that breaks the login rules rejected before the chain
- **WHEN** a logged-in user chooses private and submits a password shorter than 8 characters, longer than 20 characters, or containing a character outside the login charset (including a space)
- **THEN** the system rejects it with the `validatePassword` reason and sends no transaction

#### Scenario: Plaintext password is not an instruction argument
- **WHEN** the server submits `create_game` for a private game
- **THEN** the instruction arguments are the visibility flag, a 16-byte salt, and a 64-byte hash, and do not include the plaintext password

### Requirement: Joining a private game with the correct password
The system SHALL let a logged-in user who is not yet a player join a private game that has fewer than 20 players when they submit the password that `verifyPassword` accepts for the game's stored salt and hash. The server SHALL use `verifyPassword` (which compares with `timingSafeEqual`) and SHALL NOT compare the hash itself. On success the system submits the existing `join_game` instruction.

#### Scenario: Correct password joins
- **WHEN** a logged-in non-member submits the current password for a private game with fewer than 20 players
- **THEN** the system creates their ATA with a zero balance and increments `player_count` by one

#### Scenario: A member opens the game without a password
- **WHEN** a logged-in user who is already a player views or opens that private game
- **THEN** the system does not ask for a password

#### Scenario: The admin is not exempt from join once they are not a member
- **WHEN** the user whose `User` PDA is `Game.admin` is not currently a player and submits a join
- **THEN** the system requires the current password, the same as for any other non-member

### Requirement: Wrong or missing password leaves the game unchanged
The system SHALL reject a join of a private game with room when the password is wrong, empty, or fails `validatePassword`, and SHALL send no transaction. A wrong password's message is "Incorrect password." An empty or illegal password uses the `validatePassword` reason. Neither message includes the salt or the hash. The game's existence is already public because the game is listed; an address that is not a live `Game` account is "Game not found" and is not reported as a wrong password. The server SHALL NOT run a dummy hash on that not-found path.

#### Scenario: Wrong password rejected before sending
- **WHEN** a logged-in non-member submits a password that `verifyPassword` rejects for a private game with fewer than 20 players
- **THEN** the system responds with "Incorrect password.", sends no transaction, and leaves `player_count`, membership, and the stored salt and hash unchanged

#### Scenario: Empty password rejected before sending
- **WHEN** a logged-in non-member submits an empty password for a private game with fewer than 20 players
- **THEN** the system responds with "Password must be between 8 and 20 characters", does not call `verifyPassword`, and sends no transaction

#### Scenario: Password that breaks the login rules rejected before sending
- **WHEN** a logged-in non-member submits a password that fails `validatePassword` for a private game with fewer than 20 players
- **THEN** the system responds with the `validatePassword` reason, does not call `verifyPassword`, and sends no transaction

#### Scenario: Unknown game rejected before a password check
- **WHEN** a signed-in user submits a join for an address that is not a live `Game` account, with or without a password
- **THEN** the system responds with "Game not found", does not call `verifyPassword`, and sends no transaction

### Requirement: Player cap and duplicate join still apply to private games
The system SHALL keep the existing join pre-checks and the existing on-chain `GameFull` and `AlreadyJoinedGame` errors. Those checks run before the password check. A private game at 20 players rejects the next join with the existing full-game message whether or not the password would have been correct. A user who is already a player receives the existing already-joined message and the password is not checked.

#### Scenario: Private game at 20 players rejects the next join
- **WHEN** a private game already has 20 players and another user attempts to join, with the current password or with any other string
- **THEN** the system rejects the attempt with "This game already has the maximum of 20 players", does not call `verifyPassword`, and `player_count` remains 20

#### Scenario: Already a player is rejected without a password check
- **WHEN** a user who already has an ATA for a private game submits a join, with or without the current password
- **THEN** the system rejects it with "You are already a player in this game", does not call `verifyPassword`, and `player_count` is unchanged

### Requirement: Only the current admin can change the password
The system SHALL let the user whose session username resolves to the `User` PDA stored in `Game.admin` replace a private game's password. The deployment's system wallet signs and pays for every transaction, so admin identity is that username check — the same one deposits use — and not which keypair signed. The action SHALL take the game address and the new password only; it SHALL NOT accept a caller username. The server SHALL hash the new password with `hashPassword` (a new salt, not the salt already on the account) and submit `set_game_password`. The handler order is `NotGameAdmin`, then `GameIsNotPrivate`, then `InvalidGamePassword`, then the write. A non-admin who names a public game still receives `NotGameAdmin`.

#### Scenario: Admin replaces the salt and hash
- **WHEN** the current admin submits a new password that passes `validatePassword` for a private game
- **THEN** `password_salt` and `password_hash` become the new `hashPassword` output, `is_private` stays true, and `Game.admin` stays that admin's `User` PDA

#### Scenario: Non-admin rejected on-chain
- **WHEN** `set_game_password` is submitted for a private game whose caller `User` PDA is not `Game.admin`
- **THEN** the program rejects it with `NotGameAdmin` and leaves the salt, the hash, `is_private`, `player_count`, and `Game.admin` unchanged

#### Scenario: Non-admin rejected before sending
- **WHEN** a signed-in user who is not the current admin submits a password change
- **THEN** the system responds with "Only the game's admin can change the password" and sends no transaction

#### Scenario: Signed-out request rejected before the chain
- **WHEN** a password change is submitted with no signed-in session
- **THEN** the system rejects it with "Not signed in" and sends no transaction

#### Scenario: Caller identity comes from the session
- **WHEN** a signed-in admin submits a password change
- **THEN** the system uses that session's username as the `set_game_password` caller and provides no field by which the request can name a different caller

#### Scenario: Unknown or closed game rejected before sending
- **WHEN** a signed-in user submits a password change for an address that is not a live `Game` account
- **THEN** the system responds with "Game not found" and sends no transaction

#### Scenario: On-chain change against a missing game writes nothing
- **WHEN** `set_game_password` names a game account that does not exist
- **THEN** the transaction fails and no account is created or modified

#### Scenario: Empty or illegal new password rejected before the chain
- **WHEN** the current admin submits a new password that fails `validatePassword`
- **THEN** the system responds with the `validatePassword` reason, does not call `hashPassword`, and sends no transaction

#### Scenario: All-zero replacement rejected on-chain
- **WHEN** the current admin submits `set_game_password` for a private game with an all-zero salt or an all-zero hash
- **THEN** the program rejects it with `InvalidGamePassword` and leaves the stored salt and hash unchanged

### Requirement: Changing the password only gates new joins
The system SHALL treat a password change as a write of the salt and the hash and nothing else. Players already in the game stay in the game, with their balances and the `player_count` unchanged, and they are not asked to confirm or to re-enter a password. The previous password stops matching. The new password matches. There is no second confirmation step. The admin does not have to supply the previous password. The account is not resized.

#### Scenario: Existing members stay in the game
- **WHEN** the current admin changes the password after another player has joined
- **THEN** that player's ATA still exists, their balance is unchanged, `player_count` is unchanged, and they can still open the game without entering a password

#### Scenario: Old password stops working
- **WHEN** a logged-in non-member submits the previous password after a successful change, and the game has fewer than 20 players
- **THEN** the system responds with "Incorrect password.", sends no transaction, and `player_count` is unchanged

#### Scenario: New password works
- **WHEN** a logged-in non-member submits the password that was just set, and the game has fewer than 20 players
- **THEN** the system joins them and increments `player_count` by one

#### Scenario: No second confirmation and no member prompt
- **WHEN** the current admin submits one valid new password
- **THEN** the system stores the new hash without a second confirmation step, without asking for the previous password, and without prompting players who are already in the game

#### Scenario: Account size does not change
- **WHEN** a password change succeeds
- **THEN** the `Game` account address and data length are the same as before the change

### Requirement: Visibility is fixed at creation
The system SHALL NOT offer a way to turn a public game private, or a private game public, after creation. `set_game_password` requires `is_private` already true and does not write `is_private`. Creating a public game while a password string is also present SHALL ignore that string, store zeros, and not call `hashPassword`.

#### Scenario: Public game rejects a later password on the server
- **WHEN** the current admin submits a password change for a public game
- **THEN** the system responds with "Only a private game has a password" and sends no transaction

#### Scenario: On-chain set against a public game leaves it public
- **WHEN** the current admin submits `set_game_password` for a public game
- **THEN** the program rejects it with `GameIsNotPrivate` and leaves `is_private` false and both arrays all zeros

#### Scenario: A stray password does not make a public game private
- **WHEN** a logged-in user creates a game without choosing private and a password string is also supplied
- **THEN** the game is public, both arrays are all zeros, and `hashPassword` is not called

#### Scenario: Switching back to public on the create form drops the password
- **WHEN** a logged-in user selects private, types a password, then selects public, and submits a valid name
- **THEN** the system creates a public game and does not require a password

### Requirement: Join instruction does not check the password
The system SHALL keep password verification in the Next.js server. `join_game` SHALL NOT take a password and SHALL NOT read `is_private`, `password_salt`, or `password_hash`. The system wallet is the only signer, so a password the server rejects never becomes a transaction. A direct `join_game` is not a bypass a player can perform on their own.

#### Scenario: Direct join instruction does not consult the password
- **WHEN** `join_game` is submitted for a private game that has room, for a user who is not yet a player, with no password argument
- **THEN** the instruction succeeds, the user's ATA is created with a zero balance, and `player_count` increases by one

#### Scenario: The server refuses to sign a bad password
- **WHEN** a signed-in non-member joins a private game that has room and the password does not verify
- **THEN** `getJoinGameInstructionAsync` is not called and no transaction is sent

### Requirement: Private games stay visible and are marked
The system SHALL keep private games in the browse list of every active game, with the same name, mode, and player count a public game shows, plus a visibility label. The home list of the viewer's games and the game detail header SHALL show the same label: "Private" or "Public". Client-facing list and detail data include whether the game is private and SHALL NOT include the salt or the hash, and the page SHALL NOT render either.

#### Scenario: Browse list shows a private game and marks it
- **WHEN** a logged-in user views the browse-games page and a private game is in the `Registry`
- **THEN** that game's row is present and shows "Private", its name, its mode, and its player count

#### Scenario: Home list marks the viewer's private game
- **WHEN** a logged-in member views their home games list and one of those games is private
- **THEN** that row shows "Private"

#### Scenario: Public games are marked public
- **WHEN** a logged-in user views the browse list or their home list and a game is public
- **THEN** that row shows "Public"

#### Scenario: Detail page shows visibility
- **WHEN** a logged-in user opens a game's detail page
- **THEN** the page shows "Private" or "Public" matching `is_private`

#### Scenario: The hash is not rendered
- **WHEN** a logged-in user views the browse list, the home list, or a game detail page
- **THEN** the page does not show the password salt or the password hash

### Requirement: Password prompt on join
The system SHALL, on the browse list, join a public game in one click and ask for a password before joining a private game. The private row's button reads "Enter password". Choosing it opens a prompt and does not submit a join. The prompt's submit sends the password to `joinGame`. Cancel closes the prompt and sends nothing. A member's button stays "Open" and does not show the prompt, including after the password changes. A wrong password shows "Incorrect password." on that row and does not navigate away.

#### Scenario: Private row asks before joining
- **WHEN** a logged-in non-member activates "Enter password" on a private game's row
- **THEN** a password prompt is shown and no join is submitted

#### Scenario: Correct password from the prompt joins
- **WHEN** the user submits the current password in that prompt
- **THEN** the system joins the game and navigates to that game's detail page

#### Scenario: Wrong password stays on the browse page
- **WHEN** the user submits a wrong password in that prompt
- **THEN** the row shows "Incorrect password.", the user stays on the browse page, and they are not a member

#### Scenario: Cancel leaves the game unchanged
- **WHEN** the user opens the prompt and cancels
- **THEN** no join is submitted and the row still offers "Enter password"

#### Scenario: Empty prompt does not submit
- **WHEN** the user submits the prompt with an empty password
- **THEN** the prompt shows "Password must be between 8 and 20 characters" and no join is submitted

#### Scenario: Public row joins in one click
- **WHEN** a logged-in non-member activates "Join" on a public game's row
- **THEN** the system joins without showing a password prompt

### Requirement: Admin changes the password from the game page
The system SHALL show a "Change password" form only to the current admin, and only when the game is private, inside the existing Admin controls modal on that game's detail page. One submit stores the new password. Success closes the modal and refreshes the page in place. Failure leaves the modal open. There is no second confirmation dialog and no toast. A public game's admin still sees Admin controls and does not see this form. A non-admin does not see Admin controls.

#### Scenario: Admin of a private game sees the form
- **WHEN** the current admin opens Admin controls on a private game
- **THEN** a "Change password" field and submit control are shown

#### Scenario: Admin of a public game does not see the form
- **WHEN** the current admin opens Admin controls on a public game
- **THEN** the deposit form is shown and no "Change password" control is shown

#### Scenario: A non-admin does not see the form
- **WHEN** a player who is not the current admin views the game detail page
- **THEN** the page shows neither Admin controls nor a change-password control

#### Scenario: Empty new password does not submit
- **WHEN** the current admin submits the change-password form with an empty password
- **THEN** the form shows "Password must be between 8 and 20 characters" and does not call the action

#### Scenario: Success refreshes in place
- **WHEN** the current admin successfully changes the password
- **THEN** the system stays on that game's detail page, closes the modal, and refreshes the page

#### Scenario: A rejected change leaves the modal open
- **WHEN** the change action returns an error
- **THEN** the modal stays open and shows that error
