// Browser test of the critical journey: open the rendered sample plan via
// file:// and review it through the TOC. Render-health failures are enforced
// by the fixtures module.

import { expect, test } from "./fixtures";

test("should navigate the rendered sample plan through the TOC without errors", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);

  await expect(page).toHaveTitle("Payments Retry Architecture Plan");
  await expect(
    page.getByRole("heading", { level: 1, name: "Payments Retry Architecture Plan" }),
  ).toBeVisible();

  // The TOC lists every h2 section of the sample document, in order.
  const toc = page.getByRole("navigation", { name: "Contents" });
  await expect(toc.getByRole("link")).toHaveText([
    "Background",
    "Goals and non-goals",
    "Retry state machine",
    "Schema changes",
    "Failure classification",
    "Rollout plan",
  ]);

  // Clicking a TOC entry navigates to that section.
  await toc.getByRole("link", { name: "Rollout plan" }).click();
  await expect(page).toHaveURL(/#rollout-plan$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Rollout plan" }),
  ).toBeInViewport();

  // The wide classification table scrolls inside its own container instead of
  // widening the page. The stable data attribute is the behavior-bearing
  // interface; utility classes and exact nesting stay implementation detail.
  const wideTable = page.getByRole("table");
  const tableScrollContainer = page.locator("[data-table-scroll-container]");
  await expect(wideTable).toBeVisible();
  await expect(tableScrollContainer).toHaveCount(1);
  await expect
    .poll(() =>
      tableScrollContainer.evaluate(
        (container) => container.scrollWidth > container.clientWidth,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    )
    .toBe(false);
});
