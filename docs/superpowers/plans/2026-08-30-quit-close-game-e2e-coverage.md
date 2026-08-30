# Quit-Game & Close-Game App-E2E Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the two real gaps in `apps/e2e/tests/` browser-level coverage for the quit-game and close-game features: `close-game` has zero app-e2e coverage at all, and the existing `quit-game.spec.ts` only exercises the zero-balance quit path and never checks that a departed player disappears from admin-facing pickers or the departed player's own dashboard.

**Architecture:** No app code changes — this is test-only. Both features are already fully implemented and covered at their own correct layers (on-chain Rust unit tests, `on-chain-program-e2e` integration tests, Server Action/component unit tests — see `openspec/changes/close-game/tasks.md` sections 1-6, all checked). `apps/e2e/` is the one remaining layer: real browser + real Next.js server + real deployed program (via `docker-compose.e2e.yml`), verifying the full user journey (button visibility, confirmation modal, redirect, and derived-listing state) that only exists when frontend and on-chain state are wired together. Per this repo's established convention (`quit-game.spec.ts`, `transfer.spec.ts`), each spec file is one heavy multi-context journey test rather than many small isolated tests — extend the existing quit-game journey in place rather than fragmenting it, and give close-game one new journey test of the same shape.

**Tech Stack:** Playwright (`@playwright/test` ^1.61.1) against a real Next.js server + Surfpool-deployed program, run via `docker-compose.e2e.yml`'s `e2e` service (or directly with `pnpm --filter e2e test` against `E2E_BASE_URL`).

**Spec:** `openspec/specs/quit-game/spec.md` (all requirements), `openspec/changes/close-game/specs/close-game/spec.md` (all requirements) — both already implemented; this plan only adds tests against them.

## Global Constraints

- Do not touch app code (`apps/frontend`, `apps/on-chain-program`, `apps/on-chain-client`) — both features are done; this plan is tests-only.
- Do not re-test what's already covered at a lower layer: admin-only rejection, non-member rejection, and burn-amount correctness are already proven by `on-chain-program-e2e` and Server Action unit tests (see `openspec/changes/close-game/tasks.md` §4/§5, `openspec/specs/quit-game/spec.md`'s equivalent ticket). App-e2e only needs to prove the UI journey and cross-layer derived state (listings, redirects) that no other test layer touches.
- `getByRole("button", { name: ... })` does substring, case-insensitive matching by default in Playwright — any name that is a substring of another visible button's name (e.g. `"Close"` inside `"Close game"`, `"Quit"` inside `"Quit game"`) must use `{ exact: true }`. Follow the existing convention in `quit-game.spec.ts` (`"Quit", { exact: true }`).
- Every game/username must stay unique per test run (`Date.now()`-suffixed) — the on-chain stack persists state across runs, so fixed names collide with leftovers from prior runs (existing convention in every spec file in this directory).
- Match existing file-level timeout conventions: this suite's default is 30_000ms per assertion / Playwright's default 30_000ms test timeout; `quit-game.spec.ts` already overrides both to 60_000/90_000 with a documented reason (heaviest test in the suite). Follow the same reasoning if a change here adds enough sequential on-chain round trips to need headroom under contention — don't bump timeouts speculatively.

---

## File Structure

Modified files:
- `apps/e2e/tests/general-mode/quit-game.spec.ts` — extend the existing journey to cover a positive-balance quit (currently only zero-balance is exercised) and assert the departed player disappears from the admin's deposit-recipient picker and from their own home dashboard.

New files:
- `apps/e2e/tests/general-mode/close-game.spec.ts` — new journey test: non-admin never sees "Close game", admin does; cancel is a no-op; confirmed close redirects home and the game disappears from both parties' dashboards and the browse list.

---

## Task 1: Extend `quit-game.spec.ts` for positive-balance quit + picker/dashboard removal

**Files:**
- Modify: `apps/e2e/tests/general-mode/quit-game.spec.ts`

