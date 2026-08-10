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

test("game admin deposits to a player, and the player sees the credited balance", async ({
  page,
  browser,
}) => {
  const hostUsername = uniqueUsername("e2edeposithost");
  const playerUsername = uniqueUsername("e2edepositplayer");

  await registerAndLogin(page, hostUsername);
  await page.goto("/games/new");
  await page.getByLabel("Game name").fill("E2E Deposit Test Game");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await registerAndLogin(secondPage, playerUsername);
  await secondPage.goto("/games/all");
  const row = secondPage.locator("li").filter({ hasText: "E2E Deposit Test Game" });
  await row.getByRole("button", { name: "Join" }).click();
  await expect(secondPage).toHaveURL(/\/games\/.+/, { timeout: 30_000 });
  await expect(secondPage.getByTestId("my-balance")).toContainText("0.00");

  // Non-admin has no access to the deposit form.
  await expect(secondPage.getByRole("button", { name: "Admin controls" })).toHaveCount(0);

  // Host opens the game and deposits to the newly joined player.
  await page.getByRole("link", { name: /E2E Deposit Test Game/ }).click();
  await expect(page).toHaveURL(/\/games\/.+/, { timeout: 30_000 });
  await expect(page.getByTestId("players-list")).toContainText(playerUsername);
  await page.getByRole("button", { name: "Admin controls" }).click();
  await page.getByLabel("Player").selectOption(playerUsername);
  await page.getByLabel("Amount").fill("5.00");
  await page.getByRole("button", { name: "Deposit" }).click();

  const playerRow = page.getByTestId("players-list").locator("li").filter({ hasText: playerUsername });
  await expect(playerRow).toContainText("5.00");

  // Player's own view reflects the deposit once they next load the page —
  // no live/push update while they're already on it.
  await secondPage.reload();
  await expect(secondPage.getByTestId("my-balance")).toContainText("5.00");

  await secondContext.close();
});
