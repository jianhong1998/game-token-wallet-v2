import { test, expect } from "@playwright/test";

// This file's timeouts are 60_000, double the 30_000 the rest of the e2e
// suite uses. Root cause of the flaky/hanging rejoin failure (investigated
// via repeated docker-compose.e2e.yml full-parallel-suite runs): this is
// NOT a join/quit logic bug — on-chain `join_game`/`quit_game` and the
// frontend `joinGame` server action all work correctly (verified directly,
// and the on-chain e2e "rejoin after quitting" test passes reliably even on
// fresh stacks). This is simply the heaviest single test in the suite — 2
// registrations + create game + join + quit + rejoin, i.e. 6 sequential
// "confirmed"-commitment on-chain round trips across 2 browser contexts —
// so under real parallel-worker/cold-container contention (the exact
// condition `just test`'s CI job runs under) its cumulative wall-clock time
// sits right at the edge of the suite's shared 30_000ms convention: measured
// 26.1s-29.5s total across multiple full-suite contended runs, vs. an
// uncontended run finishing in 3.3s. 60_000 was verified (several repeated
// full-suite runs under contention) to give this test comfortable headroom
// without masking a real hang.
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

test("a non-admin player quits a game, is removed from the roster, and can rejoin", async ({
  page,
  browser,
}) => {
  // Playwright's own default per-test timeout (30_000ms, unset in
  // playwright.config.ts) would otherwise kill this whole test before any
  // of the 60_000ms assertion-level timeouts above get a chance to matter
  // — see the file-level comment for why this test needs the extra room.
  test.setTimeout(90_000);

  const hostUsername = uniqueUsername("e2equithost");
  const playerUsername = uniqueUsername("e2equitplayer");
  // Unique per run: the on-chain devnet-style stack persists state across test
  // runs, so a fixed game name would collide with leftovers from prior runs.
  const gameName = `E2E Quit Test Game ${Date.now()}`;

  await registerAndLogin(page, hostUsername);
  await page.goto("/games/new");
  await page.getByLabel("Game name").fill(gameName);
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await registerAndLogin(secondPage, playerUsername);
  await secondPage.goto("/games/all");
  const row = secondPage.locator("li").filter({ hasText: gameName });
  await row.getByRole("button", { name: "Join" }).click();
  await expect(secondPage).toHaveURL(/\/games\/(?!all\b)[\w-]+/, { timeout: 60_000 });

  // The admin never sees a "Quit game" button on their own game.
  await page.getByRole("link", { name: new RegExp(gameName) }).click();
  await expect(page).toHaveURL(/\/games\/.+/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Quit game" })).toHaveCount(0);
  await expect(page.getByTestId("players-list")).toContainText(playerUsername);

  // The non-admin player quits, with a confirmation step in between.
  await expect(secondPage.getByRole("button", { name: "Quit game" })).toBeVisible();
  await secondPage.getByRole("button", { name: "Quit game" }).click();
  await expect(secondPage.getByText("Quit this game?")).toBeVisible();
  await secondPage.getByRole("button", { name: "Quit", exact: true }).click();
  await expect(secondPage).toHaveURL(/\/$/, { timeout: 60_000 });

  // Host's roster, reloaded, no longer lists the departed player.
  await page.reload();
  await expect(page.getByTestId("players-list")).not.toContainText(playerUsername);

  // The departed player can rejoin the same game.
  await secondPage.goto("/games/all");
  const rowAfterQuit = secondPage.locator("li").filter({ hasText: gameName });
  await expect(rowAfterQuit.getByRole("button", { name: "Join" })).toBeVisible();
  await rowAfterQuit.getByRole("button", { name: "Join" }).click();
  await expect(secondPage).toHaveURL(/\/games\/(?!all\b)[\w-]+/, { timeout: 60_000 });
  await expect(secondPage.getByTestId("my-balance")).toContainText("0.00");

  await secondContext.close();
});
