## Context

Ticket 005 is the first capability to write into the `Registry` populated by ticket 002, and the first to mint an SPL token. Full grill-session reasoning and code-level design lives in [docs/superpowers/specs/2026-07-25-create-game-general-mode-design.md](../../../docs/superpowers/specs/2026-07-25-create-game-general-mode-design.md) and the implementation plan at [docs/superpowers/plans/2026-07-25-create-game-general-mode.md](../../../docs/superpowers/plans/2026-07-25-create-game-general-mode.md) — this document summarizes the decisions that shape the spec; see those files for full rationale and file-by-file code.

## Goals / Non-Goals

**Goals:**
- A logged-in user can create a General Mode, public game and immediately see themselves as its admin.
- `Game`'s on-chain layout accommodates fields *this* ticket actually needs (`mode`) without needing a later realloc, while deliberately not pre-allocating fields only a *later* ticket needs.
- Registry capacity (`MAX_ACTIVE_GAMES = 128`, from ticket 002) is enforced atomically — no partial/corrupted state on overflow.

**Non-Goals:**
- Joining a game as a player (ticket 006) — `Game` has no `players` field yet.
- Private games / passwords (ticket 007) — `Game` has no `is_private`/`password_hash` field yet.
- Poker/Pool mode functionality (tickets 014/016) — `mode` is stored but only `General` has working instructions; the creation form shows no mode selector.
- Deposits/minting to players, transfers, closing (tickets 008/009/013).

## Decisions

- **`Game` PDA seed `["game", game_id]`, no admin in the seed.** `game_id` is a client-generated UUID v7 (`[u8; 16]`), already globally unique, and this deployment has only one system admin wallet — including it in the seed would add nothing. Alternative considered: mirror `User`'s `[..., admin]` seed pattern for consistency; rejected as pure boilerplate with no uniqueness benefit here.
- **`Game.admin` stores the creator's `User` PDA address, not a wallet pubkey.** There is no per-user wallet in this custodial model (architecture Q1) — the only real per-user on-chain identity is the `User` PDA. Passed into `create_game` as a read-only `Account<'info, User>` (not a bare `Pubkey` arg) so Anchor's own account deserialization enforces it's a real registered user, for free. Alternative considered: bare `Pubkey` argument trusting the server (same trust level as `delete_user`'s client-supplied ATA list, architecture Q15-17); rejected because that pattern's justification (worst case is orphaned rent dust) doesn't hold here — a bad `Game.admin` would silently break the "my games" list instead.
- **`mode: GameMode` enum stored now, always `General`.** Cheap (1 byte) to add alongside the other fields this ticket already touches, avoiding a future `realloc` when Poker/Pool land. Alternative considered: omit until ticket 014 needs it, matching the deferral applied to `is_private`/`players` below; rejected specifically because *this* ticket's own requirements name "mode" as part of the creation form, unlike visibility or player-list.
- **No `is_private`/`password_hash` (ticket 007) and no `players` list (ticket 006) yet.** Both are genuinely out of this ticket's scope per its own requirements text ("public visibility" only; no player-list behavior described). Anchor `realloc` is a normal, supported pattern here, so deferring costs nothing structurally. This is the YAGNI counterpoint to the `mode` decision above — the distinguishing factor is "did *this* ticket's requirements ask for it," not "might a future ticket want it."
- **Mint: legacy SPL Token (not Token-2022), 2 decimals, `Game` PDA as mint authority, no freeze authority.** No requirement anywhere calls for a Token-2022 extension; legacy Token has the widest tooling support. `Game` PDA as authority (not the admin wallet) scopes minting to its own game — idiomatic Anchor "program-owned resource," and it's what ticket 013's "closes the game's mint" reads more naturally as (the game's own PDA cooperating in its own closure). New dependency: `anchor-spl = "1"`, matching the existing `anchor-lang = "1"` version line.
- **Game name: same validation rules as `username`** (3–32 UTF-8 bytes, Unicode letter/number/space charset, NFC-normalized) but **no case-folding** — a display name isn't used for lookup/uniqueness, unlike a login username. Enforced at all three layers (frontend, Next.js server, on-chain) per explicit product decision — this goes further than `create_user`'s existing on-chain check, which only validates byte length, not charset; `create_game`'s on-chain handler adds a genuine Unicode charset check (`char::is_alphabetic() || char::is_numeric() || c == ' '`, using Rust's built-in Unicode-aware `char` methods — no new crate needed) with its own distinct `InvalidGameNameCharacters` error, separate from `InvalidGameNameLength`.
- **UUID v7 is hand-rolled**, not a new npm dependency. Node's `crypto.randomUUID()` only produces v4. Matches the precedent set by ticket 003's hand-rolled HMAC session-cookie signing (avoid a dependency for a small, well-specified, easily-tested primitive).
- **Registry-full boundary is unit-tested, not e2e-tested.** `Registry` is one global singleton PDA shared by the *entire* e2e test suite in one `anchor test` run; actually sending 128 real transactions to prove the boundary would be slow and would permanently exhaust the shared registry for every other (including future tickets') e2e test in that run. The capacity check is extracted into a pure `ensure_registry_has_capacity(active_games_len: usize) -> Result<()>` function, covered by a fast `cargo test` at the exact boundary. The e2e suite covers the happy path (registry count increases, entry present) and the name-validation error paths only.
- **"My Games" is a new, dedicated list page (`/games`), not folded into `/home`.** The ticket's literal requirement is "the game appears in their own game list" — a list page is the more direct reading than a single game detail page, and gives ticket 006 (public browse list) something to sit alongside rather than retrofit later.

## Risks / Trade-offs

- **[Risk]** Codama's rendering of the fieldless `GameMode` enum (scalar TS `enum` vs. a `{ __kind: "..." }` discriminated union) isn't verified until codegen actually runs. → **Mitigation:** the implementation plan calls this out explicitly as a checkpoint (inspect the generated type before writing the one e2e assertion that would depend on it); `mode` isn't otherwise surfaced in any frontend code path in this ticket, limiting blast radius.
- **[Risk]** Skipping e2e coverage of the registry-full boundary (see Decisions above) means the full instruction-dispatch wiring for that path is only proven by a unit test of the extracted pure function, not an end-to-end transaction. → **Mitigation:** accepted trade-off — the alternative (128 real transactions poisoning the shared validator for every later ticket's e2e suite) is worse than this small coverage gap; the happy-path e2e test still proves the registry-mutation code path (push + read-back) works.
- **[Risk]** `anchor-spl` is a new production dependency; `@solana-program/token` is a new test-only devDependency. → **Mitigation:** both are official Solana Program Library packages, same publisher tier as the already-adopted `@solana/kit`; flagged explicitly to and approved by the project owner before inclusion (not silently added).

## Migration Plan

No migration — this is new on-chain state (`Game` account, `create_game` instruction) and new frontend routes. No existing account layout changes. Deployed the same way as tickets 002/003 (devnet deploy per ticket 004's pipeline); no rollback concern beyond the normal "don't merge if `anchor test`/e2e fail" bar.

## Open Questions

None outstanding — all decisions above were confirmed with the project owner during a grill session (see the linked design doc for the full Q&A transcript) before this change was proposed.
