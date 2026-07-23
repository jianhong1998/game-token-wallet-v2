# 002 — Registry account + init — Design

Spec for [docs/tickets/002-registry-account-init.md](../../tickets/002-registry-account-init.md). Blocked by ticket 001 (done). Builds on architecture decision Q4 ([002-architecture-decisions.md](../../technical-related/architecture/002-architecture-decisions.md)), which already fixed the `Registry` PDA seed (`["registry"]`) and shape (bounded `Vec<Pubkey>` of active game IDs) — this doc resolves what that decision left open, and lays out the implementation.

This is the first ticket to add a real on-chain account/instruction beyond the `noop` scaffolding from ticket 001, so it also establishes the `state/`, `instructions/<domain>/` directory pattern that every later ticket (003–016) will follow.

---

## Grill session — decisions

### Q1: What should happen when `initialize_registry` is called a second time?

**Answer:** Idempotent success at the frontend layer.

**Decision:** The on-chain instruction stays a plain, boring Anchor `init` (no `init_if_needed`, no custom error). A direct second on-chain call fails with Anchor's ordinary "already in use" `Err` — never a panic — which is all the *program* needs to guarantee ("clean rejection, not a crash" per the ticket). The friendlier idempotent UX (repeat calls always report success) is implemented one layer up, in the Next.js Server Action: it reads the account first and only sends a transaction if the account doesn't yet exist.

**Reason:** Keeps the on-chain instruction simple and auditable (matches architecture Q14's stated preference for simple, boring on-chain code over dynamic/clever constructs) while still giving the admin page the "always succeeds, shows current state" behavior that was asked for.

### Q2: Concrete value for `MAX_ACTIVE_GAMES`?

**Answer:** 128.

**Decision:** `Vec<Pubkey>` capped at 128 entries → 4,096 bytes of pubkeys + ~12 bytes overhead ≈ 4.1KB account, ~0.03 SOL rent-exempt (one-time, admin-paid, no resizing later).

**Reason:** Generous headroom for a self-hosted, friend-group deployment (20-player-per-game cap per the PRD) while keeping the singleton account small and cheap. Resolves the open item flagged in [002-pending-discussion.md](../../business-related/002-pending-discussion.md).

### Q3: Should the admin page/action be gated, given ticket 003 (real login) doesn't exist yet?

**Answer:** No — leave fully open in this ticket.

**Decision:** No auth/secret gating added. Combined with the Q1 design (repeat calls after the first never send a transaction, only re-read state), an anonymous visitor spamming the page cannot drain the system admin wallet's fees beyond the single legitimate init transaction.

**Reason:** This is one-time bootstrap tooling on a devnet/self-hosted deployment the operator controls; real access control arrives with ticket 003. Adding a bespoke interim auth mechanism here would be scope creep for a bootstrap ticket, and the read-first design already removes the DoS concern that would otherwise justify it.

### Q4: Where does the admin page live in the route tree?

**Answer:** `/admin/registry`.

**Decision:** New top-level `app/admin/` segment (sibling to the existing `(auth)`/`(app)` route groups, since this is operator tooling, not end-user product surface), with a `registry` subpage. Sets the precedent for any future admin pages.

**Reason:** Keeps operator-only tooling visibly separate from the user-facing route groups without inventing a naming scheme later tickets would have to guess at.

---

## Design

### On-chain program (`apps/on-chain-program`)

**New `Registry` account** — `programs/game_token_wallet/src/state/registry.rs` (first file in `state/`):

```rust
pub const MAX_ACTIVE_GAMES: usize = 128;

#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub bump: u8,
    #[max_len(MAX_ACTIVE_GAMES)]
    pub active_games: Vec<Pubkey>,
}
```

- `bump` is stored (standard Anchor idiom) so later tickets that mutate this account (`create_game` appending, `close_game` pruning) can use `bump = registry.bump` instead of recomputing `find_program_address`.
- Space = `8 + Registry::INIT_SPACE`, matching the ticket's discriminator + `InitSpace` requirement.

**New `initialize_registry` instruction** — `programs/game_token_wallet/src/instructions/registry/initialize.rs` (new `instructions/registry/` folder, sibling to the planned `user/`/`game/`/`general_mode/`/`poker_mode/`/`pool_mode/` folders from the codebase-structure doc):

- Accounts: `admin: Signer` (payer), `registry: Account<Registry>` with `init, payer = admin, space = 8 + Registry::INIT_SPACE, seeds = [b"registry"], bump`, `system_program: Program<System>`.
- Body: sets `registry.bump = ctx.bumps.registry`; `active_games` is left as the zero-initialized empty `Vec` Anchor's `init` naturally produces.
- No `errors.rs` added in this ticket — there's no custom business-logic error condition yet (a duplicate-init attempt is already a normal Anchor/system-program `Err`); adding an empty error enum now would be speculative.

### Frontend (`apps/frontend`)

**Server Action** — `server/actions/registry.ts`, `initializeRegistry(): Promise<{ activeGameCount: number }>`:

1. Derive the registry PDA, fetch + decode the account first (read-only, no transaction sent).
2. If it exists → return `{ activeGameCount: registry.active_games.length }` immediately.
3. If it doesn't exist → build and send the `initialize_registry` instruction (same `pipe(...)` transaction-building pattern as `sendNoopTransaction` in `server/actions/noop.ts`), then return `{ activeGameCount: 0 }`.
4. If step 3 races and fails with "already in use" (concurrent caller), catch it and re-fetch rather than surfacing an error — still reported as success.

**Page** — `app/admin/registry/page.tsx`: same client-component shape as the current home page demo (`"use client"`, `useState` + `useTransition`, button click → `startTransition(() => initializeRegistry())`), rendering "Registry initialized, N active games." on success or the caught error message on failure. No access gating.

### Testing

- `cargo test`: inline unit test on `Registry`/`MAX_ACTIVE_GAMES` sizing, guarding `InitSpace` regressions.
- `on-chain-program-e2e` (Surfpool, `anchor test`): happy path (first call creates the account with an empty list) + calling the raw instruction twice directly, proving the program-level rejection on the second call is a clean `Err`, not a panic.
- Frontend vitest on the Server Action: not-yet-initialized path (sends a transaction) and already-initialized path (no transaction sent, decodes existing state) — covers the happy path plus the idempotency edge case.
- `apps/e2e` Playwright spec (`admin-registry.spec.ts`, same shape as the existing `noop.spec.ts`): drives the real `/admin/registry` page against the docker-compose stack, asserts the success text renders.
- Manual verification against the local docker-compose/Surfpool stack before marking the ticket done, per this repo's Done-Means rule (boot the stack, click the button, confirm the observed text).

---

## Self-review

- No placeholders/TBDs remain — `MAX_ACTIVE_GAMES`, the re-init behavior, page route, and access-gating decision are all concrete.
- Internally consistent: the "idempotent success" UX (Q1) and "no gating needed" conclusion (Q3) both rely on the same read-before-write design in the Server Action — checked, they don't contradict.
- Scope: single ticket, single account + single instruction + one page. Does not reach into `create_game`/`close_game` (which will later mutate `active_games`) — correctly left for their own tickets.
- No requirement reads two ways: "safe no-op/clean rejection" from the ticket text is explicitly split into its on-chain half (clean `Err`) and frontend half (idempotent success), removing the ambiguity that prompted Q1.
