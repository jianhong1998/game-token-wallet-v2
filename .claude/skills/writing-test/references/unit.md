# Unit Test Reference

**Boundary**: one unit of logic with every I/O dependency replaced. No network, DB, filesystem, real clock, or randomness. Milliseconds per test.

---

## What belongs here

- Business rules and decisions: every branch of an `if`/`match`, every permission/role outcome
- Calculations, parsing, formatting, mapping, serialization
- Input validation: each rule and each boundary value
- Error handling: what the unit does when a dependency fails (raises, times out, returns empty)
- State transitions: allowed and disallowed moves
- Component rendering logic (given props/state, renders X), with network mocked

## What does NOT belong here, and where it goes

| Behavior                                                  | Goes to                         |
| --------------------------------------------------------- | ------------------------------- |
| Whether the SQL/ORM query returns the right rows          | Integration (mocking the query proves nothing) |
| Whether the route is wired, auth middleware applies       | Integration                     |
| Whether the migration or DB constraint works              | Integration                     |
| Whether a user can complete the flow in the browser       | E2E                             |
| Framework/library internals (does the ORM save? does React re-render?) | Nowhere. Trust the library |

---

## Designing edge cases

Go through each input and each dependency:

| Category          | Cases to consider                                                                 |
| ----------------- | --------------------------------------------------------------------------------- |
| Boundaries        | min, max, min−1, max+1, exactly-at-threshold (`>=` vs `>` bugs live here)        |
| Empty / missing   | `None`/`null`/`undefined`, `""`, `[]`, `{}`, missing key, whitespace-only         |
| Size              | zero items, one item, many items; duplicates                                      |
| Type / format     | wrong type if not statically guaranteed; malformed string; unicode; case sensitivity |
| Numbers           | 0, negative, float rounding, very large, currency precision                       |
| Time              | timezone edges, DST, month/year end, leap day, expiry exactly at `now`            |
| Dependency result | success, empty result, error/exception, timeout, partial data                     |
| State             | each allowed transition; each forbidden one is rejected                           |

Only write the cases the code can actually meet. If a type system or an upstream validator already rules an input out, don't test it again here.

---

## What NOT to do

- **Don't mock the unit under test** or its private helpers. Mock only at the I/O edge (DB client, HTTP client, clock, RNG).
- **Don't patch where a symbol is defined.** Patch where it is looked up (`app.service.requests`, not `requests`).
- **Don't build deep mock chains** (`a.return_value.b.return_value.c...`). That's a sign the code needs a seam. Pass the dependency in, or test it at integration.
- **Don't assert only on mock calls** when there is a return value or state to check. "Was called with" is the assertion only when the call *is* the behavior (e.g. "sends the email").
- **Don't mirror the implementation.** Recomputing the expected value with the same formula proves nothing. Use literal expected values.
- **Don't test private functions directly** if a public one covers them. Test through the public API.
- **Don't use real `now()`, random values, or sleeps.** Freeze or inject them.
- **Don't share mutable state between tests.** Each test must pass alone and in any order.
- **Don't put many behaviors in one test.** One reason to fail per test. Parametrize repeated input→output cases instead of copy-pasting.
- **Don't write tests for trivial code** (getters, pass-through wrappers, constants). They add maintenance cost and catch nothing.
- **Don't chase coverage %.** An uncovered line matters only if a behavior depends on it.
