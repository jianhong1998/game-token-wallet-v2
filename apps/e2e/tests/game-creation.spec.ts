import { test, expect } from "@playwright/test";

function uniqueUsername(): string {
  return `e2egamehost${Date.now()}`;
}

test.describe("game creation", () => {
  test("a logged-in user creates a game and sees it in their games list", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-empty")).toBeVisible();

    await page.getByRole("link", { name: "Create" }).click();
    await expect(page).toHaveURL(/\/games\/new$/);

    await page.getByLabel("Game name").fill("Friday Poker");
    await page.getByRole("button", { name: "Create game" }).click();

    await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-games-list")).toContainText("Friday Poker");
    await expect(page.getByTestId("home-games-list")).toContainText("Admin");
  });

  test("an invalid game name blocks submission with a live hint", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

    await page.goto("/games/new");
    await page.getByLabel("Game name").fill("ab");
    await expect(page.getByTestId("game-name-hint")).toBeVisible();
    await expect(page).toHaveURL(/\/games\/new$/);
  });
});
