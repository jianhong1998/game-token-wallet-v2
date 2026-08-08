## Context

`apps/frontend/src/app/page.tsx` at `/` is ticket 001's leftover connectivity smoke test (a "Send noop transaction" button calling the on-chain program's `noop` instruction), never replaced with real app content. The real authenticated placeholder currently lives at `/home`. Ticket 018 (home dashboard/nav/account) is design-complete but not yet implemented, and needs to build directly at `/` rather than `/home` — this change does the structural move first so 018 doesn't have to build-then-relocate.

Full grill session and decision rationale: [docs/superpowers/specs/2026-07-26-remove-noop-relocate-dashboard-design.md](../../../docs/superpowers/specs/2026-07-26-remove-noop-relocate-dashboard-design.md).

## Goals / Non-Goals

**Goals:**
- Delete the `noop` scaffolding end-to-end: on-chain instruction, e2e tests, generated client export, frontend Server Action.
- Relocate the authenticated dashboard placeholder from `/home` to `/` (inside the `(app)` route group), making it session-gated.
- Extract the sign → assert-blockhash-lifetime → send-and-confirm sequence (previously explained only in `noop.ts`'s comment) into a shared helper used by `auth.ts`, `registry.ts`, and `game.ts`.
- Amend ticket 018's ticket file and design doc to target `/` instead of `/home`.

**Non-Goals:**
- No redirect from the old `/home` path — the app isn't published yet, so there's no external audience with `/home` bookmarked (deleted outright, 404s after this change).
- No new dashboard content — this change only relocates the existing placeholder (welcome message + logout button); ticket 018 owns the real dashboard UI.
- No devnet/IDL backward-compatibility handling for the removed `noop` instruction — nothing is deployed yet (`Anchor.toml` still `cluster = "localnet"`).

## Decisions

- **Sequencing before ticket 018**: this change lands first since nothing in 018 is implemented yet; building 018 at `/home` only to move it would be pure churn.
- **Extract a shared transaction helper rather than relocate the comment**: `noop.ts`'s sign/assert/send-and-confirm sequence is duplicated byte-for-byte across `auth.ts`, `registry.ts`, and `game.ts` today. Deleting `noop.ts` forces some change to every cross-reference regardless, so doing the actual dedup (new helper, likely in `server/connection.ts` or a new `server/transaction.ts`) costs little more than moving a comment and removes real duplication.
- **`/home` deleted outright, no redirect**: pre-launch, devnet-only app with no real audience — a redirect would be defensive plumbing for a compatibility problem that doesn't exist.
- **`/` moves into `(app)` and out of `PUBLIC_PATHS`**: leaving `/` public while it renders the authenticated dashboard would either leak the dashboard to logged-out visitors or crash fetching a session-less user's games. Must land atomically with the content move.
- **Full on-chain removal chain**: `lib.rs` handler + `Noop` struct, both e2e suites (`on-chain-program-e2e`, `e2e`), regenerated `on-chain-client` (drops `getNoopInstruction`), and the client's own "exports a noop instruction builder" assertion. Confirmed no live devnet deployment exists yet and ticket 004's actual smoke-test requirement ("register and log in against the live devnet deployment") doesn't depend on `noop` — so nothing downstream needs it to survive.

## Risks / Trade-offs

- [Deleting `/home` outright breaks any external bookmark/link] → Mitigated: app is pre-launch, devnet-only, no real users yet.
- [Extracting the shared transaction helper touches 3 existing call sites (`auth.ts`, `registry.ts`, `game.ts`) at once] → Mitigated: the sequence is already byte-identical across all 4 sites (including `noop.ts`), so the extraction is mechanical, not a behavior change; covered by each site's existing test coverage.
- [Moving `/` out of `PUBLIC_PATHS` is a security-relevant middleware change] → Mitigated: must land in the same commit as the content move (not staged separately) so there's never a window where the dashboard is both at `/` and publicly reachable.

## Migration Plan

1. On-chain: remove `noop` handler/struct, regenerate `on-chain-client`, delete both e2e noop specs and the client's noop-export test assertion.
2. Frontend: add the shared transaction helper; migrate `auth.ts`, `registry.ts`, `game.ts` to use it; delete `server/actions/noop.ts`.
3. Frontend: delete `app/page.tsx` (no-op demo); move `app/(app)/home/*` → `app/(app)/page.tsx` (+ `LogoutButton.tsx`, colocated tests).
4. `middleware.ts`: drop `"/"` from `PUBLIC_PATHS`; update `middleware.test.ts` accordingly.
5. Amend ticket 018's ticket file + design doc to reference `/` instead of `/home`, `Blocked by` includes this change.

No rollback beyond standard revert — no data migration involved (routing/code-only change).

## Open Questions

None — all branches resolved during the grill session referenced above.
