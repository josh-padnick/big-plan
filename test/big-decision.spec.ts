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

  await test.step("touch opens floating details on the first tap", async () => {
    const info = openDecision.locator(".big-decision-criterion-help").first();
    await info.evaluate((details) => {
      details.dispatchEvent(
        new PointerEvent("pointerenter", { pointerType: "touch" }),
      );
      details
        .querySelector("summary")
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
    });
    await expect(info).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
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
    await expect(info.locator(".big-decision-info-body")).not.toHaveAttribute(
      "role",
      "tooltip",
    );
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

  await test.step("floating details follow horizontal matrix scrolling", async () => {
    const scroller = openDecision.locator(".overflow-x-auto").first();
    const info = openDecision.locator(".big-decision-criterion-help").first();
    const summary = info.locator("summary");
    const body = info.locator(".big-decision-info-body");
    const matrix = scroller.locator("table");
    await matrix.evaluate((element) => {
      element.style.minWidth = "80rem";
    });
    await summary.focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
    await expect(info).toHaveAttribute("open", "");
    const initialLeft = await body.evaluate((element) =>
      Number.parseFloat(element.style.left),
    );
    const initialAnchorLeft = await summary.evaluate(
      (element) => element.getBoundingClientRect().left,
    );
    await scroller.evaluate((element) => {
      element.scrollLeft = 100;
    });
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollLeft))
      .toBe(100);
    await expect
      .poll(() =>
        summary.evaluate((element) => element.getBoundingClientRect().left),
      )
      .toBeLessThan(initialAnchorLeft);
    await expect
      .poll(() =>
        body.evaluate((element) => Number.parseFloat(element.style.left)),
      )
      .toBeLessThan(initialLeft);
    await page.keyboard.press("Escape");
    await matrix.evaluate((element) => {
      element.style.removeProperty("min-width");
    });
  });

  await test.step("floating details scroll long explanations", async () => {
    const info = openDecision.locator(".big-decision-criterion-help").first();
    const body = info.locator(".big-decision-info-body");
    await body.evaluate((element) => {
      const spacer = document.createElement("div");
      spacer.dataset.tallInfoTest = "";
      spacer.style.height = "150vh";
      element.append(spacer);
    });
    await info.locator("summary").focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
    const dimensions = await body.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.overflowY).toBe("auto");
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => body.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await body.locator("[data-tall-info-test]").evaluate((spacer) => {
      spacer.remove();
    });
  });

  await test.step("full-screen view scrolls tall decisions", async () => {
    await openDecision.evaluate((decision) => {
      const spacer = document.createElement("div");
      spacer.dataset.tallDecisionTest = "";
      spacer.style.height = "150vh";
      decision.append(spacer);
    });
    await openDecision.locator("[data-decision-expand]").click();
    const dialog = page.locator("dialog.component-dialog");
    await expect(dialog).toBeVisible();
    const dimensions = await openDecision.evaluate((decision) => ({
      clientHeight: decision.clientHeight,
      overflowY: getComputedStyle(decision).overflowY,
      scrollHeight: decision.scrollHeight,
    }));
    expect(dimensions.overflowY).toBe("auto");
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    await openDecision.evaluate((decision) => {
      decision.scrollTop = decision.scrollHeight;
    });
    await expect
      .poll(() => openDecision.evaluate((decision) => decision.scrollTop))
      .toBeGreaterThan(0);
    await openDecision.locator("[data-decision-expand]").click();
    await expect(dialog).toHaveCount(0);
    await openDecision
      .locator("[data-tall-decision-test]")
      .evaluate((spacer) => {
        spacer.remove();
      });
  });

  await test.step("lifecycle actions are placeholders for the live layer", async () => {
    const actions = openDecision.locator("[data-decision-actions]");
    const note = actions.locator("[data-decision-action-note]");
    await expect(note).toHaveRole("status");
    await expect(note).toHaveAttribute("aria-live", "polite");
    await expect(note).toHaveText("");
    await actions.locator("[data-decision-submit]").click();
    await expect(note).toBeVisible();
    await note.evaluate((status) => {
      status.textContent = "";
    });
    await actions.locator("[data-decision-defer]").click();
    await expect(note).toContainText("later deliverable");
    const suggest = openDecision.locator("[data-decision-suggest]");
    await suggest.click();
    const form = openDecision.locator("[data-decision-suggest-form]");
    await expect(form).toBeVisible();
    await form.locator("input").fill("Managed document store");
    await form.getByRole("button", { name: "Submit" }).click();
    await expect(form).toBeHidden();
    await expect(suggest).toBeVisible();
    await expect(suggest).toBeFocused();
    const suggestNote = openDecision.locator("[data-decision-suggest-note]");
    await expect(suggestNote).toHaveRole("status");
    await expect(suggestNote).toHaveAttribute("aria-live", "polite");
    await expect(suggestNote).toBeVisible();
    await suggest.click();
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(form).toBeHidden();
    await expect(suggest).toBeFocused();
    const decidedNote = decidedDecision.locator("[data-decision-action-note]");
    await expect(decidedNote).toHaveRole("status");
    await decidedDecision.locator("[data-decision-reopen]").click();
    await expect(decidedNote).toContainText("later deliverable");
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

test("should isolate nested decision enhancements", async ({
  page,
  nestedDecisionViewerUrl,
}) => {
  await page.goto(nestedDecisionViewerUrl);
  const decisions = page.locator("[data-big-decision]");
  await expect(decisions).toHaveCount(2);

  for (const decision of await decisions.all()) {
    const ownedState = await decision.evaluate((root) => {
      const owned = (selector: string) =>
        [...root.querySelectorAll(selector)].filter(
          (element) =>
            element.closest("[data-big-decision], [data-small-decision]") ===
            root,
        );
      return {
        actions: owned("[data-decision-actions]").length,
        expandControls: owned("[data-decision-expand]").filter(
          (element) => element instanceof HTMLElement && !element.hidden,
        ).length,
        optionGroups: owned('[data-decision-options][role="radiogroup"]')
          .length,
        scoreRows: owned("[data-decision-score-row]").length,
        suggestControls: owned("[data-decision-suggest]").length,
      };
    });
    expect(ownedState).toEqual({
      actions: 1,
      expandControls: 1,
      optionGroups: 1,
      scoreRows: 1,
      suggestControls: 1,
    });
  }

  await test.step("nested decisions preserve ancestor full-screen state", async () => {
    const outer = page.locator("#decision-which-outer-option-should-win");
    const inner = page.locator("#decision-which-inner-option-should-win");
    await outer.locator(":scope > figcaption [data-decision-expand]").click();
    await expect(page.locator("dialog.component-dialog[open]")).toHaveCount(1);
    await inner.locator(":scope > figcaption [data-decision-expand]").click();
    await expect(page.locator("dialog.component-dialog[open]")).toHaveCount(2);
    await inner.locator(":scope > figcaption [data-decision-expand]").click();
    await expect(page.locator("dialog.component-dialog[open]")).toHaveCount(1);
    await expect(outer).toHaveAttribute("data-decision-expanded", "");
    await outer.locator(":scope > figcaption [data-decision-expand]").click();
    await expect(page.locator("dialog.component-dialog")).toHaveCount(0);
  });
});

test("should withhold Best match when top scores tie", async ({
  page,
  bigDecisionViewerUrl,
}) => {
  await page.goto(bigDecisionViewerUrl);
  const decision = page.locator(
    '[data-big-decision][data-decision-state="open"]',
  );
  const matrix = decision.locator("table.big-decision-matrix");
  await matrix.evaluate((table) => {
    const tones = [
      ["good", "mixed", "mixed"],
      ["mixed", "good", "neutral"],
      ["neutral", "neutral", "neutral"],
      ["neutral", "neutral", "neutral"],
    ];
    for (const [rowIndex, row] of [
      ...table.querySelectorAll(":scope > tbody > tr"),
    ].entries()) {
      for (const [column, tone] of (tones[rowIndex] ?? []).entries()) {
        const cell = row.querySelectorAll(":scope > td")[column];
        if (cell instanceof HTMLElement) {
          cell.dataset.scoreTone = tone;
        }
      }
    }
  });
  await decision
    .locator("[data-decision-weights]")
    .first()
    .locator("button")
    .nth(1)
    .click();

  const scoreRow = decision.locator("[data-decision-score-row]");
  await expect(scoreRow.locator("td")).toHaveText(["+6", "+6", "+2"]);
  await expect(decision.locator("[data-best-match]")).toHaveCount(0);
  await expect(decision.locator(".big-decision-bestmatch")).toHaveCount(0);
  await expect(scoreRow.locator(".big-decision-score-leader")).toHaveCount(0);
  await expect(decision.locator(".big-decision-breakdown-leader")).toHaveCount(
    0,
  );
});
