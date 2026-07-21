# Task 8 Log: `apps/e2e` skeleton — Playwright `noop` round trip

## Task Context

### Plan Section
## Task 8: `apps/e2e` skeleton — Playwright `noop` round trip

**Files:**
- Create: `apps/e2e/package.json`
- Create: `apps/e2e/playwright.config.ts`
- Create: `apps/e2e/tests/noop.spec.ts`

**Interfaces:**
- Consumes: the running frontend's `/` page from Task 7 (via HTTP, not import — no code dependency).
- Produces: nothing later tasks import directly; Task 9 (`docker compose up`) and Task 10 (CI) are how this suite actually runs against a live stack.

- [ ] **Step 1: Create the package manifest**

`apps/e2e/package.json`:
```json
{
  "name": "e2e",
  "private": true,
  "scripts": {
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0"
  }
}
```

- [ ] **Step 2: Install and download browsers**

Run:
```bash
pnpm add -D @playwright/test --filter e2e
pnpm --filter e2e exec playwright install --with-deps chromium
```

- [ ] **Step 3: Create the Playwright config**

`apps/e2e/playwright.config.ts`:
```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  },
});
```

- [ ] **Step 4: Write the round-trip test**

`apps/e2e/tests/noop.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";

test("home page proves the connection utility plumbing works end-to-end", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Send noop transaction" }).click();
  await expect(page.getByTestId("noop-signature")).toBeVisible({ timeout: 30_000 });

  const signature = await page.getByTestId("noop-signature").textContent();
  expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
});
```

- [ ] **Step 5: Note — this test cannot pass in isolation yet**

There is no running frontend + deployed program for it to hit. Task 9 stands up that stack locally; run `pnpm --filter e2e run test` again after Task 9 to get a real PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e
git commit -m "test: add e2e Playwright skeleton with noop round-trip test"
```

### Acceptance Criteria
- AC-1: `pnpm install` succeeds and links the new `e2e` package into the workspace.
- AC-2: Playwright + chromium install successfully via `pnpm --filter e2e exec playwright install --with-deps chromium`.
- AC-3: `apps/e2e/tests/noop.spec.ts` is syntactically valid TypeScript, targets button name "Send noop transaction" and `data-testid="noop-signature"`, and imports cleanly (no import errors).
- AC-4 (explicit non-goal for this task): the test does NOT need to pass end-to-end here — no live frontend/program stack exists yet. Real execution happens after Task 9 (docker-compose local dev loop).

## Attempt 1 — 2026-07-21T11:34:50Z

### Implementation Plan
- Create `apps/e2e/package.json` verbatim per plan Step 1
- `pnpm add -D @playwright/test --filter e2e` then `pnpm --filter e2e exec playwright install --with-deps chromium` (Step 2)
- Create `apps/e2e/playwright.config.ts` verbatim per plan Step 3
- Create `apps/e2e/tests/noop.spec.ts` verbatim per plan Step 4
- Skip Step 5 (explicit no-op — no live stack to run against; deferred to Task 9)
- Verify via `pnpm --filter e2e exec playwright test --list` and `pnpm install`, then commit per Step 6

### Files Changed
- created `apps/e2e/package.json` — e2e package manifest with `@playwright/test` devDependency
- created `apps/e2e/playwright.config.ts` — Playwright config, testDir `./tests`, baseURL from `E2E_BASE_URL` env or `http://localhost:3000`
- created `apps/e2e/tests/noop.spec.ts` — round-trip test clicking "Send noop transaction" and asserting `data-testid="noop-signature"` matches a base58 signature pattern
- modified `pnpm-lock.yaml` — lockfile update from `pnpm add -D @playwright/test --filter e2e` and `pnpm install`

### New Tests
- `home page proves the connection utility plumbing works end-to-end` (Playwright e2e test — not runnable in isolation this task; see Outcome)

### Key Decisions
- `pnpm add -D @playwright/test --filter e2e` resolved to `^1.61.1` instead of the plan's literal `^1.49.0` — pnpm always resolves to latest matching on `add`; kept the resolved version rather than hand-pinning to stale `^1.49.0`, since the plan's version was illustrative and the workspace already pins pnpm/toolchain elsewhere.
- Did not add `@types/node` to `apps/e2e` even though a raw `tsc` sanity check flagged `process.env` (TS2580). The plan's package.json intentionally omits `@types/node`, and CLAUDE.md requires flagging any new dependency before adding — out of scope for this task. `playwright test --list` (which transpiles and loads the actual test file) succeeded cleanly, which is sufficient proof of syntactic validity and import correctness per the task's own verification guidance.
- Step 5 deliberately skipped per orchestrator instruction: no `pnpm --filter frontend run dev` was started; this test cannot pass in isolation and is out of scope until Task 9 stands up docker-compose.

### Lint Output
n/a — no lint script wired for `apps/e2e` in this task; not part of AC

### Test Output
PASS (syntactic/discovery check only, not a real run)
`pnpm --filter e2e exec playwright test --list` → "Listing tests: noop.spec.ts:3:5 › home page proves the connection utility plumbing works end-to-end / Total: 1 test in 1 file"
Actual e2e execution against a live stack is explicitly out of scope for Task 8 (see plan Step 5) — deferred to after Task 9.

### Commit
`5e3c9dc`

### Outcome: success
