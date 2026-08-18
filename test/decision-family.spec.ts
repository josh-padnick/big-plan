// Exercises the finalized decision family through its real browser gestures.

import { expect, test } from "./fixtures";

test("should keep component-owned decision lists out of the prose measure", async ({
  page,
  allComponentsViewerUrl,
}) => {
  await page.goto(allComponentsViewerUrl);

  for (const selector of [
    "[data-decision-rows]",
    ".decision-brief-list",
    ".decision-keyed-chooser",
  ]) {
    const list = page.locator(selector).first();
    const geometry = await list.evaluate((element) => {
      const parent = element.parentElement;
      const parentStyle =
        parent === null ? null : window.getComputedStyle(parent);
      return {
        width: element.getBoundingClientRect().width,
        parentWidth: parent?.getBoundingClientRect().width ?? 0,
        parentPadding:
          Number.parseFloat(parentStyle?.paddingLeft ?? "0") +
          Number.parseFloat(parentStyle?.paddingRight ?? "0"),
        maxWidth: getComputedStyle(element).maxWidth,
        itemMargins: Array.from(element.children).map(
          (item) => getComputedStyle(item).margin,
        ),
      };
    });

    expect(geometry.width).toBeCloseTo(
      geometry.parentWidth - geometry.parentPadding,
    );
    expect(geometry.maxWidth).toBe("none");
    expect(geometry.itemMargins).not.toContain("4px 0px");
  }

  const briefLead = page.locator("[data-decision-brief-lead]").first();
  const briefLeadGeometry = await briefLead.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    parentWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
    maxWidth: getComputedStyle(element).maxWidth,
  }));
  expect(briefLeadGeometry.width).toBeCloseTo(briefLeadGeometry.parentWidth);
  expect(briefLeadGeometry.maxWidth).toBe("none");
});

