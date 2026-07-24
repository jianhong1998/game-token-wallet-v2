# 003 — User registration & login — Design

Spec for [docs/tickets/003-user-registration-login.md](../../tickets/003-user-registration-login.md). Blocked by tickets 001 and 017 (both done). Builds on architecture decision Q1 ([002-architecture-decisions.md](../../technical-related/architecture/002-architecture-decisions.md)), which fixed the custodial model (password is a stored hash for login gating only, not a signing secret) and the `User` PDA seed convention (`["user", username, system_admin_pubkey]`). Resolves the hashing-algorithm and session-mechanics items left open in [002-pending-discussion.md](../../business-related/002-pending-discussion.md), plus several username/charset questions that surfaced once Chinese-language usernames came up during grilling.

This is the first ticket to add a custom on-chain error type (`errors.rs`, deferred by ticket 002 as unneeded at the time) and the first ticket to introduce a stateless session mechanism to the frontend.

---

## Grill session — decisions

### Q1: Username charset and case-sensitivity

**Answer:** Unicode letters, digits, and space — no other symbols. Case-folded to lowercase for matching/PDA derivation.

**Decision:** Username is normalized as `input.normalize("NFC").toLowerCase().normalize("NFC")` before any validation or PDA derivation. The second NFC pass exists because `toLowerCase()` can *decompose* certain characters (e.g. Turkish `İ`, U+0130, lowercases to a two-codepoint sequence under JS's locale-independent default mapping) — re-composing keeps the byte representation as consistent as practical. Plain `.toLowerCase()` is used deliberately, never `.toLocaleLowerCase()`, since locale-dependent casing would make PDA derivation depend on server locale/ICU version — unacceptable for something that determines a wallet address. CJK characters have no case concept, so case-folding is a no-op for them and this doesn't affect Chinese usernames.

Charset is validated via `/^[\p{L}\p{N} ]+$/u` (Unicode letter, Unicode number, or space) applied to the *normalized* string.

**Reason:** The product's audience is majority Malaysia/Singapore (per PRD NFR), where Chinese usernames are a real, not hypothetical, requirement. Byte-length validation must happen after normalization (not before), since case-folding can change byte length — validating before would let a borderline-length input pass client-side checks and then fail server/on-chain, a confusing UX gap.

### Q2: Username min/max length

**Answer:** 3–32 UTF-8 bytes.

**Decision:** `MIN_USERNAME_BYTES = 3`, `MAX_USERNAME_BYTES = 32`. The upper bound is Solana's hard per-seed cap (`find_program_address` seeds are capped at 32 bytes each) — not a stylistic choice, the username *is* a raw PDA seed component (architecture Q1/Q17), so there's no headroom to spare. The lower bound blocks single/double-character squatting and unreadable player-list entries while still allowing a single 3-byte CJK character.

**Reason:** Byte length (not character count) is what Solana's seed limit constrains — a 32-character Latin username and an ~10-character CJK username both hit the same 32-byte ceiling.

### Q3: Should `username` be stored as a field on the `User` account, in addition to being the PDA seed?

**Answer:** Yes.

**Decision:** `User.username: String` (`#[max_len(32)]`) is stored alongside the hash fields.

**Reason:** PDA derivation is one-way — given a player's pubkey (which is what later tickets like 006/009 will reference in game player lists and transfer UIs), there's no way to recover a display name without either storing it on the account or maintaining an off-chain reverse index. This project has explicitly no off-chain database (`003-TECH-STACK.md`), so the only place this can live is on the account itself. Deferring this would mean an account migration once ticket 006/009 actually need it.

### Q4: Password hashing algorithm

**Answer:** scrypt via Node's built-in `crypto` module.

**Decision:** `crypto.scrypt(password, salt, 64)` with Node's own defaults (`N=16384, r=8, p=1` — RFC 7914's interactive-login recommendation). Zero new dependencies. Output is a raw 64-byte `Buffer`, fully fixed-size, stored directly in a `[u8; 64]` on-chain field.

**Reason:** Solana account data is public — anyone with RPC access can read a `User` account's stored hash directly, no breach required, unlike a normal backend DB where a weak hash only matters after a leak. This raises the stakes enough to rule out a fast hash (plain SHA-256+salt, one of the candidates left open in the pending-discussion doc) but scrypt and argon2id both clear that bar; the deciding factor was zero new dependencies / no Docker build complexity versus argon2id's native-binding dependency. (Argon2 was confirmed capable of the same fixed-size output via its `raw: true` mode — the earlier assumption that only scrypt could do this was wrong and corrected during grilling — but the dependency-footprint tradeoff still favored scrypt here.)

