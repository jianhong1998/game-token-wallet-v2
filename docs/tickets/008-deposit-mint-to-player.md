# 008 — Deposit / mint to player

**What to build:** A game admin credits a player's in-game balance to represent an offline cash deposit.

**Blocked by:** 006

**Status:** Done

**Spec:** [openspec/changes/deposit-mint-to-player/](../../openspec/changes/deposit-mint-to-player/)
**Plan:** [docs/superpowers/plans/2026-08-10-deposit-mint-to-player.md](../superpowers/plans/2026-08-10-deposit-mint-to-player.md)

- [x] Mint instruction restricted to the game's admin signer; mints an admin-specified amount directly into a target player's ATA for that game's token.
- [x] Admin-facing form: pick a player in the game, enter an amount, submit; player's balance updates.
- [x] Non-admin users cannot successfully call this instruction (enforced on-chain, not only hidden in the UI).
- [x] Player-facing view shows their current game-token balance, refreshed after a deposit.

**Verification note:** All 4 ACs confirmed via TDD implementation + code review + 3 rounds of live Tier-3 verification, on branch `feature/deposit-mint-to-player`. On-chain: new `mint_to_player` instruction (`user.key() == game.admin` identity check — not tx-signer, since one custodial system wallet signs every transaction; deterministic ATA validation rejecting non-members with `PlayerNotInGame`; `InvalidDepositAmount` for non-positive amounts) — covered by Rust unit tests and 4 `on-chain-program-e2e` scenarios (happy path, non-admin rejection, non-member rejection, zero-amount rejection). Frontend: new `depositToPlayer` server action and admin-only "Admin controls" deposit modal on `/games/[address]` (member-only player picker, `router.refresh()` on success) — covered by unit tests and a 2-browser-context Playwright e2e spec (`apps/e2e/tests/game-deposit.spec.ts`). Full `just lint`/`just test` green. Verification found and fixed one real regression not caught by unit tests or code review: an amount like `1e29` passed early client-side guards but exceeded on-chain `u64::MAX`, crashing with an uncaught error (HTTP 500) instead of a friendly rejection — closed with a bound check before instruction construction, re-verified clean. Manually verified via live Playwright MCP walkthrough against a freshly rebuilt local stack (`just down-clean && just up-build`): register two users, create game, join as second user, admin deposits via the modal, balance confirmed on both the admin's immediate view and the player's next-load view. Three minor cleanup items deferred (not fund-safety issues): duplicated e2e test boilerplate, duplicated PDA/ATA-resolution logic across server actions, and a wrong-but-still-safe error message for astronomically large amounts — see `.loop-logs/2026-08-10-deposit-mint-to-player/code-review/round-2.md`.
