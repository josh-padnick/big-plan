// Browser journey for BigDecision's standalone card: status pills, option
// states, signed tradeoffs, native disclosure, no-JavaScript readability,
// and light/dark palettes.

import { expect, test } from "./fixtures";

test("should review standalone plan decisions", async ({
  browser,
  page,
  bigDecisionViewerUrl,
}) => {
  await page.goto(bigDecisionViewerUrl);
  const decisions = page.locator("[data-big-decision]");
  const openDecision = decisions.filter({
    has: page.locator('[data-decision-status="open"]'),
  });
  const decidedDecision = decisions.filter({
    has: page.locator('[data-decision-status="decided"]'),
  });
  const deferredDecision = decisions.filter({
    has: page.locator('[data-decision-status="deferred"]'),
  });
  const details = openDecision.locator("details");

  await test.step("each decision stands alone with its status pill", async () => {
    await expect(decisions).toHaveCount(3);
    await expect(page.locator("[data-decision-status]")).toHaveText([
      "open",
      "decided",
      "deferred",
    ]);
    await expect(openDecision).toContainText("PostgreSQL");
    await expect(decidedDecision).toContainText("Alongside the source plan");
    await expect(deferredDecision).toContainText(
      "Wait for signed-in reviewer identities",
    );
  });

  await test.step("the tradeoffs group under Pros and Cons headers with signed markers", async () => {
    const pros = page.locator('[data-decision-tradeoff="pro"]');
    const cons = page.locator('[data-decision-tradeoff="con"]');
    await expect(pros).toHaveCount(8);
    await expect(cons).toHaveCount(7);
    await expect(pros.locator('[data-lucide="check"]')).toHaveCount(8);
    await expect(cons.locator('[data-lucide="minus"]')).toHaveCount(7);
    await expect(
      page.locator('[data-tradeoff-group="pro"]').first(),
    ).toContainText("Pros");
    await expect(
      page.locator('[data-tradeoff-group="con"]').first(),
    ).toContainText("Cons");
  });

  await test.step("the recommended badge appears once per decision", async () => {
    for (const decision of await decisions.all()) {
      await expect(
        decision.locator(".big-decision-recommended-pill"),
      ).toHaveCount(1);
    }
  });

  await test.step("the details disclosure opens and closes natively", async () => {
    await expect(details).toHaveCount(1);
    await expect(details).toHaveJSProperty("open", false);
    await expect(
      details.getByText(/The repository layer will own/),
    ).toBeHidden();
    await details.getByText("Details", { exact: true }).click();
    await expect(details).toHaveJSProperty("open", true);
    await expect(
      details.getByText(/The repository layer will own/),
    ).toBeVisible();
    await details.getByText("Details", { exact: true }).click();
    await expect(details).toHaveJSProperty("open", false);
  });

  await test.step("the decided outcome keeps losing options visible", async () => {
    await expect(decidedDecision.locator("[data-decision-outcome]")).toHaveText(
      "Chosen: Alongside the source plan",
    );
    await expect(decidedDecision.locator("[data-option-chosen]")).toHaveCount(
      1,
    );
    await expect(
      decidedDecision.locator(".big-decision-option-muted"),
    ).toHaveCount(1);
    await expect(decidedDecision).toContainText("Tool-owned cache directory");
  });

  await test.step("every decision reads without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(bigDecisionViewerUrl);
    await expect(staticPage.locator("[data-big-decision]")).toHaveCount(3);
    await expect(staticPage.locator("body")).toContainText(
      "Chosen: Alongside the source plan",
    );
    await expect(
      staticPage.locator('[data-decision-tradeoff="pro"]'),
    ).toHaveCount(8);
    const staticDetails = staticPage.locator("details");
    await staticDetails.getByText("Details", { exact: true }).click();
    await expect(
      staticDetails.getByText(/The repository layer will own/),
    ).toBeVisible();
    await context.close();
  });

  await test.step("both themes keep pills and tints legible", async () => {
    for (const theme of ["light", "dark"]) {
      const palette = await page
        .locator("[data-big-decision]")
        .first()
        .evaluate((decision, selectedTheme) => {
          document.documentElement.dataset.theme = selectedTheme;
          return [
            ...decision.querySelectorAll(
              ".big-decision-status-pill, .big-decision-recommended-pill, " +
                ".big-decision-tradeoff",
            ),
          ].map((element) => {
            const style = getComputedStyle(element);
            return { color: style.color, background: style.backgroundColor };
          });
        }, theme);
      expect(palette.length).toBeGreaterThan(0);
      expect(
        palette.every(({ color, background }) => color !== background),
      ).toBe(true);
    }
  });
});
