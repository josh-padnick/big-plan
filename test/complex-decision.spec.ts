// Browser tests of ComplexDecision's inert review journey: the criteria matrix,
// native disclosures, and the reversibility section, with every
// script-dependent control absent or hidden. Render-health failures are
// enforced by the fixtures module.

import { expect, test } from "./fixtures";

test("should review a standalone decision matrix in an inert export", async ({
  page,
  complexDecisionViewerUrl,
}) => {
  await page.goto(complexDecisionViewerUrl);
  const decision = page.locator("[data-complex-decision]").first();
  const matrix = decision.locator("table.complex-decision-matrix");

  await test.step("the question heads the card", async () => {
    await expect(decision.locator("[data-decision-question]")).toBeVisible();
  });

  await test.step("options are columns and criteria are rows", async () => {
    await expect(matrix).toBeVisible();
    await expect(matrix.locator("thead [data-option]").first()).toBeVisible();
    await expect(
      matrix.locator("tbody th.complex-decision-criterion").first(),
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

  await test.step("verdict detail floats as a hover popover", async () => {
    const info = matrix.locator("details.complex-decision-info").first();
    await info.locator("summary").hover();
    await expect(info).toHaveAttribute("open", "");
    const body = info.locator(".complex-decision-info-body");
    await expect(body).toBeVisible();
    await expect(body).toBeInViewport();
    await page.mouse.move(0, 0);
    await expect(info).not.toHaveAttribute("open", "");
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
