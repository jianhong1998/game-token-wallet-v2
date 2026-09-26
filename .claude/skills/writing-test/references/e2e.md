# E2E Test Reference

**Boundary**: a real browser against the fully running system (frontend + backend + DB, third parties sandboxed). Tests what a user does and sees. Slowest and most brittle tier, so keep it small.

---

## What belongs here

- **Critical user journeys**: the flows that, if broken, mean the feature is broken (sign in → do main task → see result)
- **Cross-page / cross-system wiring** no lower tier can see: redirects, session carried across pages, frontend calling the right backend
- **The one failure path users realistically hit** per journey (e.g. invalid login shows an error), not every failure
- **Role-visible differences** when they drive the journey (admin sees the action, user doesn't), one case each

## What does NOT belong here, and where it goes

| Behavior                                          | Goes to     |
| ------------------------------------------------- | ----------- |
| Validation rules, each error message              | Unit        |
| API status codes, permissions matrix, persistence | Integration |
| Component states (loading, empty, disabled)       | Unit (component test) |
| Pixel/layout correctness                          | Out of scope (visual regression) |

Rule of thumb: **1–3 E2E tests per feature.** If you're writing more, most of them belong in a lower tier.

---

## Setting up the boundary

- **Use the project's E2E fixtures** for login, user creation, and base URL. Import `test` from the project's fixtures module if it extends the framework's, not from the framework directly.
- **Each suite creates its own users/data and cleans them up** (in `beforeAll`/`afterAll` or an auto-cleanup fixture). Never depend on data created by hand or by another suite.
- **Seed through the API or DB helpers, not through the UI.** Only the behavior under test goes through the browser.
- **Know how the stack is started** (compose/`just`/`make` target, `webServer` in the config) and whether CI runs it headless.

---

## Designing cases

For each journey, write:

1. **Happy path**: the user reaches the goal and the resulting state is visible (not just "no error")
2. **Primary failure**: the most likely user mistake or permission denial, with a visible message
3. **Persistence check** (if relevant): reload or re-navigate, and the result is still there

Skip combinatorial input cases. Those are unit tests.

---

## What NOT to do

- **Don't use fixed sleeps** (`waitForTimeout`). Use auto-waiting assertions (`expect(locator).toBeVisible()`, `toHaveURL`).
- **Don't use brittle selectors** (deep CSS paths, nth-child, generated class names). Prefer role + accessible name, then label/text, then `data-testid` if the project uses them.
- **Don't share state between tests** (same user mutated by several tests, order-dependent steps). Each test must pass alone.
- **Don't log in through the UI in every test** if the project has a session/storage-state fixture. UI login is tested once.
- **Don't assert on implementation details** (API call counts, internal state, exact CSS). Assert on what the user sees.
- **Don't hit real third-party services.** Use the project's sandbox/stub (e.g. auth sandbox, payment test mode).
- **Don't hard-code environment URLs or credentials.** Use config/env (`baseURL`, `process.env`).
- **Don't retry to hide flakiness.** A test that passes only on retry is broken. Find the race (missing wait, shared data, animation) and fix it.
- **Don't duplicate lower-tier coverage.** If a unit or integration test proves it, E2E doesn't re-check it.
