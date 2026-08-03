// Exercises the finalized decision family through its real browser gestures.

import { expect, test } from "./fixtures";

test("should answer and revise a compact Decision", async ({
  page,
  decisionViewerUrl,
}) => {
  await page.goto(decisionViewerUrl);
  const card = page.locator("[data-decision-selector]").first();
  await expect(card.locator("[data-decision-rows]")).toBeVisible();
  await expect(card.locator(".decision-row")).toHaveCount(2);

  await card.locator("[data-decision-choice]").first().check();
  await expect(card.locator("[data-decision-confirm]")).toBeEnabled();
  await card.locator("[data-decision-confirm]").click();
  await expect(card.locator("[data-decision-answer]")).toBeVisible();
  await card.locator("[data-decision-change]").click();
  await expect(card.locator(".decision-row")).toHaveCount(2);

  await card.locator(".decision-propose-link").click();
  await card
    .locator("[data-decision-proposal-text]")
    .fill("Publish a signed standalone archive.");
  await expect(card.locator("[data-decision-confirm]")).toBeEnabled();
  await card.locator("[data-decision-proposal-cancel]").click();
  await expect(card.locator("[data-decision-proposal]")).toBeHidden();
});

test("should batch three independent QuickDecisions without comparison", async ({
  page,
  quickDecisionViewerUrl,
}) => {
  await page.goto(quickDecisionViewerUrl);
  const cards = page.locator("[data-decision-layout=brief]");
  await expect(cards).toHaveCount(3);
  await expect(cards.locator(".decision-brief-compare")).toHaveCount(0);

  const first = cards.first();
  await first.locator("[data-decision-choice]").first().check();
  await first.locator("[data-decision-confirm]").click();
  await expect(first.locator("[data-decision-answer]")).toBeVisible();
  await first.locator("[data-decision-change]").click();
  await expect(first.locator("[data-decision-footer]")).toBeVisible();
});

test("should audit, choose, and recalculate DecisionAnalysis", async ({
  page,
  decisionAnalysisViewerUrl,
  weightedAuditDecisionAnalysisViewerUrl,
}) => {
  await page.goto(decisionAnalysisViewerUrl);
  const analyses = page.locator("[data-decision-layout=matrix]");
  await expect(analyses).toHaveCount(3);

  const audit = analyses.nth(0);
  await expect(audit).toHaveAttribute("data-decision-interaction", "audit");
  await expect(audit.locator("[data-decision-choice]")).toHaveCount(0);
  const definition = audit.locator("[data-decision-definition=value]").first();
  await definition.locator("summary").hover();
  await expect(definition).toHaveAttribute("open", "");

  const enabled = analyses.nth(1);
  await enabled.locator("[data-decision-choice]").first().check();
  await enabled.locator("[data-decision-confirm]").click();
  await expect(enabled.locator("[data-decision-answer]")).toBeVisible();
  await enabled.locator("[data-decision-change]").click();
  await enabled.locator("[data-decision-choice]").nth(1).check();
  await expect(enabled.locator("[data-decision-choice]").nth(1)).toBeChecked();

  const weighted = analyses.nth(2);
  await expect(
    weighted.locator("table.decision-matrix-keyed > tbody > tr"),
  ).toHaveCount(7);
  const weightedChoice = weighted.locator("[data-decision-choice]").first();
  const weightedCell = weighted
    .locator('.decision-cell[data-decision-column="0"]')
    .first();
  const weightedHeader = weighted
    .locator('.decision-column[data-decision-column="0"]')
    .first();
  const weightedTotal = weighted
    .locator('.decision-score-total[data-decision-column="0"]')
    .first();
  await weightedChoice.check();
  await expect(weightedTotal).toHaveAttribute("data-column-selected", "");
  const [cellBackground, headerBackground, totalBackground] = await Promise.all(
    [
      weightedCell.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
      weightedHeader.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
      weightedTotal.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ],
  );
  expect(headerBackground).toBe(cellBackground);
  expect(totalBackground).toBe(cellBackground);
  expect(totalBackground).not.toBe("rgba(0, 0, 0, 0)");
  const total = weighted.locator("[data-decision-percent]").first();
  const before = await total.textContent();
  await weighted
    .locator("[data-decision-score-group]")
    .first()
    .locator('[data-score-value="1"]')
    .click();
  await expect(total).not.toHaveText(before ?? "");
  await weighted
    .locator("[data-decision-weight-group]")
    .first()
    .locator('[data-weight-value="1"]')
    .click();
  await weighted.locator(".decision-score-breakdown > summary").click();
  await expect(weighted.locator(".decision-calculation-matrix")).toBeVisible();

  await page.goto(weightedAuditDecisionAnalysisViewerUrl);
  const weightedAudit = page
    .locator('[data-decision-scoring="weighted"]')
    .first();
  await expect(weightedAudit).toHaveAttribute(
    "data-decision-interaction",
    "audit",
  );
  await expect(weightedAudit.locator("[data-decision-choice]")).toHaveCount(0);
  const auditTotal = weightedAudit.locator("[data-decision-percent]").first();
  const auditBefore = await auditTotal.textContent();
  await weightedAudit
    .locator("[data-decision-score-group]")
    .first()
    .locator('[data-score-value="1"]')
    .click();
  await expect(auditTotal).not.toHaveText(auditBefore ?? "");
});