test("should compare, answer, and revise a Decision", async ({
  page,
  decisionViewerUrl,
}) => {
  await page.goto(decisionViewerUrl);
  const card = page.locator("[data-decision-selector]").first();
  await expect(card.locator("[data-decision-rows]")).toBeVisible();
  await expect(card.locator(".decision-row")).toHaveCount(2);
  await expect(card.locator(".decision-card-verdict")).toHaveCount(4);

  const criterion = card.locator(".decision-row-dimension").first();
  const criterionDefinition = criterion.locator(
    '[data-decision-definition="criterion"]',
  );
  await expect(criterionDefinition).toHaveCount(1);
  await criterionDefinition.locator("summary").hover();
  await expect(criterionDefinition).toHaveAttribute("open", "");

  const options = card.locator(".decision-row");
  const [firstBox, secondBox] = await Promise.all([
    options.nth(0).boundingBox(),
    options.nth(1).boundingBox(),
  ]);
  expect(firstBox?.y).toBeCloseTo(secondBox?.y ?? 0);
  expect(firstBox?.x).toBeLessThan(secondBox?.x ?? 0);

  const [recommendedCardStyle, otherCardStyle] = await Promise.all([
    options
      .nth(0)
      .locator(".decision-option-card")
      .evaluate((element) => ({
        backgroundImage: getComputedStyle(element).backgroundImage,
      })),
    options
      .nth(1)
      .locator(".decision-option-card")
      .evaluate((element) => ({
        backgroundImage: getComputedStyle(element).backgroundImage,
      })),
  ]);
  expect(recommendedCardStyle).toEqual(otherCardStyle);

  const recommendationColors = await options
    .nth(0)
    .locator(".decision-recommended-pill")
    .evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--decision-pro-bg)";
      probe.style.color = "var(--decision-pro-c)";
      document.body.append(probe);
      const proStyle = getComputedStyle(probe);
      const pillStyle = getComputedStyle(element);
      const result = {
        pillBackground: pillStyle.backgroundColor,
        pillColor: pillStyle.color,
        proBackground: proStyle.backgroundColor,
        proColor: proStyle.color,
      };
      probe.remove();
      return result;
    });
  expect(recommendationColors.pillBackground).not.toBe(
    recommendationColors.proBackground,
  );
  expect(recommendationColors.pillColor).not.toBe(
    recommendationColors.proColor,
  );

  const summaryColor = await options
    .nth(0)
    .locator(".decision-option-summary")
    .evaluate((element) => {
      const mutedProbe = document.createElement("span");
      mutedProbe.style.color = "var(--color-muted)";
      const inkProbe = document.createElement("span");
      inkProbe.style.color = "var(--color-ink)";
      document.body.append(mutedProbe, inkProbe);
      const result = {
        summary: getComputedStyle(element).color,
        muted: getComputedStyle(mutedProbe).color,
        ink: getComputedStyle(inkProbe).color,
      };
      mutedProbe.remove();
      inkProbe.remove();
      return result;
    });
  expect(summaryColor.summary).not.toBe(summaryColor.muted);
  expect(summaryColor.summary).not.toBe(summaryColor.ink);

  const firstOptionCard = options.nth(0).locator(".decision-option-card");
  await firstOptionCard.hover();
  await expect(firstOptionCard).toHaveCSS("transform", "none");
  await expect(firstOptionCard).not.toHaveCSS("box-shadow", "none");

  await options.nth(0).locator(".decision-option-card").click();
  await expect(card.locator("[data-decision-choice]").first()).toBeChecked();
  await expect(card.locator("[data-decision-confirm]")).toBeEnabled();
  await expect(card.locator("[data-decision-selection-summary]")).toHaveText(
    "Embed it in the CLI selected.",
  );
  await expect(card.locator("[data-decision-confirm]")).toHaveText(
    "Confirm choice",
  );
  await card.locator("[data-decision-confirm]").click();
  await expect(card.locator("[data-decision-answer]")).toBeVisible();
  await card.locator("[data-decision-change]").click();
  await expect(card.locator(".decision-row")).toHaveCount(2);

  await card.locator(".decision-propose-link").click();
  await card
    .locator("[data-decision-proposal-text]")
    .fill("Publish a signed standalone archive.");
  // One question above the field decides what these words are, and each answer
  // brings only its own control: the review's ordinary comment controls, or the
  // same confirm step every other option uses. Nothing bespoke sits between.
  const modeToggle = card.locator("[data-decision-mode-toggle]");
  // The switch is what a reader presses; the input behind it is the state.
  const modeSwitch = card.locator("[data-decision-mode] .decision-mode-switch");
  const proposalField = card.locator("[data-decision-proposal-text]");
  const commentActions = card.locator("[data-decision-comment-actions]");
  // Unchecked is the decision side: answering for yourself is the default, and
  // checking the switch is what hands the words to the agent instead.
  await expect(modeToggle).not.toBeChecked();
  await expect(card.locator("[data-decision-mode]")).toBeVisible();
  await expect(commentActions).toBeHidden();
  await expect(card.getByRole("button", { name: "Submit Now" })).toBeHidden();
  // Cancel is the composer's own exit, so it is reachable in either mode.
  await expect(card.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(card.locator("[data-decision-confirm]")).toBeVisible();
  await expect(proposalField).toHaveAttribute(
    "placeholder",
    "What did you decide?",
  );
  // The question is asked before the typing, not after it.
  const modeBox = await card.locator("[data-decision-mode]").boundingBox();
  const fieldBox = await proposalField.boundingBox();
  expect((modeBox?.y ?? 0) + (modeBox?.height ?? 0)).toBeLessThanOrEqual(
    fieldBox?.y ?? 0,
  );

  await expect(card.locator("[data-decision-confirm]")).toBeEnabled();
  await expect(card.locator("[data-decision-confirm]")).toHaveText(
    "Confirm choice",
  );

  // Checking the switch is comment mode: the review's ordinary comment
  // controls, and none of the confirm step.
  await modeSwitch.click();
  await expect(proposalField).toHaveAttribute(
    "placeholder",
    "Tell the agent how this decision should be changed.",
  );
  await expect(commentActions).toBeVisible();
  const submitNow = card.getByRole("button", { name: "Submit Now" });
  const cancel = card.getByRole("button", { name: "Cancel" });
  await expect(submitNow).toBeVisible();
  await expect(cancel).toBeVisible();
  await expect(card.locator("[data-decision-send-now]")).not.toBeChecked();
  await expect(card.locator("[data-decision-confirm]")).toBeHidden();
  // The switch that decides what Submit Now means sits directly above it, and
  // Cancel is the quiet exit to its left.
  const switchBox = await commentActions.boundingBox();
  const submitBox = await submitNow.boundingBox();
  const cancelBox = await cancel.boundingBox();
  expect((switchBox?.y ?? 0) + (switchBox?.height ?? 0)).toBeLessThanOrEqual(
    submitBox?.y ?? 0,
  );
  expect(cancelBox?.x ?? 0).toBeLessThan(submitBox?.x ?? 0);
  // All of it hangs off the field's right edge.
  const textBox = await proposalField.boundingBox();
  expect(
    Math.abs(
      (submitBox?.x ?? 0) +
        (submitBox?.width ?? 0) -
        ((textBox?.x ?? 0) + (textBox?.width ?? 0)),
    ),
  ).toBeLessThanOrEqual(1);

  await modeSwitch.click();
  await expect(card.locator("[data-decision-confirm]")).toBeVisible();
  await expect(commentActions).toBeHidden();

  await card.locator("[data-decision-proposal-cancel]").click();
  await expect(card.locator("[data-decision-proposal]")).toBeHidden();

  await card.locator(".decision-propose-link").click();
  await card
    .locator("[data-decision-proposal-text]")
    .fill("Publish a signed standalone archive.");
  await card.locator("[data-decision-proposal-text]").press("Escape");
  await expect(card.locator("[data-decision-proposal]")).toBeHidden();
  await expect(card.locator("[data-decision-proposal-choice]")).toBeFocused();
  await expect(card.locator(".decision-propose-link")).toHaveCSS(
    "box-shadow",
    "none",
  );

  await card.locator(".decision-propose-link").click();
  await card
    .locator("[data-decision-proposal-text]")
    .fill("Publish through the repository release.");
  await card.getByRole("button", { name: "Confirm choice" }).click();
  await expect(card.locator("[data-decision-answer]")).toContainText(
    "Publish through the repository release.",
  );
  // A recorded proposal is an option, not an invitation to suggest one: the
  // link retires and the words stand under their own title, with no field left
  // to type in.
  await expect(card.locator(".decision-propose-link")).toBeHidden();
  await expect(card.locator("[data-decision-proposal-title]")).toHaveText(
    "New option",
  );
  await expect(card.locator("[data-decision-proposal-record]")).toHaveText(
    "Publish through the repository release.",
  );
  await expect(card.locator("[data-decision-proposal-text]")).toBeHidden();
  // An answer that stands cannot be re-aimed by flipping the mode underneath
  // it; changing the answer is what reopens that choice - and the field.
  await expect(card.locator("[data-decision-mode-toggle]")).toBeDisabled();
  await card.locator("[data-decision-change]").click();
  await expect(card.locator("[data-decision-mode-toggle]")).toBeEnabled();
  await expect(card.locator(".decision-propose-link")).toBeVisible();
  await expect(card.locator("[data-decision-proposal-title]")).toBeHidden();
  await expect(card.locator("[data-decision-proposal-text]")).toBeVisible();
  await expect(card.locator("[data-decision-proposal-text]")).toHaveValue(
    "Publish through the repository release.",
  );
});

