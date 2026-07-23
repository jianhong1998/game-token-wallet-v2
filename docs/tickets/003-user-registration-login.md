# 003 — User registration & login

**What to build:** A new user can register with a username and password, and log back in — the custodial account model from [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q1 (password is a stored hash for login gating only, not a signing secret).

**Blocked by:** 001, 017

**Status:** ready-for-agent

- [ ] `create_user` instruction creates a `User` PDA (seeded by username + system admin pubkey, matching V1's existing seed convention) storing a hashed password field; a duplicate username is rejected by construction (PDA collision).
- [ ] Password validation (8–20 chars, alphanumeric + basic English symbols) is enforced both in the form and in the Server Action before any on-chain call is made.
- [ ] Registration flow: username + password + confirm-password form, submits, creates the on-chain account, and logs the new user in.
- [ ] Login flow: fetches the `User` PDA by derived address, compares the submitted password's hash against the stored hash off-chain, and establishes a session on success.
- [ ] Failed login shows a single generic "invalid credentials" message — does not reveal whether the username exists.
- [ ] Session persists across page loads and gates access to authenticated pages/actions.
