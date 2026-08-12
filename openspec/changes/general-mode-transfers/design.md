## Context

Ticket 009, blocked-by 008 (`mint_to_player`, done). Architecture decision Q14 (`docs/technical-related/architecture/002-architecture-decisions.md`) already settled the shape of the on-chain instruction: single-recipient, fixed accounts, no `Vec<Pubkey>`/`remaining_accounts` — "transfer to multiple players" is expressed client-side as N single-recipient instructions, chunked across transactions by the client, not the program. This design covers the remaining how: the on-chain instruction's account/authorization shape, the chunking algorithm, and the atomicity/error-reporting contract for a batch that spans multiple transactions.

Resolved in a `grill-me` session before this document (see commit history / conversation — not re-litigated here):
- Authorization is server-action-only (session username === sender); no on-chain identity check exists for a P2P sender (unlike `mint_to_player`'s `game.admin` comparison, there's no on-chain "owner" fact to check a transfer's sender against).
- Self-transfer rejected both server-side and on-chain (defense in depth, explicitly requested).
- Recipient-must-already-be-a-member enforced on-chain (real guarantee) and via the frontend picker's scope.
- No on-chain balance pre-check; the SPL `token::transfer` CPI's native insufficient-funds rejection is the actual guarantee.
- Atomicity: best-effort pre-flight balance sum check + stop-on-first-chunk-failure + applied/total counts reported back.

## Goals / Non-Goals

**Goals:**
- A `transfer_token` instruction that is safe to audit (fixed accounts, no dynamic-length validation) and mirrors existing instruction conventions (`mint_to_player.rs`, `join_game.rs`).
- A chunking algorithm that packs as many recipients per transaction as will actually fit Solana's serialized-transaction limit, verified against a realistic worst case (~19 recipients, max username length), rather than a guessed/hardcoded recipient-per-chunk constant.
- Honest partial-failure reporting: a caller can always tell how many recipients were actually paid, never just ok/fail.

**Non-Goals:**
- Atomicity across the whole batch — Solana transactions are only atomic individually. This design does not attempt an escrow/staging account or any other mechanism to make a multi-transaction batch atomic as a whole; that would contradict Q14's "keep the instruction simple" reasoning and is out of scope for this ticket.
- Retrying a failed chunk automatically. On first chunk failure the batch stops; retry (if any) is a future, explicit user action, not silent behavior here.
- Address Lookup Tables. Not needed — see the sizing math below, which shows the byte-size ceiling binds well before the account-count ceiling that ALTs exist to solve.

## Decisions

### 1. On-chain instruction shape

`transfer_token(ctx, game_id: [u8; 16], sender_username: String, recipient_username: String, amount: u64)`, accounts:

| Account | Type | Notes |
|---|---|---|
| `admin` | `Signer` | System wallet, fee payer — same custodial role as every other instruction |
| `sender` | `Account<User>` | seeds `[b"user", sender_username, admin.key()]` |
| `recipient` | `Account<User>` | seeds `[b"user", recipient_username, admin.key()]` |
| `game` | `Account<Game>` | seeds `[b"game", game_id]`, needed to derive/validate `mint` |
| `mint` | `Account<Mint>` | seeds `[b"mint", game.key()]` |
| `sender_ata` | `UncheckedAccount` | validated against `get_associated_token_address(sender.key(), mint.key())`; must already be initialized (it is, since `sender` is spending from it) |
| `recipient_ata` | `UncheckedAccount` | validated against `get_associated_token_address(recipient.key(), mint.key())`; `PlayerNotInGame` if not yet initialized — same posture as `mint_to_player`'s target-ATA check |
| `token_program` | `Program<Token>` | |

Handler order (mirrors `mint_to_player.rs`'s check-then-CPI structure):
1. `require_keys_neq!(sender.key(), recipient.key(), ErrorCode::SelfTransfer)` — checked first, cheapest guard.
2. `ensure_positive_amount(amount)` (`InvalidTransferAmount`) — same shape as `mint_to_player::ensure_positive_amount`, just a distinct error variant since it's a spend, not a mint.
3. Validate `sender_ata`/`recipient_ata` against their expected derivations; `PlayerNotInGame` if `recipient_ata.data_is_empty()`.
4. CPI `token::transfer` with `authority = sender` (the sender's own `User` PDA), signer seeds `[b"user", sender_username.as_bytes(), admin.key().as_ref(), &[ctx.bumps.sender]]` — this is the key structural difference from `mint_to_player`, where the CPI authority/signer is the `game` PDA (mint authority). Here the "spending" authority is the sender's own account, which is exactly what makes this a P2P transfer rather than an admin-privileged mint.

No new state, no new account type — `transfer_token` only moves value between two already-existing ATAs.

**Alternative considered:** modeling `sender` identity via a signer-side check instead of a PDA CPI (e.g., requiring `admin.key()` to somehow encode which player is acting). Rejected — the custodial model means `admin` is always the same system wallet regardless of which player initiated the action; the `User` PDA CPI-signer pattern is the only mechanism that ties the transfer to a specific player's balance without inventing new state.

### 2. New errors (`errors.rs`)

- `SelfTransfer`: "Cannot transfer tokens to yourself"
- `InvalidTransferAmount`: "Transfer amount must be greater than zero"
- Reuses existing `PlayerNotInGame` for a non-member recipient (same semantics as the deposit case: "target account doesn't exist yet, and this instruction doesn't create it").

### 3. Chunking algorithm (server action)

Rejected approach: a hardcoded "N recipients per transaction" constant. Byte cost per `transfer_token` instruction is dominated by two variable-length `String` args (`sender_username`, `recipient_username`, up to `MAX_USERNAME_BYTES = 32` each) plus 8 account-index bytes, so a constant sized for the worst case (max-length usernames) would under-pack every real batch, while one sized for the common case would silently overflow on long usernames — worst-case math below:

- Fixed transaction overhead (signature + header + blockhash + counts): ~102 bytes.
- Shared accounts across every instruction in the batch (deduplicated in the account-key table, 32 bytes each): `admin`, `game`, `mint`, `token_program`, `sender`, `sender_ata` = 6 × 32 = 192 bytes.
- Per-recipient marginal cost: 2 new account keys (`recipient`, `recipient_ata`, 32 bytes each = 64 bytes) + one instruction (~11 bytes of instruction framing + 8 account-index bytes + instruction data: 8-byte discriminator + 16-byte `game_id` + 2×(4-byte length prefix + up to 32-byte username) + 8-byte `amount` = up to 104 bytes) ≈ up to 179 bytes/recipient in the worst case.
- At the ~1232-byte legacy transaction size ceiling: `(1232 − 294) / 179 ≈ 5` recipients/transaction in the *worst case* (both usernames at the 32-byte max). Real usernames are typically shorter, so real-world packing is denser.

**Decision:** the server action builds instructions one at a time and packs them into the current chunk by computing the actual serialized message size after each addition (using the same `@solana/kit` message-compilation the rest of the codebase already uses to build/send transactions — no separate hand-rolled size estimator), starting a new chunk when the next instruction would exceed a safety-margined byte budget (1232 minus a small buffer, since compact-u16 length-prefix widths can shift by a byte at certain thresholds) or the account-count ceiling (64) — the latter never binds in practice (44 accounts at 19 recipients) but is cheap defense-in-depth against future account additions to the instruction. This guarantees correctness for any username length without a magic constant, and the 19-recipient worst case (ticket's explicit acceptance criterion) is tested directly rather than inferred from the arithmetic above.

**Alternative considered:** a fixed conservative chunk size (e.g., 5, from the worst-case math above). Rejected as the ticket explicitly asks the batching to be "verified against a realistic worst case," implying the packing should be exercised, not just asserted correct by a hardcoded number that could silently become wrong if the instruction's accounts or args change later.

### 4. Sequential send, stop-on-first-failure, applied/total reporting

Chunks are signed and sent **sequentially** (not in parallel) — sending chunk 2 before confirming chunk 1 landed would make "stop on first failure" meaningless, since chunk 2 could already be in flight when chunk 1's failure is discovered. `transferTokens` returns:

```ts
type TransferTokensResult =
  | { ok: true }
  | { ok: false; error: string; transfersApplied: number; transfersTotal: number };
```

`transfersApplied` = recipients covered by chunks that confirmed successfully before the failing chunk (not partial-within-a-chunk — a chunk's instructions are atomic as a single transaction, so a chunk either fully lands or fully doesn't). The frontend uses this to render "Sent to `transfersApplied` of `transfersTotal` recipients, then failed: `error`" when `transfersApplied > 0`, versus a plain validation-style message when `transfersApplied === 0` (nothing was ever sent — the common case, e.g. failing the pre-flight balance check).

### 5. Pre-flight balance check

Before building any instruction, fetch the sender's current ATA balance and compare against `sum(recipients[].amount)`. If insufficient, return `{ ok: false, transfersApplied: 0, transfersTotal, error: "Not enough balance for this transfer" }` without sending anything — matches the ticket's "insufficient balance for the full batch fails cleanly" requirement for the common case (balance checked once, up front, at request time). This is explicitly best-effort (documented, not silently assumed race-free): a concurrent transfer between the pre-flight check and chunk execution can still make a later chunk fail with the SPL program's native insufficient-funds rejection, which is handled by the stop-on-first-failure path in decision 4, not by this check.

### 6. Frontend

Inline "Send tokens" section on the game detail page (General Mode only, visible to all members, not a modal) — see `docs/technical-related/ui-design/004-ui-sample/Kitty - Glass Vault.dc.html`'s `isGame` → `gameIsGeneral` block for the literal reference: repeatable recipient rows (player picker + amount + remove), "+ Add recipient", submit button showing the running total. One deviation from the mockup: each row's player picker excludes both the current user and usernames already selected in other rows (the mockup only excludes self) — implemented as a per-row computed list, same shape as the mockup's existing `otherPlayers` computation, with an added filter over sibling rows' selected usernames.

## Risks / Trade-offs

- **[Risk]** A batch that fails partway leaves the sender's balance partially spent with no automatic recovery. → **Mitigation:** this is the honest consequence of Solana's per-transaction atomicity (documented in Non-Goals); the `transfersApplied`/`transfersTotal` contract makes the partial state visible instead of hiding it, and the game detail page's balance/player list re-fetch (`router.refresh()`, same convention as ticket 008) reflects the true on-chain state immediately after.
- **[Risk]** The byte-size chunking logic has an off-by-a-few-bytes bug that lets a chunk exceed the real transaction limit, causing an opaque RPC rejection instead of a friendly error. → **Mitigation:** a safety margin below the hard 1232-byte ceiling (not packing right up to the limit) plus an e2e test at the 19-recipient worst case (max-length usernames) catches this before it reaches production.
- **[Risk]** Sequential chunk sends make a large batch (e.g. 4 chunks for 19 recipients) noticeably slower than a single transaction. → **Mitigation:** accepted — ticket 009 doesn't set a latency requirement, and correctness (stop-on-first-failure semantics) requires sequential sends; not optimizing for a case the ticket doesn't ask for.
