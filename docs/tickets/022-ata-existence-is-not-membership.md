# 022 — ATA existence is not game membership

**What to build:** A membership record that only `join_game` and `create_game` can create, and that every "is this user a player" check reads. An associated token account (ATA) created any other way is a token account, not a seat in the game. Which record to use is deliberately open — see Candidate approaches. This ticket is the problem statement for that spec.

**Blocked by:** 006

**Status:** Pending — ready for a spec

Related, not blockers: 007 ([#39](https://github.com/jianhong1998/game-token-wallet-v2/pull/39)) and 010 ([#38](https://github.com/jianhong1998/game-token-wallet-v2/pull/38) spec on main, implementation [#40](https://github.com/jianhong1998/game-token-wallet-v2/pull/40)). 006 is done, so the next step is a spec, not more join-game work.

## Problem

On-chain code treats "this user's ATA for the game mint exists and has data" as "this user joined." The Associated Token program creates that account for any owner. The rent payer signs; the owner does not. This program never records that `join_game` or `create_game` was the creator, so a wallet other than the deployment's system wallet can create the ATA.

Checked on main (through the 010 spec, #38) and against the `transfer_game_admin` handler in #40:

| Instruction | Where | What it uses as "player" |
| --- | --- | --- |
| `join_game` | `instructions/game/join_game.rs` | Creates the canonical ATA and then increments `player_count`. Refuses a non-empty ATA with `AlreadyJoinedGame`. The 20-player cap (`ensure_game_has_capacity`, `MAX_PLAYERS_PER_GAME`) runs only here. |
| `create_game` | `instructions/game/create_game.rs` | Creates the creator's ATA in the same instruction and sets `player_count = 1` (ticket 021). The mint PDA is born in that instruction, so the creator's ATA cannot already exist. |
| `mint_to_player` | `instructions/game/mint_to_player.rs` | Canonical ATA address, then `!player_ata.data_is_empty()` or `PlayerNotInGame`. Does not read `player_count`. |
| `transfer_token` | `instructions/general_mode/transfer_token.rs` | Recipient: same initialized-ATA check, `PlayerNotInGame`. Sender: address check only; a missing or empty source fails inside the token-program transfer. Neither side reads `player_count`. |
| `quit_game` | `instructions/game/quit_game.rs` | Same initialized-ATA check, then `player_count -= 1`. The comment that a non-empty ATA proves the player was counted is wrong once the ATA can be created outside `join_game`. |
| `close_game_player` | `instructions/game/close_game_player.rs` | Same initialized-ATA check, then `player_count -= 1`. |
| `close_game` | `instructions/game/close_game.rs` | `player_count == 0` (`GameNotEmpty`). It does not look at any token account. |
| `transfer_game_admin` | not on main | Spec (`openspec/changes/game-admin-transfer`, design D2) defines the target as an initialized ATA and rejects a member list on `Game` because "the ATA is the membership record (architecture Q15)." The #40 handler matches that: `InvalidPlayerAta`, then `!data_is_empty()` as `PlayerNotInGame`, then `game.admin = player_user`. No `player_count` write. |

No other instruction on main decides membership. `delete_user` (012) is not implemented; its ticket already says membership is the user's open game ATAs. Poker and pool instructions (014–016) are not in the program.

`Game` today is the fields in `state/game.rs`: `INIT_SPACE` 120, account data 128 (8-byte discriminator + 120). `player_count` is one byte. There is no member list.

The server uses a wider definition than the program. `fetchGameMembers` in `apps/frontend/src/server/actions/game.ts` loads every 165-byte token account whose mint is the game mint (`getProgramAccounts`), then `fetchAllUser` on each owner. `listBrowseGames` / `listMyMemberGames` set "I am a member" from "my ATA account is non-null." Deposit and transfer derive the canonical ATA for a username taken from that roster. `closeGame` submits `close_game_player` for every account the scan returned.

## Why it matters

A user who never called `join_game` can hold an initialized ATA for the mint. `mint_to_player` will mint to them. Once #40 merges, `transfer_game_admin` will accept them as the new admin. `transfer_token` will accept them as a recipient. `quit_game` and `close_game_player` will treat them as a seat and decrement `player_count`.

`player_count` and the cap then describe `join_game` / `create_game` successes, not the set of accounts the rest of the program treats as players.

- The cap still rejects the 21st `join_game`. It does not limit ATAs created outside that instruction. `join_game` also cannot repair the gap: a pre-created ATA hits `AlreadyJoinedGame` and is never added to `player_count`.
- `quit_game` and `close_game_player` subtract one for an ATA that was never added. `[profile.release] overflow-checks = true` in `apps/on-chain-program/Cargo.toml`, so a decrement at 0 aborts that transaction. Decrements that already landed in earlier transactions stay. The counter can sit at 0 while people who actually joined still hold ATAs.
- `close_game` then succeeds on-chain: its only emptiness check is `player_count == 0`, and the ATAs stay (the mint is already left behind on purpose; see ticket 013). The server action `closeGame` does not do that by itself. It sends `close_game_player` for every scanned token account first, and it only sends `close_game` after those succeed. A decrement at 0 is an unmapped error, so the Close button stops with the `Game` account still open and the counter already at 0. The instruction `close_game`, given that counter, still closes the game and leaves the remaining ATAs in place.

The system wallet signs every instruction of this program, and the server is what builds those transactions. That still holds, and it is why a third party cannot submit `mint_to_player`, `transfer_token`, `quit_game`, `close_game_player`, or `transfer_game_admin` on their own. It does not cover creating the ATA. That create is a Token-program transaction.

The current app already follows the ATA:

- Browse sets `isMember` from the viewer's ATA, and the row's button is "Open" in that case (`BrowseGameRow` pushes `/games/{address}`). `joinGame` refuses with "You are already a player in this game" when the ATA exists. The home list includes the same game, because `listMyMemberGames` treats a non-null ATA as a player, and that row links to the game page.
- The game page builds its roster, deposit picker, and transfer picker from the token-account scan. An admin session mints to a scanned user whose account is the canonical ATA: the server derives that address, and `mint_to_player` accepts it.
- `QuitGameButton` renders for every signed-in non-admin on that page. `quitGame` signs `quit_game` for the session username. A registered user whose own ATA was created outside `join_game` reaches that page from browse or home and decrements `player_count` from it.
- The scan is every token account for the mint, not only canonical ATAs. `fetchAllUser` calls `assertAccountsExist`. An owner that is not a `User` account makes `fetchGameDetail` and `closeGame` throw, so the game page and the close action fail for everyone. `closeGame` also passes the scanned address into `close_game_player`; an address that is not the canonical ATA comes back as `InvalidPlayerAta`, which that action does not map to a friendly error.

Architecture Q15 (`docs/technical-related/architecture/002-architecture-decisions.md`) chose the ATA as the membership record so the program would not keep a second list that could drift, and it accepted a non-airtight scan under a single trusted server. The drift is already there: `player_count` and the ATA set are two records, and the one a third party can write is the ATA. Q15's "no adversarial third party can construct a bypassing transaction" refers to a transaction of this program. The ATA create is not one of those.

Ticket 007's open spec (#39) keeps the private-game password off-chain, in front of `join_game` only. `join_game` does not read the hash, on purpose. An ATA created without `join_game` never reaches that check, so the password would not bind membership, the roster, mints, transfers, or an admin handoff. Public games already have the hole; 007 does not have to land first. 007 also plans to grow `Game` from `INIT_SPACE` 120 to 201 (account 128 → 209) for `is_private`, a 16-byte salt, and a 64-byte hash. A spec that stores members inside `Game` has to share that layout, or migrate twice.

Ticket 010's spec on main defines "already a player" as the initialized ATA (design D2). Shipping 010 first means `transfer_game_admin` gains the same check and 022 changes it afterward. 010 does not have to wait, and 022 does not wait on it.

## Scope

- One membership fact, written by `join_game` and by the creator path in `create_game`, removed by `quit_game` and `close_game_player`.
- `mint_to_player`, `transfer_token` (sender and recipient), `quit_game`, and `close_game_player` read that fact. So does `transfer_game_admin` if 010 has merged.
- The 20-player cap applies to that fact. `close_game` treats the game as empty only when the fact says nobody remains.
- The client roster, the viewer's member flag, deposit, transfer, quit, and close use the same fact. A token account that is not a member does not show up and does not take down the game page or close.
- The spec that follows updates Q15, 010's "initialized ATA" scenario, and 012's ATA-list wording so the repo has one definition. 012's implementation stays in 012.

## Acceptance criteria

- [ ] A user whose canonical ATA for the mint exists, and who was not added by `join_game` or `create_game`, is rejected by `mint_to_player`, by `transfer_token` as sender or recipient, and by `quit_game` and `close_game_player`. `player_count` (or its replacement) does not change.
- [ ] The same user is rejected by `transfer_game_admin` when that instruction exists. `Game.admin` does not change.
- [ ] The 21st member is rejected. Members are the people added through `join_game` and `create_game`, and creating token accounts outside those instructions does not raise the count the cap sees.
- [ ] After the last member leaves, `close_game` succeeds. It keeps failing while a member who joined through `join_game` or `create_game` remains, including when other token accounts for the mint exist.
- [ ] The game page, browse member flag, home list, deposit picker, transfer picker, and close enumeration follow that same member set. A token account for the mint whose owner is not a member leaves those pages and actions working.
- [ ] With 007's password gate in place, the only way to become a member of a private game is the server path that already checks the password (`create_game` for the creator, `join_game` for everyone else). This ticket does not move the password check on-chain.
- [ ] The spec states the account-size delta and the migration for games that already exist (local reset, devnet recreate, or a backfill). Ticket 004 is still pending; there is no mainnet.

## Out of scope

- Implementing 007, 010, or 012, and editing 014–016.
- Moving the private-game password on-chain. 007 keeps scrypt off-chain because the hash is public account data and the plaintext must not be a transaction argument.
- Changing who holds the system wallet, or which sessions may ask the server to mint, transfer, quit, or close.
- Reclaiming the game mint. Ticket 013 already leaves it in place; the legacy SPL Token program cannot close it.

## Candidate approaches

The spec picks one. Both have to be written from `join_game` and `create_game` only. After the fact, a canonical ATA this program created is indistinguishable from one anyone else created.

**Per-player membership PDA.** `join_game` and `create_game` create an account this program owns, for example seeds `[b"player", game, user]`. `quit_game` and `close_game_player` close it. Callers pass it as an `Account` and a missing account is the "not a member" error. `Game` stays the size it already is (128 bytes on main, or 209 if 007's fields land first), so this does not collide with 007's layout and does not need a `Game` realloc. Cost: one rent-bearing account per member, reclaimed on quit or close, and one extra account on each instruction that checks membership (two on `transfer_token`). Listing members means a scan of those PDAs, so the account data has to carry the game key the filter needs. Existing local games have ATAs and no PDA; the spec chooses a one-time backfill or the same local reset 007 describes. A backfill that trusts "ATA exists" would recreate this bug for games already in progress, so the rule for who gets a PDA has to be explicit.

**Members stored on `Game`.** Replace `player_count` with `players: Vec<Pubkey>` at `#[max_len(20)]`. The length is the count `close_game` and the cap read. Keeping `player_count` beside the vec is the two-record drift this ticket is closing. Anchor's `InitSpace` for that vec is 4 + 20×32 = 644 bytes. Dropping the one `player_count` byte makes `INIT_SPACE` 120 − 1 + 644 = 763, account data 771. On top of 007's +81 bytes (`INIT_SPACE` 201 in #39) the combined `INIT_SPACE` is 844 and the account is 852. Solana can hold that. Every game instruction deserializes the larger account, and the roster is a single `Game` fetch with no scan. Existing 128-byte `Game` accounts will not deserialize. 007's spec already chooses a reset over `realloc` for its own +81 bytes (`just down-clean` locally, recreate devnet games, no mainnet). Doing both layout changes separately is two resets; doing them as one layout is one. There is no mainnet either way.
