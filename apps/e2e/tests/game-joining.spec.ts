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
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
}

test("a second user can browse, join, and see themselves in the game's player list", async ({
  page,
  browser,
}) => {
  const hostUsername = uniqueUsername("e2ejoinhost");
  const joinerUsername = uniqueUsername("e2ejoiner");

  // Create the game as the first user.
  await registerAndLogin(page, hostUsername);
  await page.goto("/games/new");
  await page.getByLabel("Game name").fill("E2E Join Test Game");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByTestId("home-games-list")).toContainText("E2E Join Test Game");

  // Join as a second, independent user (separate browser context so the
  // two sessions' cookies don't clash).
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await registerAndLogin(secondPage, joinerUsername);

  await secondPage.goto("/games/all");
  const row = secondPage.locator("li").filter({ hasText: "E2E Join Test Game" });
  await expect(row).toContainText("0/20");
  await row.getByRole("button", { name: "Join" }).click();

  await expect(secondPage).toHaveURL(/\/games\/.+/, { timeout: 30_000 });
  await expect(secondPage.getByTestId("players-list")).toContainText(joinerUsername);
  await expect(secondPage.getByTestId("my-balance")).toContainText("0.00");

  // Browsing again now shows "Open" instead of "Join" for the same game.
  await secondPage.goto("/games/all");
  const rowAfterJoin = secondPage.locator("li").filter({ hasText: "E2E Join Test Game" });
  await expect(rowAfterJoin).toContainText("1/20");
  await expect(rowAfterJoin.getByRole("button", { name: "Open" })).toBeVisible();

  await secondContext.close();
});
