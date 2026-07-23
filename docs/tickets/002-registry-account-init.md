# 002 — Registry account + init

**What to build:** An admin can initialize the on-chain game registry for a fresh deployment, giving the app a cheap way to list active games without scanning all program accounts (see [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q4).

**Blocked by:** 001

**Status:** done

- [x] `Registry` PDA (single global account) holds a bounded list of active game IDs, capped at an explicit `MAX_ACTIVE_GAMES` constant (concrete value chosen and documented).
- [x] Init instruction creates the Registry account if it doesn't already exist; a second call is a safe no-op/clean rejection, not a crash.
- [x] A Server Action + minimal admin page can trigger registry initialization and confirm it succeeded (e.g. displays "registry initialized, 0 active games").
- [x] Registry account sizing follows the existing codebase's discriminator + `InitSpace` convention.