test("should isolate nested weighted DecisionAnalysis calculations", async ({
  page,
  nestedWeightedDecisionAnalysisViewerUrl,
}) => {
  await page.goto(nestedWeightedDecisionAnalysisViewerUrl);
  const analyses = page.locator('[data-decision-scoring="weighted"]');
  await expect(analyses).toHaveCount(2);

  const outer = analyses.first();
  const inner = analyses.last();
  const innerPercent = inner
    .locator(":scope > .decision-fieldset [data-decision-percent]")
    .first();
  const innerBefore = await innerPercent.textContent();

  await outer
    .locator(":scope > .decision-fieldset [data-decision-weight-group]")
    .first()
    .locator('[data-weight-value="1"]')
    .click();

  await expect(
    outer
      .locator(":scope > .decision-fieldset [data-decision-max-total]")
      .first(),
  ).toHaveText("100 max");
  await expect(
    inner
      .locator(":scope > .decision-fieldset [data-decision-max-total]")
      .first(),
  ).toHaveText("120 max");
  await expect(innerPercent).toHaveText(innerBefore ?? "");
});

test("should preserve native listitem and rowheader roles on review targets", async ({
  page,
  decisionViewerUrl,
  quickDecisionViewerUrl,
  decisionAnalysisViewerUrl,
}) => {
  await page.goto(decisionViewerUrl);
  const decisionRows = page.locator("[data-decision-rows]").first();
  await expect(decisionRows.getByRole("listitem")).toHaveCount(2);
  await expect(
    decisionRows
      .getByRole("listitem")
      .first()
      .locator('[data-decision-element="consideration"]'),
  ).toHaveCount(2);

  await page.goto(quickDecisionViewerUrl);
  const quickOptions = page
    .locator("[data-decision-component=QuickDecision]")
    .first()
    .locator(".decision-brief-list");
  await expect(quickOptions.getByRole("listitem")).toHaveCount(2);

  await page.goto(decisionAnalysisViewerUrl);
  const matrix = page
    .locator("[data-decision-component=DecisionAnalysis]")
    .first()
    .locator(".decision-matrix-keyed");
  const rowHeader = matrix
    .getByRole("rowheader", {
      name: "Criterion: Anchor integrity. Review target.",
    })
    .first();
  await expect(rowHeader).toHaveAttribute(
    "data-decision-anchor",
    "component/DecisionAnalysis#1/criterion/anchor-integrity",
  );
});

test("should comment on each Decision-family component and a meaningful child", async ({
  page,
  decisionViewerUrl,
  quickDecisionViewerUrl,
  decisionAnalysisViewerUrl,
}) => {
  const commentOn = async ({
    target,
    body,
  }: {
    readonly target: ReturnType<typeof page.locator>;
    readonly body: string;
  }) => {
    await target.focus();
    await expect(target).toHaveAttribute("data-decision-selected", "");
    await page
      .locator('.flow-diagram-actionbar [data-flow-action="comment"]')
      .click();
    const compose = page.locator(".flow-diagram-compose");
    await compose.locator("textarea").fill(body);
    await compose.getByRole("button", { name: "Comment", exact: true }).click();
    const marker = target.locator(":scope > [data-decision-comment-marker]");
    await expect(marker).toBeVisible();
    const [targetBox, markerBox] = await Promise.all([
      target.boundingBox(),
      marker.boundingBox(),
    ]);
    if (targetBox === null || markerBox === null) {
      throw new Error(
        "Expected the comment marker and its anchor to be laid out",
      );
    }
    const topInset = markerBox.y - targetBox.y;
    const rightInset =
      targetBox.x + targetBox.width - markerBox.x - markerBox.width;
    expect(topInset).toBeGreaterThanOrEqual(0);
    expect(topInset).toBeLessThanOrEqual(8);
    expect(rightInset).toBeGreaterThanOrEqual(0);
    expect(rightInset).toBeLessThanOrEqual(8);
  };

  await test.step("comment on a Decision and one option", async () => {
    await page.goto(decisionViewerUrl);
    const card = page.locator("[data-decision-component=Decision]").first();
    const option = card.locator('[data-decision-element="option"]').first();
    await commentOn({ target: card, body: "Clarify the whole decision." });
    await commentOn({ target: option, body: "Prefer this rollout option." });
    await expect(card.locator(".flow-collector")).toBeVisible();
    await expect(card.locator(".flow-collector-item")).toHaveCount(2);
  });

  await test.step("comment on a QuickDecision and one option", async () => {
    await page.goto(quickDecisionViewerUrl);
    const card = page
      .locator("[data-decision-component=QuickDecision]")
      .first();
    const option = card.locator('[data-decision-element="option"]').first();
    await commentOn({ target: card, body: "State the deadline." });
    await commentOn({ target: option, body: "Explain the rollback path." });
    await expect(card.locator(".flow-collector-item")).toHaveCount(2);
  });

  await test.step("comment on an analysis criterion and matrix cell", async () => {
    await page.goto(decisionAnalysisViewerUrl);
    const card = page
      .locator("[data-decision-component=DecisionAnalysis]")
      .first();
    const criterion = card
      .locator('[data-decision-element="criterion"]')
      .first();
    const cell = card.locator('[data-decision-element="cell"]').first();
    await commentOn({ target: criterion, body: "Define this criterion." });
    await commentOn({ target: cell, body: "Recheck this comparison." });
    await expect(card.locator(".flow-collector-item")).toHaveCount(2);
  });
});