### Q5: Salt strategy

**Answer:** Fresh cryptographically-random 16-byte salt per user, generated at registration, stored as a plain (non-secret) on-chain field.

**Decision:** `crypto.randomBytes(16)` per registration. Explicitly rejected: reusing the system admin secret key as a shared salt.

**Reason:** A salt's job is per-user uniqueness, not secrecy. A shared salt (the admin key) would mean any two users with the same password get an identical, publicly-readable hash — completely defeating the point of salting, visible to anyone reading on-chain data. It would also couple password-hash security to the admin wallet's key lifecycle (a future key rotation would orphan every stored hash; a key leak — already a total-compromise event — would additionally hand over a ready-made cross-account cracking shortcut). A random per-user salt costs nothing extra to generate and avoids all of this.

### Q6: Session mechanism implementation

**Answer:** Hand-rolled HMAC-signed HTTP-only cookie via Web Crypto (`crypto.subtle`), not a library.

**Decision:** Cookie payload `{ username, exp }` (base64url JSON), signed with HMAC-SHA256 using a new required `SESSION_SECRET` env var. Verified via `crypto.subtle.verify` (constant-time). Web Crypto (not `node:crypto`) is used specifically so the same code works whether `middleware.ts` runs on the Edge or Node.js runtime.

**Reason:** This project already has zero off-chain persistence — a stateless signed cookie fits that philosophy directly. HMAC-signing a cookie is a well-understood minimal primitive, not "rolling your own crypto" in the risky sense (no custom cipher design, no key exchange) — a small, auditable amount of code beats adding a dependency for something this contained.

### Q7: Session lifetime

**Answer:** 7 days, fixed.

**Decision:** `exp = now + 7 days` embedded in the signed payload; no server-side revocation (stateless, nothing to revoke against). Expired cookies are rejected by `verifySessionCookie` returning `null`.

**Reason:** Balances "don't nag a casual, infrequently-used social app" against not leaving an effectively-permanent credential in a cookie.

### Q8: Session enforcement point

**Answer:** Both `middleware.ts` (page-level gating) and independent per-Server-Action re-verification.

**Decision:** `middleware.ts` redirects unauthenticated requests away from any route not explicitly excluded (`/login`, `/register`, `/admin/*`, static assets). Every session-requiring Server Action additionally calls `verifySessionCookie` itself before doing anything.

**Reason:** Mirrors the three-layer defense-in-depth pattern already established for username/password input validation (browser → server → on-chain as final gate) — a future route or action added without updating the middleware matcher still can't bypass auth, since the action re-checks independently.

### Q9: Logout

**Answer:** In scope for this ticket.

**Decision:** `logoutUser()` Server Action clears the session cookie, wired to a button on the new `(app)/home` page.

**Reason:** Shipping a session mechanism with literally no way to end a session is an awkward gap, even though the ticket's checklist doesn't spell it out explicitly. The addition is small given the session mechanism already has to exist.

### Q10: Login timing side-channel

**Answer:** Close it — always run the password-hash computation even when the username doesn't exist.

**Decision:** When `loginUser` doesn't find a `User` account, it still runs `verifyPassword` against a fixed `DUMMY_SALT` constant before returning the generic error, so response time doesn't depend on whether the account exists.

**Reason:** The ticket already requires that a failed login never reveal username existence. Skipping the hash for nonexistent usernames (the naive implementation) would create a measurable, statistically-averagable timing gap that defeats that exact requirement. The fix is ~5 lines.

### Q11: Login rate-limiting / brute-force lockout

**Answer:** Out of scope for this ticket, explicitly deferred.

**Decision:** No attempt-count tracking is added. Documented here as a known deferred item (same treatment as other open items in `002-pending-discussion.md`), not silently dropped.

**Reason:** scrypt's inherent per-attempt cost already imposes real friction. Building attempt-tracking would need a new stateful component (in-memory only — doesn't survive restarts, doesn't coordinate across instances) for a self-hosted, friend-group threat model that this project already treats as "accepted, low-stakes" elsewhere (architecture Q15–17).

