# V2 — Pending Discussion

Threads raised during the `/grill-me` architecture session
([002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md)) that were noted but not resolved. For a future
grilling session before the affected tickets get written.

---

## Deployment / CI-CD pipeline scope

PRD says CircleCI, docker self-hosted (env vars not baked at build time),
devnet deploy with env-controlled program ID. Not yet discussed:

- Pipeline stages — what runs on every PR vs. only on merge to main (lint,
  typecheck, `anchor test`, web `vitest`, docker build, devnet deploy)?
- Is devnet deploy automatic on merge, or manual/gated?
- Docker self-hosting note: since this app has no client-side wallet, likely
  _no_ `NEXT_PUBLIC_*` env vars are needed at all (everything Solana-related
  is server-only) — worth confirming there's truly nothing client-visible
  that would hit Next.js's build-time-baking behavior, so the PRD's "must
  not be baked during build time" constraint is trivially satisfied rather
  than needing special handling.

## Private game password UX

PRD: private games are visible to all users but password-protected; only
game admin can set/change it; password stored as hash in game account data.

Resolved by the ticket 007 spec
([openspec/changes/private-games/](../../openspec/changes/private-games/)).
Do not treat these as open:

- Changing a private game's password only gates new joins. Players already
  in the game stay in, and there is no extra confirmation. The admin does
  not re-enter the old password.
- Game passwords reuse ticket 003: Node `crypto.scrypt` (N=16384, r=8, p=1),
  a new 16-byte salt, a 64-byte hash, and `validatePassword` (8–20, the
  charset in `apps/frontend/src/lib/password-rules.ts`). The Next.js server
  hashes; the account stores the salt and the hash, not the plaintext.
- Login session mechanics are ticket 003's cookie session. Joining checks
  the game password once per join attempt and does not start a second session.

Visibility after creation is also settled there: public vs private is chosen
on create and is not switched later. A reviewer who wants a later switch
should say so on the spec PR; the account fields do not preclude it.

## Deposit / mint conversion

Game Token Module: admin manually mints/airdrops tokens when a player
deposits offline cash. Not yet discussed:

- Is there any fixed or configurable conversion rate (e.g. 1 token = 1
  currency unit), or is the minted amount always an arbitrary admin-entered
  number with no on-chain rate concept? (Working assumption from the
  session: admin-discretionary amount, no on-chain FX rate — same spirit as
  Mode 3's admin-discretionary payouts — but not explicitly confirmed.)

## Numeric caps still needing concrete values

Several bounded-collection caps were agreed on in principle but not given
exact numbers — needed before the account `InitSpace` layouts can be
finalized:

- `MAX_ACTIVE_GAMES` (global registry — Q4)
- `MAX_POTS_PER_ROUND` (poker side-pot list — Q6/Q7; upper bound is
  naturally `MAX_PLAYER_PER_GAME - 1`, but worth setting explicitly)
- Any per-transaction chunking limit for client-composed multi-recipient
  transfers (Q14) — client-side only, not an on-chain cap, but the exact
  "how many single-recipient instructions fit in one transaction" number
  needs calculating against Solana's tx size limit.

`MAX_PLAYER_PER_GAME` itself is already fixed at 20 by the PRD.

## CI devnet-deploy signing key provisioning

CircleCI's devnet-deploy job (ticket 004) needs a signing keypair to deploy
the program to devnet. This is distinct from a self-hoster's own runtime
system admin wallet (already covered: env-configured, self-hoster's choice)
— this is the project's *own* CI secret. Not yet discussed:

- How is that keypair provisioned to CircleCI (CircleCI encrypted env var /
  contexts vs. an external secrets manager)?
- Is it the same keypair used for local/manual devnet testing, or a
  dedicated CI-only key?
