# 021 — Auto-join admin as player at game creation

**What to build:** `create_game` also creates the admin's own ATA for the new game's mint, so the creator is immediately a player (not just admin) without a separate `join_game` call.

**Blocked by:** 005, 006

**Status:** Done

**Spec:** [openspec/changes/auto-join-admin-at-creation/](../../openspec/changes/auto-join-admin-at-creation/)
**Plan:** [docs/superpowers/plans/2026-08-09-auto-join-admin-at-creation.md](../superpowers/plans/2026-08-09-auto-join-admin-at-creation.md)

- [x] `create_game` creates the admin's ATA for the game's mint in the same instruction/transaction, reusing `join_game`'s (006) create-ATA logic, and increments `Game.player_count` to 1.
- [x] Creator sees themselves in the game's players list (with a zero balance) immediately after creation, with no separate join step.
- [x] Existing `create_game` behavior (registry insertion, name validation, mode, admin field) is unchanged — this only adds the auto-join side effect.
- [x] Filed as a follow-up during 006's planning session (see [2026-08-06-join-game-public-design.md](../superpowers/specs/2026-08-06-join-game-public-design.md) Q4) rather than amending the already-shipped 005, to avoid churning 005's tests for a change it didn't strictly need.