### Q12: Exact password character set

**Answer:** `A-Za-z0-9` plus `` !@#$%^&*()_+-=[]{}|;:,.<>? ``.

**Decision:** Regex `/^[A-Za-z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/` combined with the PRD's 8–20 character length bound. Applied identically client-side and server-side (never reaches the chain — only the hash does).

**Reason:** The PRD's "alphanumeric + basic English symbols (e.g. ..., etc.)" wording needed an exhaustive, unambiguous set for a regex used in two places; this set covers all the PRD's literal examples plus the common symbols a password manager would generate.

### Q13: Does this ticket change `/admin/registry`'s access control?

**Answer:** No, left untouched.

**Decision:** Ticket 002's design doc noted "real access control arrives with ticket 003," but that forward reference doesn't map cleanly onto what actually got designed — there is no "operator/admin" role anywhere in the architecture, only player accounts. `/admin/registry` is excluded from `middleware.ts`'s auth matcher, same as it is today.

**Reason:** Gating an operator-only bootstrap page behind ordinary player login would restrict it to "anyone who registered," not to "the operator" — not a meaningful improvement, and a semantically wrong fit for what a player session actually represents. Real operator-level access control (if ever wanted) is a separate future decision.

---

## Design

### On-chain program (`apps/on-chain-program`)

**New `state/user.rs`:**

```rust
use anchor_lang::prelude::*;

pub const MIN_USERNAME_BYTES: usize = 3;
pub const MAX_USERNAME_BYTES: usize = 32;
pub const SALT_BYTES: usize = 16;
pub const PASSWORD_HASH_BYTES: usize = 64;

#[account]
#[derive(InitSpace)]
pub struct User {
    pub bump: u8,
    #[max_len(MAX_USERNAME_BYTES)]
    pub username: String,
    pub salt: [u8; SALT_BYTES],
    pub password_hash: [u8; PASSWORD_HASH_BYTES],
}
```

**New `errors.rs`** (first custom error type in the repo):

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Username must be between 3 and 32 bytes")]
    InvalidUsernameLength,
}
```

**New `instructions/user/create_user.rs`:**

- Accounts: `admin: Signer` (payer, system admin wallet — same role as `InitializeRegistry`'s `admin`), `user: Account<User>` with `init, payer = admin, space = 8 + User::INIT_SPACE, seeds = [b"user", username.as_bytes(), admin.key().as_ref()], bump`, `system_program: Program<System>`.
- Instruction args (via `#[instruction(username: String, salt: [u8; 16], password_hash: [u8; 64])]`): `username`, `salt`, `password_hash`.
- Handler: `require!` the username's UTF-8 byte length is within `MIN_USERNAME_BYTES..=MAX_USERNAME_BYTES` (`ErrorCode::InvalidUsernameLength` otherwise — final on-chain gate, after client and Server Action have already normalized/validated), then sets all four fields and `bump`.
- A duplicate username on the same admin fails for free via Anchor's `init` ("already in use"), exactly like `InitializeRegistry`'s duplicate-init case — no custom duplicate check needed.

No on-chain `login` instruction exists — login is a pure off-chain read (fetch `User`) + off-chain compare, per architecture Q1.

### Off-chain crypto & session utilities (`apps/frontend/src/server`)

**`server/username.ts`:**
- `normalizeUsername(input: string): string` — `input.normalize("NFC").toLowerCase().normalize("NFC")`.
- `validateUsername(normalized: string): { valid: true } | { valid: false; reason: string }` — byte length 3–32, charset `/^[\p{L}\p{N} ]+$/u`.

**`server/password-rules.ts`:**
- `validatePassword(password: string): { valid: true } | { valid: false; reason: string }` — length 8–20, charset `/^[A-Za-z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/`.

**`server/password.ts`:**
- `hashPassword(password: string): Promise<{ salt: Uint8Array; hash: Uint8Array }>` — random 16-byte salt, `crypto.scrypt(password, salt, 64)`.
- `verifyPassword(password: string, salt: Uint8Array, expectedHash: Uint8Array): Promise<boolean>` — recompute + `crypto.timingSafeEqual`.
- `DUMMY_SALT: Uint8Array` — fixed 16-byte constant used by `loginUser` when no account is found (Q10).