test("should submit a suggestion through the review's own comment controls", async ({
  page,
  decisionViewerUrl,
}) => {
  // Comment mode is the review's comment submission, not a second one built
  // into the card: the "submit right away" switch decides staged or sent, and
  // the rail owns the comment from there.
  await page.goto(decisionViewerUrl);
  const card = page.locator("[data-decision-selector]").first();
  await card.locator(".decision-propose-link").click();
  await card
    .locator("[data-decision-proposal-text]")
    .fill("Publish a signed standalone archive.");
  await expect(card.locator("[data-decision-selection-summary]")).toHaveText(
    "You selected your own approach.",
  );
  // Comment mode is the switched-on side; the default is answering directly.
  await card.locator("[data-decision-mode] .decision-mode-switch").click();

  await card.getByRole("button", { name: "Submit Now" }).click();
  // The comment now holds those words, so the field lets them go.
  await expect(card.locator("[data-decision-proposal-text]")).toHaveValue("");
  // Its thread is nominated onto the composer, so the review draws it beside
  // the field the words came from rather than at the top of the card.
  await expect(card.locator("[data-review-thread-anchor]")).toHaveCount(1);
});

test("should keep decision content readable and script-only controls dormant without JavaScript", async ({
  browser,
  decisionViewerUrl,
  decisionAnalysisViewerUrl,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const decisionPage = await context.newPage();
  await decisionPage.goto(decisionViewerUrl);
  await expect(decisionPage.locator("[data-noscript-notice]")).toBeVisible();
  await expect(
    decisionPage.locator("[data-decision-proposal-cancel]"),
  ).toBeHidden();
  await expect(
    decisionPage.locator("[data-decision-question]").first(),
  ).toBeVisible();

  const analysisPage = await context.newPage();
  await analysisPage.goto(decisionAnalysisViewerUrl);
  await expect(analysisPage.locator("[data-noscript-notice]")).toBeVisible();
  const dormantControls = analysisPage.locator(
    "[data-decision-weight-control], [data-decision-score-control]",
  );
  expect(await dormantControls.count()).toBeGreaterThan(0);
  expect(
    await dormantControls.evaluateAll((controls) =>
      controls.every((control) => (control as HTMLElement).hidden),
    ),
  ).toBe(true);
  const dormantGroups = analysisPage.locator(
    "[data-decision-weight-group], [data-decision-score-group]",
  );
  expect(await dormantGroups.count()).toBeGreaterThan(0);
  expect(
    await dormantGroups.evaluateAll((groups) =>
      groups.every(
        (group) =>
          !group.hasAttribute("role") && !group.hasAttribute("aria-label"),
      ),
    ),
  ).toBe(true);
  await expect(
    analysisPage.locator("[data-decision-weight-output]").first(),
  ).toBeVisible();
  await expect(
    analysisPage.locator("[data-decision-score-output]").first(),
  ).toBeVisible();

  await context.close();
});

test("should keep long Decision verdicts inside comparison cards", async ({
  page,
  decisionViewerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(decisionViewerUrl);
  const card = page.locator(".decision-option-card").first();
  const verdict = card.locator("[data-decision-verdict]").first();
  await verdict.evaluate((element) => {
    element.textContent =
      "Requires-a-longer-review-before-the-team-can-approve-this-option";
  });

  const layout = await card.evaluate((element) => {
    const verdictElement = element.querySelector("[data-decision-verdict]");
    if (!(verdictElement instanceof HTMLElement)) {
      throw new Error("Decision verdict is missing.");
    }
    const cardBounds = element.getBoundingClientRect();
    const verdictBounds = verdictElement.getBoundingClientRect();
    const lineHeight = Number.parseFloat(
      getComputedStyle(verdictElement).lineHeight,
    );
    return {
      cardClientWidth: element.clientWidth,
      cardScrollWidth: element.scrollWidth,
      cardRight: cardBounds.right,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      verdictHeight: verdictBounds.height,
      verdictRight: verdictBounds.right,
      lineHeight,
    };
  });

  expect(layout.cardScrollWidth).toBeLessThanOrEqual(layout.cardClientWidth);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(
    layout.documentClientWidth,
  );
  expect(layout.verdictRight).toBeLessThanOrEqual(layout.cardRight);
  expect(layout.verdictHeight).toBeGreaterThan(layout.lineHeight);
});

test("should stack Decision option cards in the same order on a narrow screen", async ({
  page,
  decisionViewerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(decisionViewerUrl);
  const options = page.locator("[data-decision-selector] .decision-row");
  const [firstBox, secondBox] = await Promise.all([
    options.nth(0).boundingBox(),
    options.nth(1).boundingBox(),
  ]);

  expect(firstBox?.x).toBeCloseTo(secondBox?.x ?? 0);
  expect(firstBox?.y).toBeLessThan(secondBox?.y ?? 0);
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
  const briefOptions = first.locator(".decision-brief-option");
  const [recommendedOptionStyle, otherOptionStyle] = await Promise.all([
    briefOptions.nth(0).evaluate((element) => ({
      backgroundColor: getComputedStyle(element).backgroundColor,
    })),
    briefOptions.nth(1).evaluate((element) => ({
      backgroundColor: getComputedStyle(element).backgroundColor,
    })),
  ]);
  expect(recommendedOptionStyle).toEqual(otherOptionStyle);
  await briefOptions.first().hover();
  await expect(briefOptions.first()).not.toHaveCSS("box-shadow", "none");
  await first.locator("[data-decision-choice]").first().check();
  await expect(briefOptions.first()).not.toHaveCSS("box-shadow", "none");
  await first.locator("[data-decision-confirm]").click();
  await expect(first.locator("[data-decision-answer]")).toBeVisible();
  await first.locator("[data-decision-change]").click();
  await expect(first.locator("[data-decision-footer]")).toBeVisible();

  await first.locator(".decision-propose-link").click();
  await first
    .locator("[data-decision-proposal-text]")
    .fill("Keep the current rollout path.");
  await first.locator("[data-decision-proposal-text]").press("Escape");
  await expect(first.locator("[data-decision-proposal]")).toBeHidden();
  await expect(first.locator("[data-decision-proposal-choice]")).toBeFocused();
  await expect(first.locator(".decision-propose-link")).toHaveCSS(
    "box-shadow",
    "none",
  );
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
    weighted.getByRole("radiogroup", { name: "Impact of Integrity" }),
  ).toBeVisible();
  await expect(
    weighted.getByRole("radiogroup", {
      name: "Score PostgreSQL on Integrity",
    }),
  ).toBeVisible();
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
