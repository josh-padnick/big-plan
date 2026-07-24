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

  await test.step("the reversibility section rates the cost of changing course", async () => {
    await expect(page.locator("[data-decision-reversibility]")).toHaveCount(3);
    const section = openDecision.locator("[data-decision-reversibility]");
    await expect(section).toHaveAttribute(
      "data-reversibility-rating",
      "somewhat-hard",
    );
    await expect(section).toContainText("Somewhat hard to reverse");
    await expect(section).toContainText("The repository layer isolates SQL");
    await expect(
      section.getByText(/Reversibility is what it would cost/),
    ).toBeHidden();
    await section.locator(".big-decision-info > summary").hover();
    await expect(
      section.getByText(/Reversibility is what it would cost/),
    ).toBeVisible();
    await page.mouse.move(0, 0);
  });

  await test.step("importance squares recompute the best-fit option", async () => {
    await expect(
      openDecision.locator("[data-decision-weights-legend]"),
    ).toBeVisible();
    await expect(openDecision.locator("[data-decision-weights]")).toHaveCount(
      4,
    );
    const options = openDecision.locator("thead [data-option]");
    await expect(options.nth(1)).toHaveAttribute("data-best-fit", "");
    await expect(options.nth(1)).toContainText("Best fit");
    const reset = openDecision.locator("[data-decision-weights-reset]");
    await expect(reset).toBeHidden();
    const setupWeights = openDecision
      .locator("[data-decision-weights]")
      .nth(1)
      .locator("button");
    await setupWeights.nth(0).click();
    await expect(options.nth(0)).toHaveAttribute("data-best-fit", "");
    await expect(options.nth(1)).not.toHaveAttribute("data-best-fit", "");
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(options.nth(1)).toHaveAttribute("data-best-fit", "");
    await expect(options.nth(0)).not.toHaveAttribute("data-best-fit", "");
    await expect(reset).toBeHidden();
  });

  await test.step("hovering a dashed criterion term floats its tooltip", async () => {
    const term = openDecision.locator(".big-decision-criterion-help").first();
    await expect(
      term.getByText(/Selection anchors and their threads/),
    ).toBeHidden();
    await term.locator("summary").hover();
    await expect(
      term.getByText(/Selection anchors and their threads/),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(
      term.getByText(/Selection anchors and their threads/),
    ).toBeHidden();
  });

  await test.step("hovering a score's question mark floats its tooltip", async () => {
    const info = openDecision.locator("td .big-decision-info").first();
    await expect(info.getByText(/one atomic write/)).toBeHidden();
    await info.locator("summary").hover();
    await expect(info.getByText(/one atomic write/)).toBeVisible();
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

  await test.step("the decision expands to full screen and restores", async () => {
    const expand = openDecision.locator("[data-decision-expand]");
    await expect(expand).toBeVisible();
    await expand.click();
    const dialog = page.locator("dialog.component-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("table.big-decision-matrix")).toBeVisible();
    await dialog.locator("[data-decision-expand]").click();
    await expect(dialog).toHaveCount(0);
    await expect(
      openDecision.locator("table.big-decision-matrix"),
    ).toBeVisible();
  });

  await test.step("every decision reads without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(bigDecisionViewerUrl);
    await expect(staticPage.locator("[data-big-decision]")).toHaveCount(3);
    await expect(staticPage.locator("[data-score-tone]")).toHaveCount(20);
    await expect(staticPage.locator('[role="radio"]')).toHaveCount(0);
    await expect(
      staticPage.locator("[data-decision-expand]").first(),
    ).toBeHidden();
    await expect(staticPage.locator("[data-decision-weights]")).toHaveCount(0);
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
