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
  const openDecision = page.locator(
    '[data-big-decision][data-decision-state="open"]',
  );
  const decidedDecision = page.locator(
    '[data-big-decision][data-decision-state="decided"]',
  );
  const deferredDecision = page.locator(
    '[data-big-decision][data-decision-state="deferred"]',
  );

  await test.step("each decision stands alone with its status pill", async () => {
    await expect(decisions).toHaveCount(3);
    await expect(page.locator("[data-decision-status]")).toHaveText([
      "decided",
      "deferred",
    ]);
    await expect(openDecision).toContainText("PostgreSQL");
    await expect(decidedDecision).toContainText("Alongside the source plan");
    await expect(deferredDecision).toContainText(
      "Wait for signed-in identities",
    );
    await expect(openDecision).toHaveAttribute(
      "id",
      "decision-which-persistence-layer-should-back-review-comments",
    );
    await expect(
      openDecision.locator("thead [data-option]").first(),
    ).toHaveAttribute(
      "id",
      "decision-which-persistence-layer-should-back-review-comments-option-postgresql",
    );
  });

  await test.step("the matrix compares every option across the criteria", async () => {
    const matrix = openDecision.locator("table.big-decision-matrix");
    await expect(matrix).toBeVisible();
    await expect(
      matrix.locator("tbody tr:not([data-decision-score-row]) th"),
    ).toHaveCount(4);
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

  await test.step("option markers expose radio semantics without hiding details", async () => {
    const option = openDecision.locator("thead [data-option]").first();
    const control = option.locator("[data-option-control]");
    await expect(control).toHaveRole("radio");
    await expect(control).toHaveAccessibleName("PostgreSQL");
    await expect(control).toHaveAccessibleDescription(
      /relational store the team already operates/,
    );
    await expect(option).not.toHaveAttribute("role", "radio");
    await expect(option.locator("details")).toHaveCount(1);
    await option.click();
    await expect(control).toHaveAttribute("aria-checked", "true");
    await expect(control).toBeFocused();
  });

  await test.step("the reversibility section rates the cost of changing course", async () => {
    await expect(page.locator("[data-decision-reversibility]")).toHaveCount(3);
    const section = openDecision.locator("[data-decision-reversibility]");
    await expect(section).toHaveAttribute(
      "data-reversibility-rating",
      "somewhat-hard",
    );
    await expect(section.getByText("Somewhat hard to reverse")).toBeVisible();
    await expect(section).toContainText("The repository layer isolates SQL");
    await section.locator(".big-decision-info > summary").hover();
    await expect(
      section.getByText(/Reversibility is what it would cost/),
    ).toBeVisible();
    await page.mouse.move(0, 0);
  });

  await test.step("priority squares recompute the Best match section", async () => {
    const section = openDecision.locator("[data-decision-best-match]");
    await expect(section).toContainText("Score");
    await expect(openDecision.locator("[data-decision-weights]")).toHaveCount(
      4,
    );
    const options = openDecision.locator("thead [data-option]");
    await expect(options.nth(1)).toHaveAttribute("data-best-match", "");
    await expect(
      openDecision.locator("[data-option-decorators]").nth(1),
    ).toContainText("Best match");
    const scoreRow = openDecision.locator("[data-decision-score-row]");
    await expect(scoreRow.locator("td")).toHaveText(["+8", "+10", "-4"]);
    await expect(scoreRow.locator("td").nth(1)).toHaveClass(
      /big-decision-score-leader/,
    );
    const setupPriority = openDecision
      .locator("[data-decision-weights]")
      .nth(1)
      .locator("button");
    await setupPriority.nth(0).click();
    await expect(options.nth(0)).toHaveAttribute("data-best-match", "");
    await expect(scoreRow.locator("td")).toHaveText(["+10", "+8", "-6"]);
    await expect(scoreRow.locator("td").nth(0)).toHaveClass(
      /big-decision-score-leader/,
    );
    await section.locator(".card-section-label").click();
    const reset = section.locator("[data-decision-weights-reset]");
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(options.nth(1)).toHaveAttribute("data-best-match", "");
    await expect(reset).toBeHidden();
    await expect(section.locator("summary")).toBeFocused();
  });

  await test.step("priority squares use one arrow-key tab stop", async () => {
    const priority = openDecision
      .locator("[data-decision-weights]")
      .first()
      .locator("button");
    await expect(priority.nth(0)).toHaveAttribute("tabindex", "-1");
    await expect(priority.nth(1)).toHaveAttribute("tabindex", "0");
    await expect(priority.nth(2)).toHaveAttribute("tabindex", "-1");
    await priority.nth(1).focus();
    await page.keyboard.press("ArrowRight");
    await expect(priority.nth(2)).toHaveAttribute("aria-checked", "true");
    await expect(priority.nth(2)).toHaveAttribute("tabindex", "0");
    await expect(priority.nth(2)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(priority.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect(priority.nth(0)).toBeFocused();
    await priority.nth(1).click();
  });

  await test.step("the open Score section shows live arithmetic", async () => {
    const section = openDecision.locator("[data-decision-best-match]");
    const table = section.locator(".big-decision-breakdown");
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr").last()).toContainText("Total");
    await expect(table.locator("tbody tr").last()).toContainText("+10");
    const anchorPriority = openDecision
      .locator("[data-decision-weights]")
      .nth(0)
      .locator("button");
    await anchorPriority.nth(2).click();
    await expect(table.locator("tbody tr").first()).toContainText("×3");
    await expect(table.locator("tbody tr").last()).toContainText("+12");
    await section.locator("[data-decision-weights-reset]").click();
    await expect(table.locator("tbody tr").last()).toContainText("+10");
    await section.locator(".card-section-label").click();
    await expect(table).toBeHidden();
  });

  await test.step("tooltip links remain reachable while focus stays inside", async () => {
    const info = openDecision.locator(".big-decision-criterion-help").first();
    await info.evaluate((details) => {
      const body = details.querySelector(".big-decision-info-body");
      const link = document.createElement("a");
      link.href = "#tooltip-proof";
      link.textContent = "Tooltip proof";
      body?.append(link);
    });
    await info.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(info).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    await expect(
      info.getByRole("link", { name: "Tooltip proof" }),
    ).toBeFocused();
    await expect(info).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    await expect(info).not.toHaveAttribute("open", "");
  });

  await test.step("lifecycle actions are placeholders for the live layer", async () => {
    const actions = openDecision.locator("[data-decision-actions]");
    const note = actions.locator("[data-decision-action-note]");
    await expect(note).toBeHidden();
    await actions.locator("[data-decision-submit]").click();
    await expect(note).toBeVisible();
    const suggest = openDecision.locator("[data-decision-suggest]");
    await suggest.click();
    const form = openDecision.locator("[data-decision-suggest-form]");
    await expect(form).toBeVisible();
    await form.locator("input").fill("Managed document store");
    await form.getByRole("button", { name: "Submit" }).click();
    await expect(form).toBeHidden();
    await expect(suggest).toBeVisible();
    await expect(suggest).toBeFocused();
    await expect(
      openDecision.locator("[data-decision-suggest-note]"),
    ).toBeVisible();
    await suggest.click();
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(form).toBeHidden();
    await expect(suggest).toBeFocused();
    await expect(actions.locator("[data-decision-defer]")).toBeVisible();
    await expect(
      decidedDecision.locator("[data-decision-reopen]"),
    ).toBeVisible();
    await expect(
      deferredDecision.locator("[data-decision-reopen]"),
    ).toBeVisible();
  });

  await test.step("every decision reads without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(bigDecisionViewerUrl);
    await expect(staticPage.locator("[data-big-decision]")).toHaveCount(3);
    await expect(staticPage.locator("[data-score-tone]")).toHaveCount(16);
    await expect(staticPage.locator('[role="radio"]')).toHaveCount(0);
    await expect(
      staticPage.locator("[data-decision-expand]").first(),
    ).toBeHidden();
    await expect(staticPage.locator("[data-decision-weights]")).toHaveCount(0);
    await expect(staticPage.locator("[data-decision-actions]")).toHaveCount(0);
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
