# Integration Test Reference

**Boundary**: real boundaries the project owns: HTTP through the app's router/middleware, real DB (with real schema/migrations), filesystem, queue, cache. Third-party services you don't own (payment, email, external APIs) are stubbed **at the network layer**.

---

## What belongs here

- **Contract of each endpoint/handler**: status code, response shape, headers for the happy path
- **Persistence**: data written can be read back; queries return the right rows (filters, ordering, pagination, soft-delete)
- **DB-enforced rules**: unique constraints, FKs, cascades, transactions rolling back on failure
- **Wiring**: auth required (401), permission denied (403), CSRF/validation middleware applies, not-found (404)
- **One representative validation failure** per endpoint (proves errors are mapped to 4xx). The full rule set is unit-tested.
- **Side effects crossing a boundary**: job enqueued, file written, cache invalidated, outbound call made with the right payload (to a stub)
- **Concurrency/idempotency** where it matters: double submit, retry of the same request

## What does NOT belong here, and where it goes

| Behavior                                                   | Goes to |
| ---------------------------------------------------------- | ------- |
| Every validation rule / boundary value                     | Unit    |
| Calculation/branching logic reachable without I/O          | Unit    |
| UI rendering, navigation, what the user sees               | E2E     |
| Real third-party API behavior                              | Nowhere in CI. Contract-test the stub, or run a separate smoke check |

---

## Setting up the boundary

- **Test DB is dedicated and disposable.** Never a shared, dev, or prod DB. Find how the project starts it (docker compose, `just`/`make` target, testcontainers).
- **Pick one isolation strategy** and reuse the project's helper:
  - *Transaction rollback per test*: fastest. It only works if the code under test uses the **same connection**. An HTTP handler on its own connection/session will NOT see uncommitted rows. This is a common source of "row not found" failures.
  - *Committed rows + teardown*: a factory tracks created ids and deletes children before parents. Works across connections.
  - *Truncate / fresh schema*: simplest and slowest. Use it when the others are impractical.
- **Each test creates the data it needs** through shared factories/fixtures. Don't rely on seed data or on rows left by another test.
- **Keep integration separate from unit runs** (marker, filename pattern, or separate project) so the unit suite stays fast.

---

## Designing edge cases

| Category        | Cases to consider                                                               |
| --------------- | ------------------------------------------------------------------------------- |
| Auth            | anonymous, wrong role, owner vs non-owner, cross-tenant access to another tenant's id |
| Existence       | resource missing, already deleted, id of a different type                       |
| Uniqueness      | create a duplicate; case/whitespace variants of a unique key                    |
| Transactions    | failure midway leaves no partial writes                                         |
| Query shape     | empty result, one, many; pagination last page / beyond last page; filter + sort combined |
| Idempotency     | same request twice; concurrent updates (lost update / version conflict)         |
| External stub   | stub returns 5xx / timeout / malformed body, and the app degrades as designed   |

---

## What NOT to do

- **Don't mock your own code** (services, repositories) in an integration test. If it's mocked, it's a unit test with extra setup.
- **Don't re-test every validation rule over HTTP.** One case proves the wiring. The rest belong in unit tests.
- **Don't hit real third-party services.** They're flaky and slow, and may cost money or have side effects.
- **Don't depend on test order or leftover data.** Every test must pass alone, in any order, and in parallel if the runner does that.
- **Don't assert only the status code.** Also read back the persisted state or the response body that proves the behavior.
- **Don't assert on volatile fields** (generated ids, timestamps, ordering without `ORDER BY`). Assert on what's stable, or control it.
- **Don't `sleep` to wait for async work.** Poll with a timeout, or trigger the worker synchronously in tests.
- **Don't widen setup beyond need.** A test for one endpoint shouldn't seed the whole domain.
- **Don't leak state**: no data, env vars, config changes, or open connections left after the test.
