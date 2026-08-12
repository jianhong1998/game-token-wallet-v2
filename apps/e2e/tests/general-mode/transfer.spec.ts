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

test("a player sends tokens to two other members in one batch", async ({ page, browser }) => {
  // This spec does far more on-chain work than any sibling spec (3 registrations,
  // a game creation, 2 joins, a deposit, and a batched multi-recipient transfer),
  // so it needs more than Playwright's default 30s per-test budget, especially
  // when running alongside the rest of the suite under full parallelism.
  test.setTimeout(90_000);

  const hostUsername = uniqueUsername("e2etransferhost");
  const senderUsername = uniqueUsername("e2etransfersender");
  // "e2etransferrecipient" + a 13-digit Date.now() timestamp is 33 bytes,
  // over the app's 32-byte username max — shortened to fit.
  const recipientUsername = uniqueUsername("e2etransferrecip");

  await registerAndLogin(page, hostUsername);
  await page.goto("/games/new");
  await page.getByLabel("Game name").fill("E2E Transfer Test Game");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  const senderContext = await browser.newContext();
  const senderPage = await senderContext.newPage();
  await registerAndLogin(senderPage, senderUsername);
  await senderPage.goto("/games/all");
  await senderPage
    .locator("li")
    .filter({ hasText: "E2E Transfer Test Game" })
    .getByRole("button", { name: "Join" })
    .click();
  await expect(senderPage).toHaveURL(/\/games\/(?!all\b)[\w-]+/, { timeout: 30_000 });

  const recipientContext = await browser.newContext();
  const recipientPage = await recipientContext.newPage();
  await registerAndLogin(recipientPage, recipientUsername);
  await recipientPage.goto("/games/all");
  await recipientPage
    .locator("li")
    .filter({ hasText: "E2E Transfer Test Game" })
    .getByRole("button", { name: "Join" })
    .click();
  await expect(recipientPage).toHaveURL(/\/games\/(?!all\b)[\w-]+/, { timeout: 30_000 });

  // Host deposits so the sender has a balance to transfer from.
  await page.getByRole("link", { name: /E2E Transfer Test Game/ }).click();
  await expect(page).toHaveURL(/\/games\/.+/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Admin controls" }).click();
  await page.getByLabel("Player").selectOption(senderUsername);
  // Scoped to the admin modal's own "Amount" field by id (kept explicit even
  // though SendTokensForm's own amount field now has a distinct "Tokens to
  // send" label, avoiding any getByLabel("Amount") ambiguity).
  await page.locator("#deposit-amount").fill("10.00");
  await page.getByRole("button", { name: "Deposit" }).click();
  await expect(
    page.getByTestId("players-list").locator("li").filter({ hasText: senderUsername }),
  ).toContainText("10.00");

  // Sender opens the game and sends a batch to the host and the recipient.
  // Fill the first row while it's the only one (so the "Recipient"/"Tokens to
  // send" labels are unambiguous), then add a second row and address it by index.
  await senderPage.reload();
  await expect(senderPage.getByTestId("my-balance")).toContainText("10.00");
  // exact: true — Playwright's getByLabel does case-insensitive substring
  // matching by default, and once a second row exists every row also shows
  // a "Remove recipient" button, which would otherwise ambiguously match a
  // plain "Recipient" query too (same reasoning as registerAndLogin's
  // "Password" vs "Confirm password" above).
  await senderPage.getByLabel("Recipient", { exact: true }).selectOption(hostUsername);
  await senderPage.getByLabel("Tokens to send").fill("3.00");
  await senderPage.getByRole("button", { name: "+ Add recipient" }).click();
  await senderPage.getByLabel("Recipient", { exact: true }).nth(1).selectOption(recipientUsername);
  await senderPage.getByLabel("Tokens to send").nth(1).fill("2.00");
  await senderPage.getByRole("button", { name: /Send/ }).click();

  await expect(senderPage.getByTestId("my-balance")).toContainText("5.00", { timeout: 30_000 });

  await recipientPage.reload();
  await expect(recipientPage.getByTestId("my-balance")).toContainText("2.00");

  await page.reload();
  const hostRow = page.getByTestId("players-list").locator("li").filter({ hasText: hostUsername });
  await expect(hostRow).toContainText("3.00");

  await senderContext.close();
  await recipientContext.close();
});
