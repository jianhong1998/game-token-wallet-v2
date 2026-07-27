# 019 — Remove no-op scaffolding; relocate dashboard to `/` — Design

Spec for [docs/tickets/019-remove-noop-relocate-dashboard.md](../../tickets/019-remove-noop-relocate-dashboard.md). Blocked by 001 (repo bootstrap, done) and 003 (login, done). Triggered by the same UI-design-vs-shipped-tickets audit that produced ticket 018: `apps/frontend/src/app/page.tsx` at `/` is ticket 001's leftover connectivity smoke test (a "Send noop transaction" button calling the on-chain program's `noop` instruction), never replaced with real app content, while the real authenticated placeholder lives at `/home` instead of the app's root.

---

## Grill session — decisions

### Q1: Does this ticket land before or after ticket 018 (home dashboard/nav/account)?

**Answer:** Before.

**Decision:** This ticket (019) does the structural move first — deletes the no-op scaffolding, relocates the dashboard route to `/`, updates `middleware.ts`. Ticket 018's already-written ticket file and design doc are amended in place to target `/` instead of `/home` throughout. 018's `Blocked by` becomes `005, 006, 019`.

**Reason:** Nothing in 018 has been implemented yet — it's design-only. Building 018's real dashboard content at `/home` only to immediately relocate it to `/` would be pure churn with zero benefit. Landing 019 first means 018 is built directly at its final location.

### Q2: `noop.ts`'s explanatory comment (why `assertIsTransactionWithBlockhashLifetime` is needed) is cross-referenced by `registry.ts` and `registry.test.ts`. Relocate the comment, or extract a shared helper?

**Answer:** Extract a shared helper.

**Decision:** A new helper (e.g. in `server/connection.ts` or a new `server/transaction.ts`) wraps the sign → assert-blockhash-lifetime → send-and-confirm sequence once. `auth.ts`, `registry.ts`, and `game.ts` (all four call sites previously duplicating this exact sequence, `noop.ts` being the fourth) switch to calling it.

**Reason:** This is 4 real, already-existing call sites doing byte-identical boilerplate — not speculative abstraction. Deleting `noop.ts` forces some change to every cross-reference regardless; doing the actual dedup costs little more than relocating a comment, and removes duplicated code instead of just moving where the explanation of it lives.

### Q3: Does the old `/home` route redirect to `/`, or is it deleted outright?

**Answer:** Deleted outright.

**Decision:** No redirect. Visiting `/home` after this ticket 404s (or falls through to whatever Next.js does for an unmatched route).

**Reason:** The app isn't published yet (devnet-only, pre-launch per CLAUDE.md's project description) — there's no real audience with `/home` bookmarked or linked externally. A redirect would be defensive plumbing for a compatibility problem that doesn't exist.

### Q4: Does `/` move into the `(app)` route group and come out of `middleware.ts`'s `PUBLIC_PATHS`?

**Answer:** Yes, in scope for this ticket.

**Decision:** The page moves to `apps/frontend/src/app/(app)/page.tsx` (route groups don't affect the URL, so this still resolves to `/`). `middleware.ts`'s `PUBLIC_PATHS` set drops `"/"`, so an unauthenticated visitor to `/` is redirected to `/login` exactly like any other `(app)` route.

**Reason:** Not optional — leaving `/` in `PUBLIC_PATHS` while it renders the authenticated dashboard would either leak the dashboard to logged-out visitors or crash fetching a session-less user's games. This has to land atomically with the content move, not as a follow-up.

### Q5: Full removal chain on the on-chain side — how far does it reach?

**Answer:** All the way through codegen and both e2e suites.

**Decision:** `lib.rs`'s `noop` handler and `Noop` accounts struct deleted; `apps/on-chain-program-e2e/tests/noop.test.ts` and `apps/e2e/tests/noop.spec.ts` deleted; `on-chain-client` regenerated (drops `getNoopInstruction`); the "exports a noop instruction builder" assertion in `apps/on-chain-client/src/index.test.ts` removed.

**Reason:** Confirmed nothing is deployed to devnet yet (`Anchor.toml` still `cluster = "localnet"`; ticket 004's devnet-deploy is still Pending), so there's no live program or IDL-compatibility concern. Confirmed ticket 004's actual smoke-test requirement is "register and log in against the live devnet deployment," not the noop instruction — so nothing downstream depends on `noop` surviving. Leaving any piece (a stale e2e spec, a generated client still exporting a dead instruction) would just be broken debris, not backward compatibility.

---

## Design

*(Structural sketch — file-by-file implementation detail is for the writing-plans step.)*

- `apps/on-chain-program/programs/game_token_wallet/src/lib.rs` — remove `noop` handler + `Noop` struct.
- `apps/on-chain-program-e2e/tests/noop.test.ts`, `apps/e2e/tests/noop.spec.ts` — deleted.
- `apps/on-chain-client` — regenerate via existing codegen command; `apps/on-chain-client/src/index.test.ts` — remove the noop-builder assertion.
- `apps/frontend/src/server/actions/noop.ts` — deleted.
- New shared helper (exact location decided during planning — likely `server/connection.ts` or `server/transaction.ts`) — sign/assert-blockhash-lifetime/send-and-confirm, replacing the duplicated sequence in `auth.ts`, `registry.ts`, `game.ts`.
- `apps/frontend/src/app/page.tsx` — deleted (no-op demo).
- `apps/frontend/src/app/(app)/home/page.tsx`, `LogoutButton.tsx` (+ colocated tests) — moved to `apps/frontend/src/app/(app)/page.tsx`, `apps/frontend/src/app/(app)/LogoutButton.tsx`.
- `apps/frontend/src/middleware.ts` — `PUBLIC_PATHS` drops `"/"`. `middleware.test.ts`'s "allows the root noop demo page through without a session" test removed/rewritten to assert the opposite (root now requires a session).
- Ticket 018's ticket file and design doc — amended to reference `/` instead of `/home` throughout, `Blocked by` updated to include 019.

---

## Self-review

- Decisions resolve every branch raised: sequencing vs. 018 (Q1), the dangling cross-reference problem forced by deleting `noop.ts` (Q2), old-route fate (Q3), the security-relevant middleware change (Q4), and the full blast radius of the on-chain removal (Q5).
- Verified against the actual codebase rather than assumed: confirmed 4 real call sites share the assertion pattern (Q2), confirmed no live devnet deployment exists yet (Q5), confirmed ticket 004's smoke test doesn't depend on `noop` (Q5).
- Scope: a structural relocation + cleanup ticket. Does not touch 018's actual dashboard content/nav/account-screen work — that stays entirely in 018, just retargeted to `/`.
