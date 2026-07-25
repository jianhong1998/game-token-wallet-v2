import { test, expect } from "@playwright/test";

function uniqueUsername(): string {
  return `e2euser${Date.now()}`;
}

test.describe("registration and login", () => {
  test("a new user can register, land on /home, log out, and log back in", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-welcome")).toContainText(username);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-welcome")).toContainText(username);
  });

  test("login with the wrong password shows a generic error", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByTestId("login-error")).toHaveText("Invalid username or password");
  });

  test("navigates between login and register via the footer links", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/register$/);

    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
