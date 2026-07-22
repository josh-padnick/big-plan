// Browser journey for DecisionSet's decision counts, status and option-state
// emphasis, signed tradeoffs, native disclosure, no-JavaScript readability,
// and light/dark palettes.

import { expect, test } from "./fixtures";

test("should review a set of plan decisions", async ({
  browser,
  page,
  decisionSetViewerUrl,
}) => {
  await page.goto(decisionSetViewerUrl);
  const decisionSet = page.locator("[data-decision-set]");
  const decisions = decisionSet.locator("[data-decision]");
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

  await test.step("the count strip reflects every decision", async () => {
    await expect(decisionSet).toBeVisible();
    await expect(decisionSet.locator(".decision-set-summary")).toHaveText(
      "3 decisions · 1 open",
    );
    await expect(decisions).toHaveCount(3);
  });

  await test.step("the statuses and recommendations label each decision", async () => {
    await expect(decisionSet.locator("[data-decision-status]")).toHaveText([
      "open",
      "decided",
      "deferred",
    ]);
    for (const decision of await decisions.all()) {
      await expect(
        decision.locator(".decision-set-recommended-pill"),
      ).toHaveCount(1);
    }
    await expect(openDecision).toContainText("PostgreSQL");
    await expect(decidedDecision).toContainText("Alongside the source plan");
    await expect(deferredDecision).toContainText(
      "Wait for signed-in reviewer identities",
    );
  });

  await test.step("the tradeoffs carry signed markers", async () => {
    const pros = decisionSet.locator('[data-decision-tradeoff="pro"]');
    const cons = decisionSet.locator('[data-decision-tradeoff="con"]');
    await expect(pros).toHaveCount(8);
    await expect(cons).toHaveCount(7);
    await expect(pros.locator('[data-lucide="check"]')).toHaveCount(8);
    await expect(cons.locator('[data-lucide="minus"]')).toHaveCount(7);
    await expect(pros.first()).toContainText("Transactions keep comment");
    await expect(cons.first()).toContainText(
      "Local development requires a database process",
    );
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
      decidedDecision.locator(".decision-set-option-muted"),
    ).toHaveCount(1);
    await expect(decidedDecision).toContainText("Tool-owned cache directory");
  });

  await test.step("the complete set reads without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(decisionSetViewerUrl);
    const staticSet = staticPage.locator("[data-decision-set]");
    await expect(staticSet).toBeVisible();
    await expect(staticSet.locator("[data-decision]")).toHaveCount(3);
    await expect(staticSet).toContainText("Chosen: Alongside the source plan");
    await expect(staticSet).toContainText("Tool-owned cache directory");
    await expect(
      staticSet.locator('[data-decision-tradeoff="pro"]'),
    ).toHaveCount(8);
    const staticDetails = staticSet.locator("details");
    await staticDetails.getByText("Details", { exact: true }).click();
    await expect(
      staticDetails.getByText(/The repository layer will own/),
    ).toBeVisible();
    await context.close();
  });

  await test.step("both themes keep pills and tints legible", async () => {
    for (const theme of ["light", "dark"]) {
      const palette = await decisionSet.evaluate((set, selectedTheme) => {
        document.documentElement.dataset.theme = selectedTheme;
        return [
          ...set.querySelectorAll(
            ".decision-set-status-pill, .decision-set-recommended-pill, " +
              ".decision-set-outcome, .decision-set-tradeoff",
          ),
        ].map((element) => {
          const style = getComputedStyle(element);
          return {
            color: style.color,
            background: style.backgroundColor,
          };
        });
      }, theme);
      expect(palette.length).toBeGreaterThan(0);
      expect(
        palette.every(({ color, background }) => color !== background),
      ).toBe(true);
      const proBackground = await decisionSet
        .locator('[data-decision-tradeoff="pro"]')
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      const conBackground = await decisionSet
        .locator('[data-decision-tradeoff="con"]')
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(proBackground).not.toBe(conBackground);
    }
  });
});
