// Browser tests of BigDecision's inert review journey: the criteria matrix,
// native disclosures, and the reversibility section, with every
// script-dependent control absent or hidden. Render-health failures are
// enforced by the fixtures module.

import { expect, test } from "./fixtures";

test("should review a standalone decision matrix in an inert export", async ({
  page,
  bigDecisionViewerUrl,
}) => {
  await page.goto(bigDecisionViewerUrl);
  const decision = page.locator("[data-big-decision]").first();
  const matrix = decision.locator("table.big-decision-matrix");

  await test.step("the question heads the card", async () => {
    await expect(decision.locator("[data-decision-question]")).toBeVisible();
  });

  await test.step("options are columns and criteria are rows", async () => {
    await expect(matrix).toBeVisible();
    await expect(matrix.locator("thead [data-option]").first()).toBeVisible();
    await expect(
      matrix.locator("tbody th.big-decision-criterion").first(),
    ).toBeVisible();
  });

  await test.step("a recommended option carries its pill above the card", async () => {
    await expect(
      decision
        .locator("[data-option-decorators]")
        .filter({ hasText: "Recommended" })
        .first(),
    ).toBeVisible();
  });

  await test.step("verdict detail opens through the native disclosure", async () => {
    const info = matrix.locator("details.big-decision-info").first();
    await info.locator("summary").click();
    await expect(info).toHaveAttribute("open", "");
    await expect(info.locator(".big-decision-info-body")).toBeVisible();
  });

  await test.step("the reversibility section states its rating", async () => {
    const reversibility = decision.locator("[data-decision-reversibility]");
    await expect(reversibility).toBeVisible();
    await expect(reversibility).toContainText(/reverse/i);
  });

  await test.step("script-only controls never appear", async () => {
    await expect(decision.locator("[data-decision-expand]")).toBeHidden();
  });
});
