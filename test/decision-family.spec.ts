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
