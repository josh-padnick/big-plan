// Browser tests of Decision's answering journey: reading the comparison
// matrix, picking a column, watching the rationale swap without moving the
// page, proposing an alternative, and confirming. Render-health failures are
// enforced by the fixtures module.

import { boxOf, expect, test } from "./fixtures";

test("should compare, answer, and confirm an open decision", async ({
  page,
  decisionViewerUrl,
}) => {
  await page.goto(decisionViewerUrl);
  const decision = page.locator("[data-decision-selector]").first();
  const columns = decision.locator("th.decision-column");
  const confirm = decision.locator("[data-decision-confirm]");

  await test.step("the question is asked without an open badge", async () => {
    await expect(decision.locator("[data-decision-question]")).toContainText(
      "How does the skill reach the end user's agent?",
    );
    await expect(decision).not.toContainText("Open");
    await expect(
      decision.locator("[data-decision-choose-label]"),
    ).toContainText("Choose one");
  });

  await test.step("the comparison is a matrix of options over criteria", async () => {
    await expect(columns).toHaveCount(2);
    const criteria = await decision
      .locator("th.decision-criterion")
      .allInnerTexts();
    expect(criteria).toEqual([
      "Version fidelity",
      "Single source of truth",
      "Works offline",
    ]);
    // Each criterion row carries one cell per option, so the grid is complete.
    await expect(decision.locator("td.decision-cell")).toHaveCount(6);
  });

  await test.step("every verdict carries a word and a glyph, not colour alone", async () => {
    const firstCell = decision.locator("td.decision-cell").first();
    await expect(firstCell).toContainText("Exact");
    await expect(firstCell.locator("svg[data-lucide]")).toHaveCount(1);
  });

  await test.step("confirming is refused until a column is picked", async () => {
    await expect(confirm).toBeDisabled();
    await expect(
      decision.locator("[data-decision-selection-summary]"),
    ).toContainText("Nothing selected yet");
  });

  await test.step("choosing a column never moves the page", async () => {
    const rationale = decision.locator("[data-decision-rationale]");
    const before = await boxOf(rationale);
    const heights = [before.height];
    for (const index of [0, 1]) {
      await columns.nth(index).locator("[data-decision-choice]").check();
      heights.push((await boxOf(rationale)).height);
    }
    // Layout stability is the point of the single-cell grid: the rationale
    // region is as tall as the tallest panel and never changes.
    expect(new Set(heights).size).toBe(1);
  });

  await test.step("picking a column names the choice and lights the action", async () => {
    await columns.nth(0).locator("[data-decision-choice]").check();
    await expect(
      decision.locator("[data-decision-selection-summary]"),
    ).toContainText("Embedded in the CLI, printed by a new command selected");
    await expect(confirm).toBeEnabled();
    await expect(confirm).toHaveText("Confirm choice");
  });

  await test.step("the keyboard moves between columns", async () => {
    await columns.nth(0).locator("[data-decision-choice]").focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      columns.nth(1).locator("[data-decision-choice]"),
    ).toBeChecked();
  });

  await test.step("a proposal is a link that asks for text before submitting", async () => {
    const proposal = decision.locator("[data-decision-proposal]");
    await expect(proposal).toBeHidden();
    // The reader clicks the link, not the visually hidden radio behind it.
    await decision.locator(".decision-propose-link").click();
    await expect(
      decision.locator("[data-decision-proposal-choice]"),
    ).toBeChecked();
    await expect(proposal).toBeVisible();
    await expect(confirm).toHaveText("Submit proposal");
    await expect(confirm).toBeDisabled();
    await decision
      .locator("[data-decision-proposal-text]")
      .fill("Ship it as an npx-installable package instead.");
    await expect(confirm).toBeEnabled();
  });

  await test.step("confirming compresses the matrix to the chosen column", async () => {
    await columns.nth(0).locator("[data-decision-choice]").check();
    await confirm.click();
    await expect(decision.locator("[data-decision-answer]")).toBeVisible();
    await expect(decision.locator("[data-decision-footer]")).toBeHidden();
    await expect(columns.nth(0)).toBeVisible();
    await expect(columns.nth(1)).toBeHidden();
    await expect(decision.locator("[data-option-proposal]")).toBeHidden();
  });

  await test.step("changing the decision restores every column", async () => {
    await decision.locator("[data-decision-change]").click();
    await expect(decision.locator("[data-decision-answer]")).toBeHidden();
    await expect(columns.nth(1)).toBeVisible();
    await expect(confirm).toBeEnabled();
  });
});

test("should render a decided decision as a record, not a control", async ({
  page,
  decisionViewerUrl,
}) => {
  await page.goto(decisionViewerUrl);
  const decided = page.locator('[data-decision-status="decided"]').first();

  await expect(decided).toContainText("Decided");
  await expect(decided.locator("[data-option-chosen]")).toBeVisible();
  await expect(decided.locator("[data-decision-confirm]")).toHaveCount(0);
  await expect(decided.locator("[data-option-proposal]")).toHaveCount(0);
  await expect(
    decided.locator("[data-decision-choice]").first(),
  ).toBeDisabled();
});
