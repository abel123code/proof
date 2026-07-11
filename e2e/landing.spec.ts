import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test("renders hero section with correct heading", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1 })
    ).toContainText("boring github repos");
    await expect(
      page.getByRole("heading", { level: 1 })
    ).toContainText("viral tiktok videos");
  });

  test("has working navigation links", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "connect your repo" }).first()).toBeVisible();
  });

  test("header logo links to home", async ({ page }) => {
    await page.goto("/");

    const logo = page.getByRole("link", { name: "P Proof" });
    await expect(logo).toHaveAttribute("href", "/");
  });

  test("connect button navigates to connect page", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "connect your repo" }).first().click();
    await expect(page).toHaveURL("/connect");
  });

  test("login button navigates to login page", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Log in" }).first().click();
    await expect(page).toHaveURL("/login");
  });

  test("problem section is visible", async ({ page }) => {
    await page.goto("/");

    const problemSection = page.locator("#problem");
    await expect(problemSection).toBeVisible();
    await expect(problemSection).toContainText("Good code");
  });

  test("how it works section shows pipeline", async ({ page }) => {
    await page.goto("/");

    const howSection = page.locator("#how");
    await expect(howSection).toBeVisible();
    await expect(howSection).toContainText("Repo in");
    await expect(howSection).toContainText("MP4 out");
  });
});
