// Browser regression for persistence identity: same-title plans stay isolated,
// and an unstamped page remains interactive without touching browser storage.

import { expect, test } from "./fixtures";

test("should scope collapse persistence to the stamped plan identity", async ({
  page,
  planIdCollisionViewerUrls,
}) => {
  await page.goto(planIdCollisionViewerUrls.first);
  await page.evaluate(() => localStorage.clear());
  const firstRoot = page.locator("html");
  const firstPlanId = await firstRoot.getAttribute("data-plan-id");
  const firstSlide = page.locator(
    '[data-collapsible="slide"][data-collapse-id="shared-section"]',
  );

  expect(firstPlanId).toMatch(/^[a-f0-9]{32}$/);
  await firstSlide
    .locator(":scope > [data-collapse-header] > [data-collapse-toggle]")
    .click();
  await expect(firstSlide).toHaveAttribute("data-collapsed", "");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("big-plan:collapse:"),
        ),
      ),
    )
    .toEqual([`big-plan:collapse:${firstPlanId ?? ""}:shared-section`]);

  await page.goto(planIdCollisionViewerUrls.second);
  const secondPlanId = await page.locator("html").getAttribute("data-plan-id");
  const secondSlide = page.locator(
    '[data-collapsible="slide"][data-collapse-id="shared-section"]',
  );
  expect(secondPlanId).toMatch(/^[a-f0-9]{32}$/);
  expect(secondPlanId).not.toBe(firstPlanId);
  await expect(secondSlide).not.toHaveAttribute("data-collapsed");

  await secondSlide
    .locator(":scope > [data-collapse-header] > [data-collapse-toggle]")
    .click();
  await expect(secondSlide).toHaveAttribute("data-collapsed", "");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("big-plan:collapse:"))
          .sort(),
      ),
    )
    .toEqual(
      [
        `big-plan:collapse:${firstPlanId ?? ""}:shared-section`,
        `big-plan:collapse:${secondPlanId ?? ""}:shared-section`,
      ].sort(),
    );
});

test("should skip persistence when the plan identity is absent", async ({
  page,
  planIdCollisionViewerUrls,
}) => {
  await page.goto(planIdCollisionViewerUrls.unidentified);
  await page.evaluate(() => localStorage.clear());
  const slide = page.locator(
    '[data-collapsible="slide"][data-collapse-id="shared-section"]',
  );

  await expect(page.locator("html")).not.toHaveAttribute("data-plan-id");
  await slide
    .locator(":scope > [data-collapse-header] > [data-collapse-toggle]")
    .click();
  await expect(slide).toHaveAttribute("data-collapsed", "");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);

  await page.reload();
  await expect(slide).not.toHaveAttribute("data-collapsed");
});
