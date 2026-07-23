import { test, expect } from "@playwright/test";

test("home page proves the connection utility plumbing works end-to-end", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Send noop transaction" }).click();
  await expect(page.getByTestId("noop-signature")).toBeVisible({ timeout: 30_000 });

  const signature = await page.getByTestId("noop-signature").textContent();
  expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
});
