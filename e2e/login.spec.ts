import { test, expect } from "@playwright/test";

test.describe("Login Page", () => {
  test("renders login form correctly", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { level: 1 })
    ).toContainText("Sign in to Proof");
    await expect(page.getByText("Continue with Google")).toBeVisible();
  });

  test("has back to home link", async ({ page }) => {
    await page.goto("/login");

    const backLink = page.getByRole("link", { name: "Back to home" });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute("href", "/");
  });

  test("logo links to home", async ({ page }) => {
    await page.goto("/login");

    const logo = page.getByRole("link", { name: "P" });
    await expect(logo).toHaveAttribute("href", "/");
  });

  test("shows invite-only message", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByText("invite-only")).toBeVisible();
  });
});
