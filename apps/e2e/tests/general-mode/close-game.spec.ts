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
  // NB: "E2E Close Test Game <ts>" would be 33 bytes (one over
  // MAX_GAME_NAME_BYTES=32 in apps/frontend/src/lib/game-name.ts) — one
  // byte more than quit-game.spec.ts's "E2E Quit Test Game <ts>" (32,
  // right at the limit) because "Close" is a letter longer than "Quit".
  // Dropped "Test" to fit.
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
