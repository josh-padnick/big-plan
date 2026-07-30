// Browser tests of SimpleDecisionSet's inert review journey: the numbered
// question list with always-visible option explanations. Render-health
// failures are enforced by the fixtures module.

import { expect, test } from "./fixtures";

test("should review a compact question list in an inert export", async ({
  page,
  simpleDecisionSetViewerUrl,
}) => {
  await page.goto(simpleDecisionSetViewerUrl);
  const set = page.locator("[data-simple-decision-set]").first();

  await test.step("the header counts the questions", async () => {
    await expect(set.locator(".simple-decision-set-summary")).toContainText(
      /question/,
    );
  });

  await test.step("every question is numbered with visible options", async () => {
    const decisions = set.locator("[data-simple-decision]");
    await expect(decisions.first()).toBeVisible();
    const firstOptions = decisions.first().locator("[data-option]");
    await expect(firstOptions.first()).toBeVisible();
    await expect(
      decisions.first().locator(".simple-decision-number").first(),
    ).toHaveText(/^1\./);
  });

  await test.step("a recommended option carries its pill inline", async () => {
    await expect(
      set.locator("[data-option-recommended]").first(),
    ).toContainText("Recommended");
  });

  await test.step("option markers stay decorative without scripts", async () => {
    await expect(set.locator("[data-option-control]").first()).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