**Interfaces:**
- Consumes: existing `uniqueUsername()` and `registerAndLogin()` helpers already defined in this file — no signature changes.
- Consumes: `AdminControlsModal`'s `#deposit-player` select and `#deposit-amount` input, `"Admin controls"` / `"Deposit"` buttons (already used identically in `apps/e2e/tests/general-mode/transfer.spec.ts:61-67`).
- Consumes: `home-empty` test id on `apps/frontend/src/app/(app)/page.tsx:21` (shown when `listMyMemberGames()` returns zero games).

- [ ] **Step 1: Insert a deposit step before the quit, so the departed player has a positive balance to burn**

Insert immediately after the existing "admin never sees a Quit game button" block (currently ending at line 67, `await expect(page.getByTestId("players-list")).toContainText(playerUsername);`) and before the "non-admin player quits" block:

```typescript
  // Host deposits so the quitting player's balance is nonzero — the spec
  // requires burning a positive balance to work, not just the zero-balance
  // case (a player who never had anything deposited to them).
  await page.getByRole("button", { name: "Admin controls" }).click();
  await page.getByLabel("Player").selectOption(playerUsername);
  await page.locator("#deposit-amount").fill("5.00");
  await page.getByRole("button", { name: "Deposit" }).click();
  await expect(
    page.getByTestId("players-list").locator("li").filter({ hasText: playerUsername }),
  ).toContainText("5.00");

  await secondPage.reload();
  await expect(secondPage.getByTestId("my-balance")).toContainText("5.00");
```

- [ ] **Step 2: After the quit redirect, assert the departed player's own dashboard is now empty and they've dropped off the admin's deposit picker**

Insert immediately after the existing line `await expect(secondPage).toHaveURL(/\/$/, { timeout: 60_000 });` (end of the quit block) and before the existing "Host's roster, reloaded" block:

```typescript
  // The departed player's own dashboard no longer lists the game — this
  // was their only game, so listMyMemberGames() now returns empty.
  await expect(secondPage.getByTestId("home-empty")).toBeVisible();
```

Then, after the existing block:

```typescript
  // Host's roster, reloaded, no longer lists the departed player.
  await page.reload();
  await expect(page.getByTestId("players-list")).not.toContainText(playerUsername);
```

append:

```typescript
  // The departed player also drops off the admin's deposit-recipient
  // picker — it's populated from the same live player list.
  await page.getByRole("button", { name: "Admin controls" }).click();
  await expect(page.locator("#deposit-player option", { hasText: playerUsername })).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
```

- [ ] **Step 3: Update the file-level comment's round-trip count**

The comment at the top of the file (lines 3-18) states "6 sequential ... on-chain round trips". Update the count to reflect the added deposit (now 7: 2 registrations + create + join + deposit + quit + rejoin) so the comment stays accurate. Re-measure and adjust the 60_000/90_000 timeouts only if a real contended run in Step 5 below shows it's needed — don't bump speculatively per the Global Constraints note.

- [ ] **Step 4: Bring up the stack and run this spec file alone**

```bash
docker compose -f docker-compose.e2e.yml up -d --build surfpool program-deploy frontend
docker compose -f docker-compose.e2e.yml run --rm e2e pnpm exec playwright test tests/general-mode/quit-game.spec.ts
```

Expected: 1 passed. If it fails, read the failure — do not adjust timeouts or selectors blindly; re-check the actual rendered DOM via the Playwright trace/report the run produces.

- [ ] **Step 5: Run the full e2e suite once to confirm no cross-test contention regression**

```bash
docker compose -f docker-compose.e2e.yml run --rm e2e pnpm test
docker compose -f docker-compose.e2e.yml down
```

Expected: all specs pass under full parallelism (this is the same contended condition the file-level comment already discusses).

- [ ] **Step 6: Commit**

```bash
git add apps/e2e/tests/general-mode/quit-game.spec.ts
git commit -m "test(013): cover positive-balance quit and picker/dashboard removal in e2e"
```

---

## Task 2: New `close-game.spec.ts`

**Files:**
- Create: `apps/e2e/tests/general-mode/close-game.spec.ts`

