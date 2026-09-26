---
name: writing-test
description: >
  Plan, write, review, and extend unit, integration, and E2E tests in any project, using the test
  framework and conventions the project already has (e.g. pytest for Python, vitest or jest for
  TypeScript/JavaScript, Playwright for browser E2E). Decides which behaviors of a feature belong in
  which tier, which edge cases to cover, and what not to test. Use whenever the user asks to write a
  test, add test coverage, plan tests for a feature, test a route/service/module/component, set up a
  fixture, write a browser test for a page flow, fix a flaky test, or review test coverage — even if
  they don't say "unit" or "integration" explicitly.
triggers:
  - 'write a test for'
  - 'add test coverage for'
  - 'plan tests for'
  - 'write a unit test'
  - 'write an integration test'
  - 'write an E2E test'
  - 'write a Playwright test'
  - 'set up a fixture'
  - 'this test is flaky'
  - 'review test coverage'
---

## Overview

Before writing any test code, always:

1. Detect the stack and the project's existing test conventions (Step 0)
2. Split the feature into behaviors and assign each to a tier (Step 1)
3. State one sentence of justification per tier choice
4. Read the reference file for each tier involved (Step 2)

**Project conventions win.** Everything here is a default. If the project already does it differently
(naming, location, fixtures, markers, run commands), follow the project.

## Non-Goals

- Performance / load testing
- Security testing
- Visual regression testing
- Teaching framework APIs — read the project's existing tests and the framework docs for that

---

## Step 0: Detect stack and conventions

### 0a. Find the framework

| Signal in repo                                                     | Framework          | Tier separation (default)                      |
| ------------------------------------------------------------------ | ------------------ | ---------------------------------------------- |
| `pyproject.toml` / `requirements*.txt` / `setup.cfg` with `pytest` | pytest             | `integration` marker; `-m "not integration"`   |
| `package.json` has `vitest`, or `vitest.config.*`                  | vitest             | `*.integration.test.ts` + separate project     |
| `package.json` has `jest`, or `jest.config.*`                      | jest               | `*.integration.test.ts` + separate project     |
| `package.json` has `@playwright/test`, or `playwright.config.*`    | Playwright (E2E)   | own `testDir`                                  |

Monorepo: the nearest manifest to the code under test decides.

### 0b. Read what already exists

- 1–2 existing tests of the same tier near the code under test — copy their style
- Shared setup: `conftest.py`, vitest/jest `setupFiles` / `globalSetup`, Playwright fixtures/config
- Testing docs: `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/**/test*`
- Run commands: `justfile`, `Makefile`, `package.json` scripts, CI workflows

Reuse existing fixtures, factories, and helpers. Put new shared ones where the project keeps them, never inside a single test file.

### 0c. No test setup yet?

Do NOT install anything silently. Propose a default and ask the user first:

| Language              | Default proposal                                  |
| --------------------- | ------------------------------------------------- |
| Python                | pytest (+ pytest-mock)                            |
| TypeScript/JavaScript | vitest (jest only if the project already uses it) |
| Browser E2E           | Playwright                                        |

---

## Step 1: Split the feature across tiers

### 1a. List behaviors, not functions

Write the feature as observable behaviors: _"given X, when Y, then Z"_. Include the failure paths.
Each behavior gets tested **once, at the lowest tier that can prove it**. Higher tiers do not re-test what lower tiers already proved.

### 1b. Assign each behavior a tier

Stop at the first row that matches.

| The behavior can only be proven by…                                                              | Tier            |
| ------------------------------------------------------------------------------------------------ | --------------- |
| A real user in a real browser against the running system (critical journey, cross-page flow)     | **E2E**         |
| Crossing a real boundary you own: HTTP through the app's router, real DB, filesystem, queue      | **Integration** |
| Running the logic with its dependencies replaced — rules, calculations, branching, mapping       | **Unit**        |

> **Nuance**: needing framework context (Flask app context, a component rendered in jsdom, a DI
> container) does NOT make a test integration. Only crossing a real I/O boundary does.

State it: _"This is a [tier] test because [one sentence]."_

### 1c. Expected shape

| Feature part                                       | Typical tier    | Typical count          |
| -------------------------------------------------- | --------------- | ---------------------- |
| Business rules, validation, calculations, parsing  | Unit            | Many — every edge case |
| Endpoint contract, persistence, auth/permission wiring, transactions | Integration | One per contract + key failure modes |
| Critical user journey (happy path + the one failure users actually hit) | E2E | Few — 1–3 per feature |

If the plan has more E2E tests than integration tests, or integration tests enumerating validation cases, the boundaries are wrong — push cases down.

---

## Step 2: Read the reference file for each tier

| Tier        | Reference file              |
| ----------- | --------------------------- |
| Unit        | `references/unit.md`        |
| Integration | `references/integration.md` |
| E2E         | `references/e2e.md`         |

Each covers: what belongs in the tier, what does not, edge cases to design, and what not to do.

---

## Naming Conventions (defaults — project wins)

| Framework  | Unit               | Integration                    | E2E                                   |
| ---------- | ------------------ | ------------------------------ | ------------------------------------- |
| pytest     | `test_<module>.py` | same, marked `integration`     | —                                     |
| vitest     | `<module>.test.ts` | `<module>.integration.test.ts` | —                                     |
| jest       | `<module>.test.ts` | `<module>.integration.test.ts` | —                                     |
| Playwright | —                  | —                              | `<feature>.spec.ts` in `testDir`      |

Group related cases (`class TestX` / `describe('X')`). Test names state the behavior: `test_expired_token_is_rejected` / `it('rejects an expired token')`.

---

## Completion Criterion

A test is done only when ALL hold:

1. **Runs and passes locally**: run it with the project's command and see it pass
2. **Fails when the behavior breaks**: break the line being tested and the test must fail, then restore
3. **Lives at the right tier**: not duplicated at a higher tier, and not needing a higher tier to be meaningful
4. **Follows project conventions**: naming, location, markers, and shared fixtures match existing tests
