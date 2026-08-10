# 008 — Deposit / mint to player

**What to build:** A game admin credits a player's in-game balance to represent an offline cash deposit.

**Blocked by:** 006

**Status:** ready-for-agent

**Spec:** [openspec/changes/deposit-mint-to-player/](../../openspec/changes/deposit-mint-to-player/)
**Plan:** [docs/superpowers/plans/2026-08-10-deposit-mint-to-player.md](../superpowers/plans/2026-08-10-deposit-mint-to-player.md)

- [ ] Mint instruction restricted to the game's admin signer; mints an admin-specified amount directly into a target player's ATA for that game's token.
- [ ] Admin-facing form: pick a player in the game, enter an amount, submit; player's balance updates.
- [ ] Non-admin users cannot successfully call this instruction (enforced on-chain, not only hidden in the UI).
- [ ] Player-facing view shows their current game-token balance, refreshed after a deposit.
