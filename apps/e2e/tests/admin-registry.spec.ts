import { test, expect } from "@playwright/test";

test("admin can initialize the registry and see the active-game count", async ({ page }) => {
  await page.goto("/admin/registry");
  await page.getByRole("button", { name: "Initialize registry" }).click();
  await expect(page.getByTestId("registry-status")).toBeVisible({ timeout: 30_000 });

  const status = await page.getByTestId("registry-status").textContent();
  expect(status).toBe("registry initialized, 0 active games");
});