test("should preserve Decision drafts across retarget and collapse and hand off stable addresses", async ({
  page,
  decisionViewerUrl,
}) => {
  await page.goto(decisionViewerUrl);
  const card = page.locator("[data-decision-component=Decision]").first();
  const options = card.locator('[data-decision-element="option"]');
  const first = options.first();
  const second = options.nth(1);
  const firstAnchor = await first.getAttribute("data-decision-anchor");

  await first.click();
  await page
    .locator('.flow-diagram-actionbar [data-flow-action="comment"]')
    .click();
  await page
    .locator(".flow-diagram-compose textarea")
    .fill("Keep this unfinished note when retargeting.");
  await second.click();
  await page
    .locator('.flow-diagram-actionbar [data-flow-action="comment"]')
    .click();
  await expect(first.locator("[data-decision-comment-marker]")).toBeVisible();

  await page
    .locator(".flow-diagram-compose textarea")
    .fill("Keep this unfinished note when collapsing.");
  await card.evaluate((element) => {
    element.hidden = true;
  });
  await expect(card).toBeHidden();
  await expect(page.locator(".flow-diagram-compose")).toBeHidden();
  await card.evaluate((element) => {
    element.hidden = false;
  });
  await expect(second.locator("[data-decision-comment-marker]")).toBeVisible();

  await page.evaluate(() => {
    const batches: Array<unknown> = [];
    Reflect.set(globalThis, "__decisionFeedbackBatches", batches);
    Reflect.set(globalThis, "bigPlan", {
      feedback: {
        add: (batch: unknown) => batches.push(batch),
      },
    });
  });
  await card.locator(".flow-collector-add").last().click();
  const batches = await page.evaluate(() =>
    Reflect.get(globalThis, "__decisionFeedbackBatches"),
  );
  expect(batches).toEqual([
    expect.objectContaining({
      source: "decision-family",
      component: "Decision",
      anchor: "component/Decision#1",
      items: [
        expect.objectContaining({
          anchor: firstAnchor,
          body: "Keep this unfinished note when retargeting.",
        }),
        expect.objectContaining({
          body: "Keep this unfinished note when collapsing.",
        }),
      ],
    }),
  ]);

  await page.reload();
  await expect(
    page
      .locator("[data-decision-component=Decision]")
      .first()
      .locator('[data-decision-element="option"]')
      .first(),
  ).toHaveAttribute("data-decision-anchor", firstAnchor ?? "");
});

test("should expose Decision review hover, focus, active, and comment presence in light and dark", async ({
  page,
  quickDecisionViewerUrl,
}) => {
  await page.goto(quickDecisionViewerUrl);
  const card = page.locator("[data-decision-component=QuickDecision]").first();
  const option = card.locator('[data-decision-element="option"]').first();

  for (const theme of ["light", "dark"]) {
    await test.step(`${theme} review states`, async () => {
      await page.evaluate((value) => {
        document.documentElement.dataset["theme"] = value;
      }, theme);
      await option.hover();
      await expect(option).toHaveAttribute("data-decision-hovered", "");
      expect(
        await option.evaluate((element) => getComputedStyle(element).boxShadow),
      ).not.toBe("none");

      await option.click();
      await expect(option).toHaveAttribute("data-decision-selected", "");
      const comment = page.locator(
        '.flow-diagram-actionbar [data-flow-action="comment"]',
      );
      await comment.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(comment).toBeFocused();
      await expect(comment).toHaveCSS("outline-style", "solid");
      await comment.hover();
      await comment.click();
      await page
        .locator(".flow-diagram-compose textarea")
        .fill(`${theme} comment presence`);
      await page
        .locator(".flow-diagram-compose")
        .getByRole("button", { name: "Comment", exact: true })
        .click();
      await expect(
        option.locator("[data-decision-comment-marker]"),
      ).toBeVisible();
    });
  }
});
