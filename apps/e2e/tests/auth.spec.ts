import { test, expect } from "@playwright/test";

function uniqueUsername(): string {
  return `e2euser${Date.now()}`;
}

test.describe("registration and login", () => {
  test("a new user can register, land on /home, log out, and log back in", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password", { exact: true }).fill(password);
    await page.getByPlaceholder("Confirm password").fill(password);
    await page.getByRole("button", { name: "Register" }).click();

    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-welcome")).toContainText(username);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-welcome")).toContainText(username);
  });

  test("login with the wrong password shows a generic error", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password", { exact: true }).fill(password);
    await page.getByPlaceholder("Confirm password").fill(password);
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByTestId("login-error")).toHaveText("Invalid username or password");
  });
});