**Interfaces:**
- Consumes: `CloseGameButton`'s `"Close game"` trigger button, `"Close this game?"` modal text, `"Cancel"` / `"Close"` (exact) modal buttons — `apps/frontend/src/app/(app)/games/[address]/CloseGameButton.tsx:42-68`.
- Consumes: `home-empty` test id (`apps/frontend/src/app/(app)/page.tsx:21`), `browse-games-list` test id (`apps/frontend/src/app/(app)/games/all/page.tsx`).

- [ ] **Step 1: Write the full journey test**

```typescript
import { test, expect } from "@playwright/test";

function uniqueUsername(prefix: string): string {
  return `${prefix}${Date.now()}`;
}

async function registerAndLogin(page: import("@playwright/test").Page, username: string) {
  const password = "Abcdef123!";
  await page.goto("/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });
}

test("an admin closes a game after cancelling once, and it disappears everywhere", async ({
  page,
  browser,
}) => {
  // Same shape as quit-game.spec.ts's heaviest test (2 registrations, create,
  // join, close — which itself closes 2 players' ATAs plus the Game account)
  // — give it the same headroom under full-suite contention.
  test.setTimeout(90_000);

  const hostUsername = uniqueUsername("e2eclosehost");
  const playerUsername = uniqueUsername("e2ecloseplayer");
  const gameName = `E2E Close Game ${Date.now()}`;

  await registerAndLogin(page, hostUsername);
  await page.goto("/games/new");
  await page.getByLabel("Game name").fill(gameName);
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await registerAndLogin(playerPage, playerUsername);
  await playerPage.goto("/games/all");
  await playerPage
    .locator("li")
    .filter({ hasText: gameName })
    .getByRole("button", { name: "Join" })
    .click();
  await expect(playerPage).toHaveURL(/\/games\/(?!all\b)[\w-]+/, { timeout: 60_000 });

  // Non-admin never sees a "Close game" action; the admin does.
  await expect(playerPage.getByRole("button", { name: "Close game" })).toHaveCount(0);
  await page.getByRole("link", { name: new RegExp(gameName) }).click();
  await expect(page).toHaveURL(/\/games\/.+/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Close game" })).toBeVisible();

  // Cancelling the confirmation is a no-op — the game is still there.
  await page.getByRole("button", { name: "Close game" }).click();
  await expect(page.getByText("Close this game?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Close this game?")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: gameName })).toBeVisible();

  // Confirming closes the game and redirects the admin home.
  await page.getByRole("button", { name: "Close game" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });

  // It was the admin's only game.
  await expect(page.getByTestId("home-empty")).toBeVisible();

  // It's gone from the browse list.
  await page.goto("/games/all");
  await expect(page.locator("li").filter({ hasText: gameName })).toHaveCount(0);

  // It's gone from the former player's own dashboard too.
  await playerPage.goto("/");
  await expect(playerPage.getByTestId("home-empty")).toBeVisible();

  await playerContext.close();
});
```

- [ ] **Step 2: Bring up the stack and run this spec file alone**

```bash
docker compose -f docker-compose.e2e.yml up -d --build surfpool program-deploy frontend
docker compose -f docker-compose.e2e.yml run --rm e2e pnpm exec playwright test tests/general-mode/close-game.spec.ts
```

Expected: 1 passed. If the "Close game" heading/text selectors don't match, re-check the actual rendered markup in `CloseGameButton.tsx`/`page.tsx` rather than guessing.

- [ ] **Step 3: Run the full e2e suite once**

```bash
docker compose -f docker-compose.e2e.yml run --rm e2e pnpm test
docker compose -f docker-compose.e2e.yml down
```

Expected: all specs pass.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/tests/general-mode/close-game.spec.ts
git commit -m "test(013): add app-e2e coverage for the close-game journey"
```

---

## Verification (Done Means)

1. `pnpm --filter e2e run lint` and `pnpm --filter e2e run typecheck` — no changes.
2. Both spec files pass individually and as part of the full `docker compose -f docker-compose.e2e.yml run --rm e2e pnpm test` run (Steps above).
3. Full gate: `just test` — confirms nothing else regressed.
