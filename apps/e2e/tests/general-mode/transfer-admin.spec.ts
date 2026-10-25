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

test("the admin transfers the role, the new admin deposits, and the former admin quits", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  const hostUsername = uniqueUsername("e2exferhost");
  const playerUsername = uniqueUsername("e2exferplayer");
  const gameName = `E2E Transfer Admin ${Date.now()}`;

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

  await page.getByRole("link", { name: new RegExp(gameName) }).click();
  await expect(page).toHaveURL(/\/games\/.+/, { timeout: 60_000 });
  await expect(page.getByTestId("players-list")).toContainText(playerUsername);

  await page.getByRole("button", { name: "Admin controls" }).click();
  await page.getByLabel("Player").selectOption(playerUsername);
  await page.locator("#deposit-amount").fill("5.00");
  await page.getByRole("button", { name: "Deposit" }).click();
  await expect(
    page.getByTestId("players-list").locator("li").filter({ hasText: playerUsername }),
  ).toContainText("5.00", { timeout: 60_000 });

  // A successful deposit closes the modal and refreshes the page.
  await page.getByRole("button", { name: "Admin controls" }).click();
  const newAdmin = page.getByLabel("New admin");
  await expect(newAdmin.locator("option", { hasText: playerUsername })).toHaveCount(1);
  await expect(newAdmin.locator("option", { hasText: hostUsername })).toHaveCount(0);
  await newAdmin.selectOption(playerUsername);
  await expect(page.getByText("Transfer this role?")).toHaveCount(0);
  const gameUrl = page.url();
  await page.getByRole("button", { name: "Transfer", exact: true }).click();

  await expect(page).toHaveURL(gameUrl, { timeout: 60_000 });
  await expect(page.getByTestId("game-admin-badge")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Admin controls" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close game" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Quit game" })).toBeVisible();
  await expect(page.getByTestId("players-list")).toContainText(hostUsername);
  await expect(page.getByTestId("players-list")).toContainText(playerUsername);
  const playerRow = page
    .getByTestId("players-list")
    .locator("li")
    .filter({ hasText: playerUsername });
  await expect(playerRow).toContainText("Admin");
  await expect(playerRow).toContainText("5.00");
  const hostRow = page.getByTestId("players-list").locator("li").filter({ hasText: hostUsername });
  await expect(hostRow).toContainText("0.00");
  await expect(hostRow.getByText("Admin", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("my-balance")).toContainText("0.00");

  await secondPage.reload();
  await expect(secondPage.getByTestId("game-admin-badge")).toBeVisible({ timeout: 60_000 });
  await expect(secondPage.getByRole("button", { name: "Admin controls" })).toBeVisible();
  await expect(secondPage.getByRole("button", { name: "Close game" })).toBeVisible();
  await expect(secondPage.getByRole("button", { name: "Quit game" })).toHaveCount(0);
  await secondPage.getByRole("button", { name: "Admin controls" }).click();
  await expect(secondPage.getByText("Transfer admin role")).toBeVisible();
  await secondPage.getByRole("button", { name: "Close", exact: true }).click();

  await page.goto("/");
  const hostHomeRow = page
    .getByTestId("home-games-list")
    .locator("li")
    .filter({ hasText: gameName });
  await expect(hostHomeRow).toBeVisible({ timeout: 60_000 });
  await expect(hostHomeRow.getByText("Admin", { exact: true })).toHaveCount(0);
  await secondPage.goto("/");
  const playerHomeRow = secondPage
    .getByTestId("home-games-list")
    .locator("li")
    .filter({ hasText: gameName });
  await expect(playerHomeRow).toBeVisible({ timeout: 60_000 });
  await expect(playerHomeRow.getByText("Admin", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: new RegExp(gameName) }).click();
  await expect(page).toHaveURL(/\/games\/.+/, { timeout: 60_000 });
  await secondPage.getByRole("link", { name: new RegExp(gameName) }).click();
  await expect(secondPage).toHaveURL(/\/games\/.+/, { timeout: 60_000 });

  await secondPage.getByRole("button", { name: "Admin controls" }).click();
  await secondPage.getByLabel("Player").selectOption(hostUsername);
  await secondPage.locator("#deposit-amount").fill("1.00");
  await secondPage.getByRole("button", { name: "Deposit" }).click();
  await expect(
    secondPage.getByTestId("players-list").locator("li").filter({ hasText: hostUsername }),
  ).toContainText("1.00", { timeout: 60_000 });

  await page.getByRole("button", { name: "Quit game" }).click();
  await expect(page.getByText("Quit this game?")).toBeVisible();
  await page.getByRole("button", { name: "Quit", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });

  await secondPage.reload();
  await expect(secondPage.getByTestId("players-list")).not.toContainText(hostUsername, {
    timeout: 60_000,
  });
  await expect(secondPage.getByTestId("game-admin-badge")).toBeVisible();
  await expect(secondPage.getByRole("button", { name: "Quit game" })).toHaveCount(0);

  await secondContext.close();
});
