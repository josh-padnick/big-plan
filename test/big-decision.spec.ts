// Browser journey for BigDecision's criteria matrix: status pills, verdict
// cells, info disclosures, selection preview, no-JavaScript readability,
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
      "Wait for signed-in identities",
    );
  });

  await test.step("the matrix compares every option across the criteria", async () => {
    const matrix = openDecision.locator("table.big-decision-matrix");
    await expect(matrix).toBeVisible();
    await expect(matrix.locator("tbody th")).toHaveCount(4);
    await expect(matrix.locator("thead [data-option]")).toHaveCount(3);
    await expect(matrix.locator("[data-score-tone]")).toHaveCount(12);
    await expect(
      matrix.locator('[data-score-tone="bad"] [data-lucide="x"]').first(),
    ).toBeVisible();
    await expect(
      matrix
        .locator('[data-score-tone="mixed"] [data-lucide="triangle-alert"]')
        .first(),
    ).toBeVisible();
  });

  await test.step("the reversibility line names the cost of changing course", async () => {
    await expect(page.locator("[data-decision-reversibility]")).toHaveCount(3);
    await expect(
      openDecision.locator("[data-decision-reversibility]"),
    ).toContainText("Moderate.");
  });

  await test.step("an info disclosure expands its cell in place", async () => {
    const info = openDecision.locator(".big-decision-info").first();
    await expect(
      info.getByText(/Selection anchors and their threads/),
    ).toBeHidden();
    await info.locator("summary").click();
    await expect(
      info.getByText(/Selection anchors and their threads/),
    ).toBeVisible();
  });

  await test.step("the recommended option starts selected and one click moves it", async () => {
    const options = openDecision.locator("[data-option]");
    await expect(options.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect(options.nth(0)).toHaveAttribute("data-option-selected", "");
    await options.nth(1).click();
    await expect(options.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(options.nth(0)).toHaveAttribute("aria-checked", "false");
  });

  await test.step("a decided decision keeps its authored outcome unselectable", async () => {
    await expect(decidedDecision.locator("[data-decision-outcome]")).toHaveText(
      "Chosen: Alongside the source plan",
    );
    await expect(decidedDecision.locator('[role="radio"]')).toHaveCount(0);
    await expect(
      decidedDecision.locator(".big-decision-option-muted"),
    ).toHaveCount(1);
    await expect(decidedDecision).toContainText("Tool-owned cache directory");
  });

  await test.step("the details drawer opens below the matrix", async () => {
    const drawer = openDecision.locator("[data-option-details]");
    await expect(drawer).toHaveCount(1);
    await expect(
      drawer.getByText(/The initial schema needs only/),
    ).toBeHidden();
    await drawer.getByText("PostgreSQL details").click();
    await expect(
      drawer.getByText(/The initial schema needs only/),
    ).toBeVisible();
  });

  await test.step("every decision reads without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(bigDecisionViewerUrl);
    await expect(staticPage.locator("[data-big-decision]")).toHaveCount(3);
    await expect(staticPage.locator("[data-score-tone]")).toHaveCount(20);
    await expect(staticPage.locator('[role="radio"]')).toHaveCount(0);
    await expect(staticPage.locator("body")).toContainText(
      "Chosen: Alongside the source plan",
    );
    const staticInfo = staticPage.locator(".big-decision-info").first();
    await staticInfo.locator("summary").click();
    await expect(
      staticInfo.getByText(/Selection anchors and their threads/),
    ).toBeVisible();
    await context.close();
  });

  await test.step("both themes keep pills and verdict icons legible", async () => {
    for (const theme of ["light", "dark"]) {
      const palette = await page
        .locator("[data-big-decision]")
        .first()
        .evaluate((decision, selectedTheme) => {
          document.documentElement.dataset.theme = selectedTheme;
          return [
            ...decision.querySelectorAll(
              ".big-decision-status-pill, .big-decision-recommended-pill",
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
      const goodColor = await page
        .locator(".big-decision-tone-good > svg")
        .first()
        .evaluate((element) => getComputedStyle(element).color);
      const badColor = await page
        .locator(".big-decision-tone-bad > svg")
        .first()
        .evaluate((element) => getComputedStyle(element).color);
      expect(goodColor).not.toBe(badColor);
    }
  });
});
