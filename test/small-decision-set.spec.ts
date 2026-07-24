// Browser journey for SmallDecisionSet's compact question list: numbering,
// option rows, recommended tags, and no-JavaScript readability.

import { expect, test } from "./fixtures";

test("should review a compact question list", async ({
  browser,
  page,
  smallDecisionSetViewerUrl,
}) => {
  await page.goto(smallDecisionSetViewerUrl);
  const set = page.locator("[data-small-decision-set]");
  const questions = set.locator("[data-small-decision]");

  await test.step("the header counts the questions", async () => {
    await expect(set).toBeVisible();
    await expect(set.locator(".small-decision-set-summary")).toHaveText(
      "3 questions",
    );
    await expect(questions).toHaveCount(3);
  });

  await test.step("the questions read as a numbered list", async () => {
    await expect(questions.nth(0)).toContainText("1.");
    await expect(questions.nth(2)).toContainText("3.");
    await expect(questions.nth(0)).toContainText(
      "Should the first release ship behind a feature flag?",
    );
  });

  await test.step("each option row pairs its title with its detail", async () => {
    const firstOptions = questions.nth(0).locator("[data-option]");
    await expect(firstOptions).toHaveCount(2);
    await expect(firstOptions.nth(0)).toContainText("Yes");
    await expect(firstOptions.nth(0)).toContainText(
      "Keeps rollback one toggle away",
    );
  });

  await test.step("the recommended tag marks at most one option per question", async () => {
    for (const question of await questions.all()) {
      await expect(
        question.locator(".small-decision-recommended-pill"),
      ).toHaveCount(1);
    }
  });

  await test.step("an option without detail stays a clean single row", async () => {
    const bareOption = page.locator("#option-same-release");
    await expect(bareOption).toContainText("Same release");
  });

  await test.step("the complete list reads without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(smallDecisionSetViewerUrl);
    const staticSet = staticPage.locator("[data-small-decision-set]");
    await expect(staticSet).toBeVisible();
    await expect(staticSet.locator("[data-small-decision]")).toHaveCount(3);
    await expect(staticSet).toContainText("Production, one region");
    await context.close();
  });
});
