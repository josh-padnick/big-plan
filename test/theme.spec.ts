// Browser tests of the theme control: the persisted light/dark toggle and how
// it hands authority back and forth with the OS color-scheme preference.
// Render-health failures are enforced by the fixtures module.

import { expect, test } from "./fixtures";

test("should switch between light and dark themes", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(sampleViewerUrl);

  const toggle = page.getByRole("button", { name: /Use (?:light|dark) theme/ });
  const initialBackground = await page.locator("body").evaluate(
    (body) => getComputedStyle(body).backgroundColor,
  );
  const requestedTheme = (await toggle.getAttribute("aria-label"))?.includes("dark")
    ? "dark"
    : "light";

  await toggle.click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", requestedTheme);
  await expect(toggle).toHaveAccessibleName(
    requestedTheme === "dark" ? "Use light theme" : "Use dark theme",
  );
  await expect
    .poll(() =>
      page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor),
    )
    .not.toBe(initialBackground);

  const doesToggleClearTitle = await page.evaluate(() => {
    const toggleElement = document.querySelector("[data-theme-toggle]");
    const titleElement = document.querySelector("h1");
    if (toggleElement === null || titleElement === null) {
      return false;
    }
    return toggleElement.getBoundingClientRect().bottom <=
      titleElement.getBoundingClientRect().top;
  });
  expect(doesToggleClearTitle).toBe(true);
});

test("should track system theme changes until the reader chooses a theme", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(sampleViewerUrl);

  const toggle = page.locator("[data-theme-toggle]");
  await expect(toggle).toHaveAccessibleName("Use dark theme");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(toggle).toHaveAccessibleName("Use light theme");

  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(toggle).toHaveAccessibleName("Use dark theme");
});