**`server/session.ts`:**
- `createSessionCookie(username: string): Promise<string>` — payload `{ username, exp }` (7 days out), base64url JSON, HMAC-SHA256 signed via `crypto.subtle` using `SESSION_SECRET`.
- `verifySessionCookie(cookie: string): Promise<{ username: string } | null>` — verifies signature + `exp`, returns `null` (never throws) on any failure.
- Cookie name `session`, attributes `httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure` conditional on request protocol.

**`server/env.ts`:** new `loadSessionEnv(): { sessionSecret: string }`, reading `SESSION_SECRET` via the existing `readRequiredEnvVar` helper. Added to `apps/frontend/.env.template` and `docker/deployment/.env.template`.

### Frontend (`apps/frontend`)

**`server/actions/auth.ts`:**
- `registerUser({ username, password, confirmPassword }): Promise<void>` — re-validates everything server-side, checks `password === confirmPassword`, hashes password, derives `User` PDA, sends `create_user`, sets session cookie. Maps Anchor's "already in use" to `"Username already taken"`.
- `loginUser({ username, password }): Promise<void>` — normalizes username, fetches `User`; not-found path still runs `verifyPassword` against `DUMMY_SALT` (Q10) then throws `"Invalid username or password"`; found path does the real compare, same generic error on mismatch, sets session cookie on success.
- `logoutUser(): Promise<void>` — clears the session cookie.
- `getCurrentUsername(): Promise<string | null>` — reads + verifies the session cookie.

**Pages:**
- `app/(auth)/register/page.tsx` — username/password/confirm-password form (client-side validation reusing `normalizeUsername`/`validateUsername`/`validatePassword`), submits to `registerUser`, redirects to `/home`.
- `app/(auth)/login/page.tsx` — username/password form, submits to `loginUser`, redirects to `/home`, generic error `Alert` on failure.
- `app/(app)/home/page.tsx` — new minimal authenticated landing page: "Welcome, {username}" + logout button. Serves as this ticket's proof surface for session gating, the same role `/admin/registry` played for ticket 002.

**`middleware.ts`** (new): matcher excludes `/login`, `/register`, `/admin/*`, static assets; everything else requires a valid session cookie or redirects to `/login`.

### Testing

- `cargo test`: `User::INIT_SPACE` sizing guard (same pattern as `Registry`'s test).
- `on-chain-program-e2e` (`anchor test`): `create_user` happy path; duplicate username on same admin rejected cleanly; username below/above byte bounds rejected with `InvalidUsernameLength`.
- Frontend vitest (colocated): `username.test.ts` (normalization pipeline incl. CJK no-op, İ-expansion edge case, exact-32-byte boundary), `password-rules.test.ts` (happy path + 2 edge cases), `password.test.ts` (hash/verify roundtrip, wrong password fails, dummy-salt path), `session.test.ts` (roundtrip, tampered payload rejected, expired rejected), `actions/auth.test.ts` (register happy/duplicate, login happy/wrong-password/nonexistent-username with identical generic error), `middleware.test.ts` (valid session passes, missing/expired/tampered redirects, excluded paths pass through ungated).
- `apps/e2e` Playwright: register → `/home` → shows username; logout → gated again; login correct → `/home`; login wrong password → generic error; visiting `/home` unauthenticated → redirected to `/login`.
- Manual verification against the local docker-compose/Surfpool stack before marking done, per this repo's Done-Means rule.

---

## Self-review

- No placeholders/TBDs remain — hashing algorithm, salt strategy, session mechanism/TTL/enforcement, username charset/bounds/case-folding, password charset, logout scope, rate-limiting scope, timing-side-channel handling, and `/admin/registry`'s (non-)treatment are all concrete decisions with stated reasoning.
- Internally consistent: the "store username on the account" decision (Q3) and the "no off-chain database" architecture constraint are checked against each other and agree — nothing here silently assumes an index that doesn't exist.
- Scope: single ticket — on-chain `User` account + `create_user` instruction, off-chain hashing/session utilities, register/login/logout flows, and route gating. Does not reach into game-membership tracking, password reset, or admin-role auth — correctly left for later/undecided.
- No requirement reads two ways: the ticket's "does not reveal whether the username exists" is now explicitly split into the response-content guarantee (identical generic message) and the response-timing guarantee (dummy hash on the not-found path) — closing the ambiguity a naive reading would have missed.
