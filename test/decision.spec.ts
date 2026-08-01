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
    // The "Choose one" label is gone on purpose: a radio group already says
    // choose one, and round 4 counted every such label as weight.
    await expect(decision.locator("[data-decision-choose-label]")).toHaveCount(
      0,
    );
  });

  await test.step("the comparison is a matrix of options over criteria", async () => {
    await expect(columns).toHaveCount(2);
    const criteria = await decision
      .locator("th.decision-criterion")
      .allInnerTexts();
    // "Single source of truth" is authored, but both options score it "One
    // file", so it cannot inform the choice and never renders.
    expect(criteria).toEqual(["Version fidelity", "Works offline"]);
    // Each rendered criterion carries one cell per option, so the grid is
    // complete over exactly the criteria that discriminate.
    await expect(decision.locator("td.decision-cell")).toHaveCount(4);
  });

  await test.step("a verdict is one signal, the word", async () => {
    const firstCell = decision.locator("td.decision-cell").first();
    await expect(firstCell).toContainText("Exact");
    // A glyph and a hue alongside the word were two more marks to process and
    // nothing more to learn, so neither survives.
    await expect(firstCell.locator("svg[data-lucide]")).toHaveCount(0);
    await expect(firstCell.locator("[class*=matrix-tone]")).toHaveCount(0);
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

test("should keep a nested decision's controls out of its parent", async ({
  page,
  nestedDecisionMatrixViewerUrl,
}) => {
  await page.goto(nestedDecisionMatrixViewerUrl);
  const decisions = page.locator("[data-decision-selector]");
  await expect(decisions).toHaveCount(2);
  // The outer decision encloses the inner one, so document order puts the
  // outer first and every one of its queries would otherwise reach inside.
  const outer = decisions.first();
  const inner = decisions.nth(1);

  await test.step("answering the inner decision leaves the outer untouched", async () => {
    await inner
      .locator("th.decision-column")
      .first()
      .locator("[data-decision-choice]")
      .check();
    await inner.locator("[data-decision-confirm]").click();
    await expect(inner.locator("[data-decision-answer]")).toBeVisible();
    // The outer encloses the inner, so a descendant query would find the
    // inner's controls first; the outer's own footer is a direct child.
    const outerFooter = outer.locator("> [data-decision-footer]");
    await expect(outerFooter).toBeVisible();
    await expect(outerFooter.locator("[data-decision-confirm]")).toBeDisabled();
    await expect(
      outerFooter.locator("[data-decision-selection-summary]"),
    ).toContainText("Nothing selected yet");
  });

  await test.step("each decision records exactly its own answer", async () => {
    const queued = await page.evaluate(
      () =>
        (
          window as unknown as {
            bigPlanDecisionAnswers?: ReadonlyArray<{ option: string }>;
          }
        ).bigPlanDecisionAnswers ?? [],
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]?.option).toBe("Inner A");
  });
});

test("should compress to the reader's own words when a proposal wins", async ({
  page,
  decisionViewerUrl,
}) => {
  await page.goto(decisionViewerUrl);
  const decision = page.locator("[data-decision-selector]").first();

  await test.step("the proposal field appears without the viewer script", async () => {
    await page.setContent(await page.content(), {
      waitUntil: "domcontentloaded",
    });
    const scriptless = page.locator("[data-decision-selector]").first();
    await scriptless.locator(".decision-propose-link").click();
    await expect(scriptless.locator("[data-decision-proposal]")).toBeVisible();
  });

  await page.goto(decisionViewerUrl);
  await test.step("confirming a proposal retires the comparison, not the columns", async () => {
    await decision.locator(".decision-propose-link").click();
    await decision
      .locator("[data-decision-proposal-text]")
      .fill("Ship it as an npx-installable package instead.");
    await decision.locator("[data-decision-confirm]").click();
    await expect(decision.locator("[data-decision-answer]")).toBeVisible();
    // The matrix and its rationale are about options the reader rejected.
    await expect(
      decision.locator("[data-decision-compare]").first(),
    ).toBeHidden();
    await expect(decision.locator("[data-decision-explain]")).toBeHidden();
    // The reader's own words stay on screen as the recorded answer.
    await expect(
      decision.locator("[data-decision-proposal-text]"),
    ).toBeVisible();
  });

  await test.step("changing restores the comparison", async () => {
    await decision.locator("[data-decision-change]").click();
    await expect(
      decision.locator("[data-decision-compare]").first(),
    ).toBeVisible();
    await expect(decision.locator("[data-decision-explain]")).toBeVisible();
  });
});
