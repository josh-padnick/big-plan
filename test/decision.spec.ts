// Browser tests of Decision's answering journey: reading the comparison,
// opening one option's reasoning, picking with the keyboard, proposing an
// alternative, and confirming. Render-health failures are enforced by the
// fixtures module.

import { expect, test } from "./fixtures";

test("should compare, answer, and confirm an open decision", async ({
  page,
  decisionViewerUrl,
}) => {
  await page.goto(decisionViewerUrl);
  const decision = page.locator("[data-decision-selector]").first();
  const options = decision.locator("[data-decision-option]");

  await test.step("the question is asked without an open badge", async () => {
    await expect(decision.locator("[data-decision-question]")).toContainText(
      "How does the skill reach the end user's agent?",
    );
    await expect(decision).not.toContainText("Open");
    await expect(
      decision.locator("[data-decision-choose-label]"),
    ).toContainText("Choose one");
  });

  await test.step("every option compares the same attributes in the same order", async () => {
    const attributeNames = (index: number) =>
      options
        .nth(index)
        .locator("[data-decision-attributes] dt")
        .allInnerTexts();
    const first = await attributeNames(0);
    const second = await attributeNames(1);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  await test.step("reasoning stays collapsed until it is asked for", async () => {
    const details = options.nth(0).locator("[data-option-details]");
    const body = details.locator("div").first();
    await expect(body).toBeHidden();
    await details.locator("summary").click();
    await expect(body).toBeVisible();
  });

  await test.step("confirming is refused until an option is picked", async () => {
    await expect(decision.locator("[data-decision-confirm]")).toBeDisabled();
  });

  await test.step("the keyboard picks an option and lights the confirm action", async () => {
    await options.nth(0).locator("[data-decision-choice]").focus();
    await page.keyboard.press("ArrowDown");
    await expect(
      options.nth(1).locator("[data-decision-choice]"),
    ).toBeChecked();
    await expect(decision.locator("[data-decision-confirm]")).toBeEnabled();
  });

  await test.step("a proposal asks for text before it can be submitted", async () => {
    const proposal = decision.locator("[data-option-proposal]");
    const text = proposal.locator("[data-decision-proposal-text]");
    await expect(text).toBeHidden();
    await proposal.locator("[data-decision-choice]").check();
    await expect(text).toBeVisible();
    await expect(decision.locator("[data-decision-confirm]")).toBeDisabled();
    await expect(decision.locator("[data-decision-confirm]")).toHaveText(
      "Submit proposal",
    );
    await text.fill("Ship it as an npx-installable package instead.");
    await expect(decision.locator("[data-decision-confirm]")).toBeEnabled();
  });

  await test.step("confirming compresses the card to the answer", async () => {
    await options.nth(0).locator("[data-decision-choice]").check();
    await decision.locator("[data-decision-confirm]").click();
    await expect(decision.locator("[data-decision-answer]")).toBeVisible();
    await expect(decision.locator("[data-decision-footer]")).toBeHidden();
    await expect(options.nth(0)).toBeVisible();
    await expect(options.nth(1)).toBeHidden();
  });

  await test.step("changing the decision restores every option", async () => {
    await decision.locator("[data-decision-change]").click();
    await expect(decision.locator("[data-decision-answer]")).toBeHidden();
    await expect(options.nth(1)).toBeVisible();
    await expect(decision.locator("[data-decision-confirm]")).toBeEnabled();
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
