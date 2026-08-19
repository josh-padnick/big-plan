// Critical browser journeys for the React commenting chrome over a static
// rendered document: slide and selection composition, durable staged cards,
// precision component targets, the Feedback rail, and both appearance themes.

import { expect, test } from "./fixtures";

test("should keep the desktop toolbar actions compact and distinct", async ({
  page,
  deckViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(deckViewerUrl);

  const feedback = page.getByRole("button", { name: "Feedback", exact: true });
  const settings = page.getByRole("button", { name: "Open settings" });
  const geometry = await page.evaluate(() => {
    const feedbackButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Feedback",
    );
    const settingsButton = document.querySelector("[data-preferences-open]");
    if (
      !(feedbackButton instanceof HTMLButtonElement) ||
      !(settingsButton instanceof HTMLButtonElement)
    ) {
      throw new Error("The toolbar actions were not rendered");
    }
    const feedbackRect = feedbackButton.getBoundingClientRect();
    const settingsRect = settingsButton.getBoundingClientRect();
    return {
      feedbackHeight: feedbackRect.height,
      settingsHeight: settingsRect.height,
      settingsWidth: settingsRect.width,
      gap: settingsRect.left - feedbackRect.right,
    };
  });

  await expect(feedback).toBeVisible();
  await expect(settings).toBeVisible();
  expect(geometry.settingsHeight).toBe(geometry.feedbackHeight);
  expect(geometry.settingsWidth).toBe(geometry.settingsHeight);
  expect(geometry.gap).toBe(4);
});

test("should place a comment action between copy and maximize for plain code", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);

  const figure = page.locator(".code-figure").last();
  const toolbar = figure.locator(".figure-control-bar");
  await figure.scrollIntoViewIfNeeded();
  await figure.hover();

  const actions = toolbar.getByRole("button");
  await expect(actions).toHaveCount(3);
  await expect(actions.nth(0)).toHaveAccessibleName("Copy code");
  await expect(actions.nth(1)).toHaveAccessibleName(/Comment on/u);
  await expect(actions.nth(2)).toHaveAccessibleName("Maximize code");
});

test("should stage and restore a slide comment through the legacy chrome", async ({
  page,
  deckViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const slide = page.locator("[data-slide]").first();
  const comment = slide.getByRole("button", { name: "Comment on slide" });
  await expect(comment).toBeVisible();
  await expect
    .poll(() =>
      comment.evaluate((node) =>
        Number(getComputedStyle(node.parentElement ?? node).opacity),
      ),
    )
    .toBe(1);

  const tooltip = page.getByRole("tooltip", { name: "Comment on slide" });
  await expect(tooltip).not.toBeVisible();
  await comment.hover();
  await expect(tooltip).toBeVisible();
  await expect(comment).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(tooltip).toHaveCSS("font-size", "11px");
  await expect(tooltip).toHaveCSS("padding-top", "4px");
  await expect(tooltip).toHaveCSS("padding-left", "8px");

  await comment.click();
  await expect(slide).toHaveAttribute("data-review-slide-selected", "");
  const dialog = page.getByRole("dialog", { name: /Comment on/ });
  const input = dialog.getByLabel("Add a comment");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute(
    "placeholder",
    "What should the agent change here?",
  );
  await expect(slide).toHaveCSS("outline-width", "3px");
  await expect(dialog.locator(".review-compose-title")).toHaveCSS(
    "font-size",
    "12px",
  );
  await expect(input).toHaveCSS("font-size", "12px");
  await expect(dialog.locator(".review-compose-hint")).toHaveCSS(
    "font-size",
    "11px",
  );
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const submit = dialog.getByRole("button", { name: "Submit Now" });
  await expect(cancel).toHaveCSS("padding-left", "8px");
  await expect(cancel).toHaveCSS("padding-top", "4px");
  await expect(cancel).toHaveCSS("border-top-width", "1px");
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveCSS("padding-left", "8px");
  await expect(submit).toHaveCSS("font-size", "11px");
  await expect(submit).toHaveCSS("background-color", "rgb(239, 236, 227)");
  await expect(submit).toHaveCSS("color", "rgb(111, 105, 92)");
  await expect(submit).toHaveCSS("border-top-color", "rgb(226, 221, 209)");
  await expect(submit).toHaveCSS("opacity", "1");
  await expect(
    dialog.getByRole("switch", { name: "Submit right away" }).locator("span"),
  ).toHaveCSS("border-top-width", "1px");
  await expect(dialog).toHaveCSS("position", "absolute");
  await expect
    .poll(async () => {
      const [composerBox, commentBox] = await Promise.all([
        dialog.boundingBox(),
        comment.boundingBox(),
      ]);
      if (composerBox === null || commentBox === null) return 0;
      return commentBox.y - (composerBox.y + composerBox.height);
    })
    .toBeGreaterThanOrEqual(12);
  const composerTop = await dialog.evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  await page.evaluate(() => window.scrollBy(0, 160));
  await expect
    .poll(() => dialog.evaluate((node) => node.getBoundingClientRect().top))
    .toBe(composerTop - 160);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await input.fill(
    "Keep `leaseOwner` explicit. <strong>Literal reviewer text</strong>",
  );
  await expect(submit).toBeEnabled();
  const shortcutTooltip = page.getByRole("tooltip").last();
  await expect(shortcutTooltip).not.toBeVisible();
  await submit.hover();
  await expect(shortcutTooltip).toBeVisible();
  await expect(shortcutTooltip).toHaveCSS("font-size", "11px");
  const submitBox = await submit.boundingBox();
  const shortcutBox = await shortcutTooltip.boundingBox();
  if (submitBox === null || shortcutBox === null) {
    throw new Error("Expected visible shortcut trigger and tooltip bounds");
  }
  expect(shortcutBox.y).toBeGreaterThan(submitBox.y + submitBox.height);
  await dialog.getByRole("switch", { name: "Submit right away" }).click();
  await dialog.getByRole("button", { name: "Add Comment" }).click();

  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(rail).not.toBeVisible();
  await expect(slide).toHaveAttribute("data-review-has-comment", "");
  const contextualDraft = page.locator(
    "[data-review-thread-side] .review-staged-card",
  );
  await expect(contextualDraft).toBeVisible();
  await expect(contextualDraft).toContainText("Keep leaseOwner explicit.");
  await expect(contextualDraft.locator(".review-staged-meta")).toHaveCSS(
    "padding",
    "3px 5px",
  );
  await expect(contextualDraft).not.toContainText("STAGED");
  await expect(contextualDraft.locator(".review-staged-target")).toHaveCSS(
    "font-size",
    "11px",
  );
  await expect(contextualDraft.locator(".review-staged-target")).toHaveCSS(
    "color",
    "rgb(111, 105, 92)",
  );
  const inlineToolbarHeight = await contextualDraft
    .locator(".review-staged-meta")
    .evaluate((node) => Math.round(node.getBoundingClientRect().height));

  const feedbackControl = page.getByRole("button", { name: /Feedback/ });
  await feedbackControl.click();
  await expect(rail).toBeVisible();
  await expect(feedbackControl).toHaveCSS("border-top-width", "1px");
  await expect(feedbackControl).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(feedbackControl).not.toHaveCSS("box-shadow", "none");
  const feedbackCount = feedbackControl.getByText("1", { exact: true });
  await expect(feedbackCount).toHaveCSS("width", "20px");
  await expect(feedbackCount).toHaveCSS("height", "20px");
  await expect(feedbackCount).toHaveCSS("padding-left", "4px");
  await expect(feedbackCount).toHaveCSS("background-color", "rgb(22, 101, 52)");
  await rail
    .getByRole("button", { name: /Expand staged comment:/u })
    .first()
    .click();
  const staged = rail.locator(".review-staged-card").first();
  await expect(staged).not.toContainText("STAGED");
  await expect(staged.locator("code")).toHaveText("leaseOwner");
  await expect(staged).toContainText("<strong>Literal reviewer text</strong>");
  await expect(staged.locator("strong")).toHaveCount(0);
  await expect(staged).toHaveCSS("padding", "0px");
  await expect(staged).toHaveCSS("background-color", "rgb(254, 253, 251)");
  await expect(staged.locator(".review-staged-meta")).toHaveCSS(
    "background-color",
    "rgb(236, 231, 219)",
  );
  await expect(staged.locator(".review-staged-meta")).toHaveCSS(
    "padding",
    "3px 5px",
  );
  expect(
    await staged
      .locator(".review-staged-meta")
      .evaluate((node) => Math.round(node.getBoundingClientRect().height)),
  ).toBe(inlineToolbarHeight);
  await expect(staged.locator(".review-staged-target")).toHaveCSS(
    "font-size",
    "12px",
  );
  await expect(
    staged.getByRole("button", { name: "Go to comment location" }),
  ).toHaveCount(0);
  await expect(
    staged.locator(".review-staged-actions button").first(),
  ).toHaveCSS("width", "24px");
  await expect(
    staged.locator(".review-staged-actions button").first().locator("svg"),
  ).toHaveCSS("width", "14px");
  await expect(
    staged.getByRole("button", { name: "Edit staged comment" }).locator("svg"),
  ).toHaveAttribute("stroke-width", "1.8");
  await staged.getByRole("button", { name: "Delete staged comment" }).focus();
  await expect(
    staged.getByRole("button", { name: "Delete staged comment" }),
  ).toHaveCSS("outline-width", "3px");
  const editButton = staged.getByRole("button", {
    name: "Edit staged comment",
  });
  await editButton.hover();
  await expect(editButton).toHaveCSS("background-color", "rgb(239, 236, 227)");
  await expect(editButton).not.toHaveCSS("box-shadow", "none");
  const deleteButton = staged.getByRole("button", {
    name: "Delete staged comment",
  });
  await deleteButton.hover();
  await expect(deleteButton).toHaveCSS("border-top-width", "1px");
  await expect(deleteButton).toHaveCSS("border-color", "rgb(119, 41, 34)");
  await expect(deleteButton).toHaveCSS(
    "background-color",
    "rgb(248, 235, 231)",
  );
  await expect(deleteButton).toHaveCSS("color", "rgb(119, 41, 34)");
  const stagedSubmit = staged.getByRole("button", { name: "Send this" });
  await expect(stagedSubmit).toHaveCSS("padding-left", "8px");
  await expect(stagedSubmit).toHaveCSS("padding-top", "4px");
  await expect(stagedSubmit).toHaveCSS("font-size", "11px");
  await expect(stagedSubmit).toHaveCSS("font-weight", "600");
  await expect(
    rail.getByRole("tab", { name: "Comments" }).locator("svg"),
  ).toHaveCSS("width", "14px");
  await expect
    .poll(() =>
      rail.getByRole("tab", { name: "Comments" }).evaluate((tab) => ({
        color: getComputedStyle(tab, "::after").backgroundColor,
        height: getComputedStyle(tab, "::after").height,
      })),
    )
    .toEqual({ color: "rgb(22, 101, 52)", height: "2px" });
  await expect(rail.getByRole("button", { name: "Close feedback" })).toHaveCSS(
    "height",
    "24px",
  );
  await expect(
    rail.getByRole("tab", { name: "Comments" }).locator("span"),
  ).toHaveCSS("font-size", "11px");
  const sendAll = rail.getByRole("button", {
    name: "Send all comments to agent",
  });
  await expect(sendAll).toHaveCSS("font-size", "12px");
  await expect(sendAll).toHaveCSS("padding-top", "8px");
  await expect(sendAll).toHaveCSS("padding-left", "12px");
  await expect(sendAll).toHaveCSS("font-weight", "600");
  await expect(sendAll).toBeDisabled();
  await expect(rail.locator(".review-feedback-status")).toHaveCSS(
    "border-top-width",
    "1px",
  );
  await expect(rail.locator(".review-feedback-status")).toHaveCSS(
    "padding-top",
    "12px",
  );
  await expect(rail.getByRole("status")).toHaveCSS(
    "color",
    "rgb(111, 105, 92)",
  );
  await expect(rail.getByRole("status")).toHaveCSS("font-size", "12px");
  await expect
    .poll(() =>
      rail
        .locator(".review-feedback-panel")
        .evaluate((node) => node.scrollWidth - node.clientWidth),
    )
    .toBe(0);
  await editButton.click();
  await expect(page.getByRole("dialog", { name: /Comment on/ })).toHaveCount(0);
  const railEdit = staged.getByRole("textbox", { name: "Edit comment" });
  await expect(railEdit).toBeFocused();
  await expect(railEdit).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(
    staged.getByRole("button", { name: "Edit staged comment" }),
  ).toBeVisible();
  await staged.getByRole("button", { name: "Cancel" }).click();
  const openRailIndicator = page.locator(
    "[data-review-thread-side] .review-staged-collapsed-thread",
  );
  await expect(openRailIndicator).toBeVisible();
  await expect(openRailIndicator).toContainText("Staged");
  await openRailIndicator
    .getByRole("button", { name: /Expand comment:/ })
    .click();
  await expect(rail).toBeVisible();
  await expect(
    page.locator(
      "[data-review-thread-side] .review-staged-card[data-review-surface='thread']",
    ),
  ).toBeVisible();

  await rail.getByRole("button", { name: "Close feedback" }).click();
  const threadHost = page.locator("[data-review-thread-side]");
  await expect(threadHost).toHaveCount(1);
  const thread = threadHost.locator(
    ".review-staged-card[data-review-surface='thread']",
  );
  await expect(thread).toContainText("Just now");
  await expect(thread).toHaveCSS("background-color", "rgb(254, 253, 251)");
  await expect(thread.locator(".review-staged-meta")).toHaveCSS(
    "background-color",
    "rgb(236, 231, 219)",
  );
  await expect(thread.locator(".review-staged-target")).toHaveCSS(
    "padding-left",
    "2px",
  );
  await thread.locator(".review-staged-target").click();
  const headerCollapsedThread = page.locator(
    "[data-review-thread-side] .review-staged-collapsed-thread",
  );
  await expect(headerCollapsedThread).toBeVisible();
  await headerCollapsedThread
    .getByRole("button", { name: /Expand comment:/ })
    .click();
  await expect(thread).toBeVisible();
  await expect
    .poll(() =>
      Promise.all([
        slide.evaluate((node) => node.getBoundingClientRect().right),
        threadHost.evaluate((node) => node.getBoundingClientRect().left),
      ]).then(([slideRight, threadLeft]) => slideRight - threadLeft),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      threadHost.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return document.documentElement.clientWidth - rect.right;
      }),
    )
    .toBeGreaterThanOrEqual(23);
  const threadTop = await threadHost.evaluate(
    (node) => node.getBoundingClientRect().top + window.scrollY,
  );
  await thread.hover();
  await expect(slide).toHaveAttribute("data-review-comment-associated", "");
  await expect(slide).toHaveCSS("outline-width", "2px");
  await expect
    .poll(() =>
      threadHost.evaluate(
        (node) => node.getBoundingClientRect().top + window.scrollY,
      ),
    )
    .toBe(threadTop);
  const slideTop = await slide.evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  expect(threadTop - slideTop).toBeGreaterThanOrEqual(11);
  await comment.click();
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const composerRect = await dialog.boundingBox();
      const stagedRect = await threadHost.boundingBox();
      if (composerRect === null || stagedRect === null) return false;
      return (
        composerRect.x + composerRect.width + 12 <= stagedRect.x ||
        stagedRect.x + stagedRect.width + 12 <= composerRect.x ||
        composerRect.y + composerRect.height + 12 <= stagedRect.y ||
        stagedRect.y + stagedRect.height + 12 <= composerRect.y
      );
    })
    .toBe(true);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await thread.getByRole("button", { name: "Edit staged comment" }).click();
  await expect(page.getByRole("dialog", { name: /Comment on/ })).toHaveCount(0);
  const inlineEdit = thread.getByRole("textbox", { name: "Edit comment" });
  await expect(inlineEdit).toBeFocused();
  await expect(
    thread.getByRole("button", { name: "Minimize staged comment" }),
  ).toBeVisible();
  await expect(
    thread.getByRole("button", { name: "Edit staged comment" }),
  ).toBeVisible();
  await expect(
    thread.getByRole("button", { name: "Delete staged comment" }),
  ).toBeVisible();
  await inlineEdit.fill("Discard this edit.");
  await inlineEdit.press("Escape");
  await expect(
    thread.getByRole("textbox", { name: "Edit comment" }),
  ).toHaveCount(0);
  await expect(thread).toContainText("Keep leaseOwner explicit.");
  await thread.getByRole("button", { name: "Edit staged comment" }).click();
  const reopenedEdit = thread.getByRole("textbox", { name: "Edit comment" });
  await reopenedEdit.fill("Keep `leaseOwner` explicit in this card.");
  const editSave = thread.getByRole("button", { name: "Save" });
  await editSave.hover();
  await expect(page.getByRole("tooltip").last()).toBeVisible();
  const editShortcut = await page.evaluate(() =>
    /Mac|iPhone|iPad/u.test(navigator.platform) ? "Meta" : "Control",
  );
  await reopenedEdit.press(`${editShortcut}+Enter`);
  await expect(thread).toContainText("Keep leaseOwner explicit in this card.");
  await expect(thread.locator("code")).toHaveText("leaseOwner");
  const collapseButton = thread.getByRole("button", {
    name: "Minimize staged comment",
  });
  await collapseButton.hover();
  await expect(collapseButton).toHaveCSS(
    "background-color",
    "rgb(239, 236, 227)",
  );
  await expect(collapseButton).not.toHaveCSS("box-shadow", "none");
  await page.evaluate(() => window.scrollBy(0, 200));
  await expect
    .poll(() => threadHost.evaluate((node) => node.getBoundingClientRect().top))
    .toBeLessThanOrEqual(threadTop - 190);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "dark";
  });
  await expect(thread).toHaveCSS("background-color", "rgb(28, 26, 20)");
  await expect(thread.locator(".review-staged-meta")).toHaveCSS(
    "background-color",
    "rgb(36, 33, 25)",
  );
  const restingSubmitBackground = await thread
    .getByRole("button", { name: "Submit Now" })
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await thread.getByRole("button", { name: "Submit Now" }).hover();
  await expect
    .poll(() =>
      thread
        .getByRole("button", { name: "Submit Now" })
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .not.toBe(restingSubmitBackground);
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "light";
  });
  await thread.getByRole("button", { name: "Minimize staged comment" }).click();
  const minimizedThread = page.locator(
    "[data-review-thread-side] .review-staged-collapsed-thread",
  );
  await expect(minimizedThread).toBeVisible();
  await expect(minimizedThread.locator(".review-staged-target")).toHaveCount(0);
  await expect(
    minimizedThread.getByRole("button", {
      name: "Expand comment: Keep `leaseOwner` explicit in this card.",
    }),
  ).toHaveCSS("font-size", "12px");
  await expect(minimizedThread).toHaveCSS(
    "background-color",
    "rgb(254, 253, 251)",
  );
  const minimizedStatus = minimizedThread.getByRole("img", {
    name: "Staged",
  });
  await expect(minimizedStatus).toHaveCSS("color", "rgb(78, 88, 145)");
  await expect(minimizedStatus.locator("svg")).toHaveCount(1);
  await expect(minimizedStatus).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await minimizedStatus.click();
  await expect(thread).toBeVisible();
  await thread.getByRole("button", { name: "Minimize staged comment" }).click();
  const minimizedDelete = minimizedThread.getByRole("button", {
    name: "Delete staged comment",
  });
  await expect(minimizedDelete.locator("svg")).toHaveCount(1);
  await page.mouse.move(0, 0);
  await expect(minimizedDelete.locator("xpath=../..")).toHaveCSS(
    "opacity",
    "0",
  );
  await minimizedThread.hover();
  await expect(minimizedDelete.locator("xpath=../..")).toHaveCSS(
    "opacity",
    "1",
  );
  await page.getByRole("button", { name: /Feedback/ }).click();
  await expect(rail.locator(".review-staged-collapsed-rail")).toHaveCount(0);
  await expect(rail.locator(".review-staged-card")).toHaveCount(1);
  await rail.getByRole("button", { name: "Close feedback" }).click();
  await minimizedThread
    .getByRole("button", {
      name: "Expand comment: Keep `leaseOwner` explicit in this card.",
    })
    .click();
  await expect(thread).toBeVisible();

  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("big-plan:review:drafts:"),
    );
    if (key === undefined) return;
    const drafts = JSON.parse(localStorage.getItem(key) ?? "[]") as Array<{
      createdAt: string;
    }>;
    if (drafts[0] !== undefined)
      drafts[0].createdAt = new Date(Date.now() - 90_000).toISOString();
    localStorage.setItem(key, JSON.stringify(drafts));
  });
  await page.reload();
  await expect(
    page.locator("[data-review-thread-side]").getByText("1m ago"),
  ).toBeVisible();
  const feedback = page.getByRole("button", { name: /Feedback/ });
  await feedback.click();
  await rail.getByRole("button", { name: /Expand staged comment:/u }).click();
  await expect(rail.locator("code")).toHaveText("leaseOwner");
  await expect(rail.getByRole("tab", { name: "Comments" })).toBeVisible();
  await rail.getByRole("tab", { name: "Chat" }).click();
  await expect(rail).toContainText("Plan-wide chat needs the local runtime");
  await expect(rail.getByRole("tab", { name: "Agent" })).toHaveCount(0);

  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (nextTheme) =>
        document.documentElement.setAttribute("data-theme", nextTheme),
      theme,
    );
    await page.keyboard.press("Tab");
    await feedback.focus();
    await expect
      .poll(() =>
        feedback.evaluate((node) => ({
          focused: node.matches(":focus-visible"),
          outline: getComputedStyle(node).outlineStyle,
        })),
      )
      .toEqual({ focused: true, outline: "solid" });
  }
});

test("should remember the submit-right-away choice across new composers", async ({
  page,
  deckViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const slideComments = page.getByRole("button", { name: "Comment on slide" });
  await slideComments.nth(0).click();
  let composer = page.getByRole("dialog", { name: /Comment on/ });
  let preference = composer.getByRole("switch", {
    name: "Submit right away",
  });
  await expect(preference).toHaveAttribute("aria-checked", "true");
  await preference.click();
  await composer.getByRole("button", { name: "Cancel" }).click();

  await slideComments.nth(1).click();
  composer = page.getByRole("dialog", { name: /Comment on/ });
  preference = composer.getByRole("switch", { name: "Submit right away" });
  await expect(preference).toHaveAttribute("aria-checked", "false");
  await preference.click();
  await composer.getByRole("button", { name: "Cancel" }).click();

  await slideComments.nth(2).click();
  await expect(
    page
      .getByRole("dialog", { name: /Comment on/ })
      .getByRole("switch", { name: "Submit right away" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("should replace an empty composer and protect a non-empty draft", async ({
  page,
  deckViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const slides = page.locator("[data-slide]");
  const first = slides.nth(0);
  const second = slides.nth(1);
  await first.getByRole("button", { name: "Comment on slide" }).click();
  // The floating composer can cover a neighboring slide's gutter control;
  // dispatch the replacement transition directly rather than making this
  // lifecycle check depend on the panel's placement.
  await second
    .getByRole("button", { name: "Comment on slide" })
    .dispatchEvent("click");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(first).not.toHaveAttribute("data-review-slide-selected", "");
  await expect(second).toHaveAttribute("data-review-slide-selected", "");

  const composer = page.getByRole("dialog", { name: /Comment on/u });
  const input = composer.getByLabel("Add a comment");
  await input.fill("Keep this draft while I inspect another slide.");
  await input.press("Escape");
  const closeWarning = page.getByRole("alertdialog", {
    name: "Close this comment?",
  });
  await expect(closeWarning).toContainText("Your text will be lost.");
  await closeWarning.getByRole("button", { name: "Keep editing" }).click();
  await expect(input).toHaveValue(
    "Keep this draft while I inspect another slide.",
  );
  await expect(input).toBeFocused();
  await first.getByRole("button", { name: "Comment on slide" }).click();
  const warning = page.getByRole("alertdialog", {
    name: "Finish your draft comment?",
  });
  await expect(warning).toContainText(
    "You have a draft comment that will be lost if you start a new one.",
  );
  await warning.getByRole("button", { name: "Return to draft" }).click();
  await expect(input).toHaveValue(
    "Keep this draft while I inspect another slide.",
  );
  await expect(input).toBeFocused();
  await expect(second).toHaveAttribute("data-review-slide-selected", "");

  await first.getByRole("button", { name: "Comment on slide" }).click();
  await warning.getByRole("button", { name: "Discard" }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(first).toHaveAttribute("data-review-slide-selected", "");
  await expect(second).not.toHaveAttribute("data-review-slide-selected", "");
});

test("should place slide comment controls just outside the upper-right edge", async ({
  page,
  deckViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(deckViewerUrl);

  const card = page.locator('[data-collapsible="slide"]').first();
  const control = card.locator(
    ':scope > [data-collapse-header] > [data-review-slide-host] > button[aria-label="Comment on slide"]',
  );
  const cardBox = await card.boundingBox();
  const buttonBox = await control.boundingBox();
  if (cardBox === null || buttonBox === null) {
    throw new Error("Expected slide card and comment control bounds");
  }

  expect(Math.round(buttonBox.x - (cardBox.x + cardBox.width))).toBe(12);
  expect(Math.round(buttonBox.y - cardBox.y)).toBe(12);

  // The control is ink at rest so it never reads as a chip beside the card;
  // the ground arrives on hover.
  await expect(control).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await control.hover();
  await expect(control).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  // A sub-slide's gutter is the padding its parent card opened around it, not
  // the page margin a slide hangs into, and a sub-slide card is only as wide
  // as its own content. Measuring from that card's own edge scattered the
  // affordance across a column per sub-slide and let it straddle the parent
  // card's edge.
  const subSlides = page.locator('[data-collapsible="subslide"]');
  const count = await subSlides.count();
  expect(count).toBeGreaterThan(1);
  const columns = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const subCard = subSlides.nth(index);
    const parent = subCard.locator(
      'xpath=ancestor::*[@data-collapsible="slide"][1]',
    );
    const subBox = await subCard.boundingBox();
    const parentBox = await parent.boundingBox();
    const subButtonBox = await subCard
      .locator(
        ':scope > [data-collapse-header] > [data-review-slide-host] > button[aria-label="Comment on slide"]',
      )
      .boundingBox();
    if (subBox === null || parentBox === null || subButtonBox === null) {
      throw new Error("Expected sub-slide, parent slide, and control bounds");
    }
    const before = subButtonBox.x - (subBox.x + subBox.width);
    const after =
      parentBox.x + parentBox.width - (subButtonBox.x + subButtonBox.width);
    expect(before).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
    expect(Math.abs(before - after)).toBeLessThanOrEqual(1);
    columns.add(Math.round(subButtonBox.x));
  }
  // Every sub-slide under one slide reads as one column of affordances.
  expect(columns.size).toBe(1);
});

test("should show a sub-slide ordinal once in its comment toolbar", async ({
  page,
  deckViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const subSlide = page.locator('[data-collapsible="subslide"]').first();
  await subSlide.getByRole("button", { name: "Comment on slide" }).click();
  const composer = page.getByRole("dialog", { name: /Comment on/u });
  await composer.getByLabel("Add a comment").fill("Keep this step explicit.");
  await composer.getByRole("switch", { name: "Submit right away" }).click();
  await composer.getByRole("button", { name: "Add Comment" }).click();

  const target = page.locator(
    "[data-review-thread-side] .review-staged-target",
  );
  await expect(target).toHaveText("2.1.1 · The worker");
});

/*
BIG-188. A thread's placement was derived from the anchor's rect without ever
checking that the anchor had been laid out. An anchor inside a collapsed slide
still answers getBoundingClientRect() with an all-zero rect, so the thread was
positioned against the document origin and clamped into the page's left margin
- the opposite side of the screen from the sidebar and the content it belongs
to. Toggling the sidebar is what re-measured, so the same thread was correct
before the toggle and wrong after it.

The assertion is therefore which side the thread is on, not which direction it
lies from its anchor: the earlier overlap check passed while the card sat in
the left margin, because a card at x=24 is still left of the slide's right
edge. Both sidebar states and both anchor states are pinned, because the bug
needed one of each to appear.
*/
test("should keep a comment thread on the right whether the sidebar is open or closed", async ({
  page,
  deckViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const subSlide = page.locator('[data-collapsible="subslide"]').first();
  await subSlide.getByRole("button", { name: "Comment on slide" }).click();
  const composer = page.getByRole("dialog", { name: /Comment on/u });
  await composer
    .getByLabel("Add a comment")
    .fill("This thread belongs on the right.");
  await composer.getByRole("switch", { name: "Submit right away" }).click();
  await composer.getByRole("button", { name: "Add Comment" }).click();

  const threadHost = page.locator("[data-review-thread-side]");
  await expect(threadHost).toHaveCount(1);
  const feedbackControl = page.getByRole("button", { name: /Feedback/u });
  const sidebar = page.getByRole("complementary", { name: "Feedback" });

  const placement = async () =>
    threadHost.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        hidden: node.hidden,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        viewportWidth: document.documentElement.clientWidth,
      };
    });
  /*
  The whole condition is polled, not a proxy for it. A host is appended before
  the frame that positions it and before a sidebar transition settles, so a
  single read can catch it at x=0 or at the position it is leaving. Reporting
  the side as a word keeps a real wrong-side placement failing with the
  coordinate that proves it rather than with a timeout.
  */
  const side = async () => {
    const { hidden, left, right, viewportWidth } = await placement();
    if (hidden) return "hidden";
    if (right > viewportWidth) return `past the page edge at ${right}`;
    return left > viewportWidth / 2 ? "right" : `left, at ${left}`;
  };
  const expectOnTheRight = async () => {
    await expect.poll(side).toBe("right");
  };

  await expectOnTheRight();
  await feedbackControl.click();
  await expect(sidebar).toBeVisible();
  await expectOnTheRight();
  await expect
    .poll(async () => {
      const sidebarLeft = await sidebar.evaluate(
        (node) => node.getBoundingClientRect().left,
      );
      return (await placement()).right <= sidebarLeft;
    })
    .toBe(true);
  await feedbackControl.click();
  await expect(sidebar).not.toBeVisible();
  await expectOnTheRight();

  // Collapsing every section removes the anchor from layout, which is the
  // state that produced the reported screenshot once the sidebar was toggled.
  await page.getByRole("button", { name: "Collapse all sections" }).click();
  const collapsedRow = subSlide.locator(
    'xpath=ancestor::*[contains(concat(" ", @class, " "), " plan-part-group ")][1]',
  );
  await expect(collapsedRow).toBeVisible();
  await expectOnTheRight();
  await feedbackControl.click();
  await expect(sidebar).toBeVisible();
  await expectOnTheRight();
  await feedbackControl.click();
  await expect(sidebar).not.toBeVisible();
  await expectOnTheRight();

  // A thread whose anchor is collapsed away belongs beside the row that now
  // stands in for it, so the reviewer can still see what it is attached to.
  await expect
    .poll(async () => {
      const band = await collapsedRow.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
        };
      });
      const threadTop = await threadHost.evaluate(
        (node) => node.getBoundingClientRect().top + window.scrollY,
      );
      return threadTop >= band.top && threadTop <= band.bottom;
    })
    .toBe(true);
});

/*
BIG-188, the vertical half of the same mistake. A thread remembers how far its
target sat below the card when the comment was made, so a lens re-rendering the
block in place cannot drag the thread off the words it points at. Collapsing
that one slide keeps the card on screen while hiding the target inside it, so
the remembered distance measures a gap nothing occupies any more; applying it
anyway drew the thread far below the collapsed card, beside unrelated content.
Collapsing a single slide is the case worth pinning: collapsing every section
hides the card too, which takes the already-covered rendered-ancestor path.
*/
test("should keep a comment thread level with a card it collapsed after the comment", async ({
  page,
  deckViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // The deepest block inside its card, so a remembered distance that survives
  // the collapse is unmistakable rather than a rounding difference.
  const deepest = await page.evaluate(() => {
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-slide] [data-block-kind='paragraph'], [data-slide] [data-block-kind='list-item']",
      ),
    );
    let best: { blockId: string; collapseId: string; offset: number } | null =
      null;
    for (const block of blocks) {
      const card = block.closest<HTMLElement>("[data-slide]");
      const blockId = block.dataset.blockId;
      const collapseId = card?.dataset.collapseId;
      if (card === null || blockId === undefined || collapseId === undefined) {
        continue;
      }
      const offset =
        block.getBoundingClientRect().top - card.getBoundingClientRect().top;
      if (best === null || offset > best.offset) {
        best = { blockId, collapseId, offset };
      }
    }
    if (best === null) {
      throw new Error("A card must hold an identified block to comment on");
    }
    return best;
  });
  const remembered = deepest.offset;

  const block = page.locator(`[data-block-id="${deepest.blockId}"]`);
  const card = page.locator(
    `[data-slide][data-collapse-id="${deepest.collapseId}"]`,
  );
  await block.scrollIntoViewIfNeeded();
  const quoted = await block.evaluate((element) => {
    const text = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!(text instanceof Text)) return "";
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(18, text.data.length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return selection?.toString() ?? "";
  });
  expect(quoted.trim()).not.toBe("");

  await page.getByRole("button", { name: "Comment on selected text" }).click();
  const composer = page.getByRole("dialog", { name: /Comment on/u });
  await composer
    .getByLabel("Add a comment")
    .fill("This thread belongs beside its card.");
  await composer.getByRole("switch", { name: "Submit right away" }).click();
  await composer.getByRole("button", { name: "Add Comment" }).click();

  const threadHost = page.locator("[data-review-thread-side]");
  await expect(threadHost).toHaveCount(1);
  const pageTop = (locator: typeof threadHost) =>
    locator.evaluate(
      (node) => node.getBoundingClientRect().top + window.scrollY,
    );
  const cardBand = () =>
    card.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY,
      };
    });

  // While the target is on screen the remembered distance is what keeps the
  // thread beside the words it was written about.
  const drop = async () => (await pageTop(threadHost)) - (await cardBand()).top;
  await expect.poll(drop).toBeGreaterThan(remembered - 1);
  const droppedWhileOpen = await drop();

  await card
    .locator(":scope > [data-collapse-header] button[data-collapse-toggle]")
    .click();
  await expect(card).toHaveAttribute("data-collapsed", "");
  await expect(block).toBeHidden();

  // The collapsed card is shorter than the drop the thread was holding, so a
  // thread that keeps holding it lands outside the band asserted below. That
  // is what makes the band the assertion this journey needs.
  const collapsed = await cardBand();
  expect(droppedWhileOpen).toBeGreaterThan(collapsed.bottom - collapsed.top);

  await expect
    .poll(async () => {
      const band = await cardBand();
      const threadTop = await pageTop(threadHost);
      if (threadTop < band.top)
        return `above the card by ${band.top - threadTop}`;
      if (threadTop > band.bottom) {
        return `below the card by ${threadTop - band.bottom}`;
      }
      return "level with the card";
    })
    .toBe("level with the card");

  /*
  Holding the distance while the card is collapsed is half the promise; giving
  it back is the other half. Toggling the sidebar re-runs the positioning
  effect, which is the same re-run an agent reply or a snapshot reconcile
  causes, and the distance cannot be measured again while the target is hidden.
  If the re-run discards it, expanding the card returns the thread to the card's
  top instead of to the words it points at.
  */
  const feedbackControl = page.getByRole("button", { name: /Feedback/u });
  const sidebar = page.getByRole("complementary", { name: "Feedback" });
  await feedbackControl.click();
  await expect(sidebar).toBeVisible();
  await feedbackControl.click();
  await expect(sidebar).not.toBeVisible();

  await card
    .locator(":scope > [data-collapse-header] button[data-collapse-toggle]")
    .click();
  await expect(card).not.toHaveAttribute("data-collapsed", "");
  await expect(block).toBeVisible();

  await expect
    .poll(async () => {
      const restored = await drop();
      if (Math.abs(restored - droppedWhileOpen) <= 1) {
        return "back beside its block";
      }
      return `${Math.round(droppedWhileOpen - restored)} above its block`;
    })
    .toBe("back beside its block");
});

test("should minimize an expanded long comment from the feedback toolbar", async ({
  page,
  deckViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const longComment =
    "Clarify how the retry policy remains safe when processors recover at different rates. " +
    "Keep the explanation grounded in observable queue behavior, operator controls, and explicit failure boundaries. " +
    "Preserve this final verification marker.";
  await page.getByRole("button", { name: "Comment on slide" }).first().click();
  const composer = page.getByRole("dialog", { name: /Comment on/ });
  await composer.getByLabel("Add a comment").fill(longComment);
  await composer.getByRole("switch", { name: "Submit right away" }).click();
  await composer.getByRole("button", { name: "Add Comment" }).click();

  const inlineToolbarHeight = await page
    .locator("[data-review-thread-side] .review-staged-meta")
    .evaluate((node) => Math.round(node.getBoundingClientRect().height));
  await page
    .locator("[data-review-thread-side] .review-staged-card")
    .getByRole("button", { name: "… more" })
    .click();
  await page.getByRole("button", { name: /Feedback/ }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  const compactRow = rail.getByRole("button", {
    name: /Expand staged comment:/u,
  });
  await expect(compactRow).toBeVisible();
  await rail
    .getByRole("button", { name: /Expand staged comment:/u })
    .first()
    .click();
  const railCard = rail.locator(".review-staged-card").first();
  expect(
    await railCard
      .locator(".review-staged-meta")
      .evaluate((node) => Math.round(node.getBoundingClientRect().height)),
  ).toBe(inlineToolbarHeight);
  await expect(
    railCard.getByRole("button", { name: "Go to comment location" }),
  ).toHaveCount(0);
  await expect(
    railCard.getByRole("button", { name: "Minimize comment" }),
  ).toBeVisible();
  await expect(railCard).toContainText("final verification marker");
  await railCard.getByRole("button", { name: "Minimize comment" }).click();
  await expect(compactRow).toBeVisible();
  await expect(rail.locator(".review-staged-card")).toHaveCount(0);
});

test("should preserve a text selection while its compact composer is open", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const block = page
    .locator("[data-slide] [data-block-kind='paragraph']")
    .first();
  await block.scrollIntoViewIfNeeded();
  const selected = await block.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    if (!(text instanceof Text)) return "";
    const quote = text.data.slice(0, 18);
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, quote.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return quote;
  });
  expect(selected).not.toBe("");

  const chip = page.getByRole("button", { name: "Comment on selected text" });
  await expect(chip).toHaveText(/Comment/);
  const visualState = async () =>
    chip.evaluate((button) => {
      const resolveRole = (property: string, role: string): string => {
        const probe = document.createElement("span");
        probe.style.setProperty(property, `var(${role})`);
        document.body.append(probe);
        const value = getComputedStyle(probe).getPropertyValue(property);
        probe.remove();
        return value;
      };
      const style = getComputedStyle(button);
      return {
        background: style.backgroundColor,
        border: style.borderTopColor,
        color: style.color,
        shadow: style.boxShadow,
        roles: {
          accent: resolveRole("color", "--accent-c"),
          accentSoft: resolveRole("color", "--accent-soft-c"),
          edgeStrong: resolveRole("color", "--edge-strong-c"),
          ink: resolveRole("color", "--ink-c"),
          lifted: resolveRole("box-shadow", "--elevation-lifted"),
          raised: resolveRole("box-shadow", "--elevation-raised"),
          surface: resolveRole("color", "--surface-c"),
        },
      };
    });
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "dark";
  });
  const resting = await visualState();
  expect(resting.background).toBe(resting.roles.accentSoft);
  expect(resting.border).toBe(resting.roles.accent);
  expect(resting.color).toBe(resting.roles.accent);
  expect(resting.shadow).toContain(resting.roles.raised);
  await chip.hover();
  const selectionTooltip = page.locator("[data-selection-comment-tooltip]");
  await expect(selectionTooltip).toBeVisible();
  await expect(selectionTooltip).toContainText(/⌃\+⌘\+C|Ctrl\+Alt\+C/u);
  const hovered = await visualState();
  expect(hovered.background).toBe(hovered.roles.accentSoft);
  expect(hovered.border).toBe(hovered.roles.accent);
  expect(hovered.color).toBe(hovered.roles.accent);
  expect(hovered.shadow).toContain(hovered.roles.lifted);
  await expect
    .poll(() =>
      chip.evaluate((button) => {
        const selection = window.getSelection();
        if (selection === null || selection.rangeCount !== 1) return false;
        return (
          button.getBoundingClientRect().bottom <=
          selection.getRangeAt(0).getBoundingClientRect().top
        );
      }),
    )
    .toBe(true);
  const platform = await page.evaluate(() => navigator.platform);
  await page.keyboard.press(
    /Mac|iPhone|iPad/u.test(platform) ? "Control+Meta+c" : "Control+Alt+c",
  );

  const dialog = page.getByRole("dialog", {
    name: /Comment on Selected text in/,
  });
  await expect(dialog).not.toContainText(selected);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          CSS as unknown as {
            highlights?: { has(name: string): boolean };
          }
        ).highlights?.has("big-plan-review-selection"),
      ),
    )
    .toBe(true);
  await dialog.getByLabel("Add a comment").fill("Clarify `leaseOwner` here.");
  await dialog.getByRole("switch", { name: "Submit right away" }).click();
  await dialog.getByRole("button", { name: "Add Comment" }).click();

  await page.getByRole("button", { name: /Feedback/ }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  await rail
    .getByRole("button", { name: /Expand staged comment:/u })
    .first()
    .click();
  await expect(rail.locator("code")).toHaveText("leaseOwner");
  const railCard = rail.locator(".review-staged-card").first();
  const owningSlide = block.locator("xpath=ancestor::*[@data-slide][1]");
  await expect(owningSlide).toHaveAttribute("data-review-has-comment", "");
  await expect(block).not.toHaveAttribute("data-review-has-comment", "");
  await railCard.getByRole("button", { name: "Edit staged comment" }).click();
  const editComment = railCard.getByRole("textbox", {
    name: "Edit comment",
  });
  await expect(editComment).toBeFocused();
  await page.mouse.move(20, 200);
  await expect(owningSlide).toHaveAttribute(
    "data-review-comment-associated",
    "",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          CSS as unknown as {
            highlights?: { has(name: string): boolean };
          }
        ).highlights?.has("big-plan-review-selection-active"),
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  const railCardTop = await railCard.evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  await railCard.hover();
  await expect
    .poll(() => railCard.evaluate((node) => node.getBoundingClientRect().top))
    .toBe(railCardTop);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          CSS as unknown as {
            highlights?: { has(name: string): boolean };
          }
        ).highlights?.has("big-plan-review-selection-active"),
      ),
    )
    .toBe(true);
  await rail.getByRole("button", { name: "Close feedback" }).click();
  const selectionThread = page.locator(
    "[data-review-thread-side] .review-staged-card",
  );
  await selectionThread.hover();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          CSS as unknown as {
            highlights?: { has(name: string): boolean };
          }
        ).highlights?.has("big-plan-review-selection-active"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: /Feedback/ }).click();
  // Reopening the sidebar leaves the page settling under the pointer, so one
  // reading of where the quote sits can already be wrong by the time the
  // pointer arrives. Hover the quote where it currently sits, the way a reader
  // moving a mouse over it does, until its sidebar card reports the
  // association.
  const quotedTextPoint = async () =>
    block.evaluate((element) => {
      const text = document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (!(text instanceof Text)) return null;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(18, text.length));
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
  await expect
    .poll(async () => {
      const point = await quotedTextPoint();
      if (point === null) throw new Error("Expected selected text bounds");
      await page.mouse.move(point.x, point.y);
      return railCard.getAttribute("data-review-associated");
    })
    .toBe("true");
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("big-plan:review:drafts:"),
    );
    return key === undefined ? null : localStorage.getItem(key);
  });
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored ?? "[]")[0]?.target).toMatchObject({
    type: "selection",
    quote: selected,
    start: 0,
    end: selected.length,
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          CSS as unknown as {
            highlights?: { has(name: string): boolean };
          }
        ).highlights?.has("big-plan-review-selection"),
      ),
    )
    .toBe(true);
  const deleteComment = rail.getByRole("button", {
    name: "Delete staged comment",
  });
  await deleteComment.click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: "Delete comment?",
  });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toBeFocused();
  await expect(deleteDialog.getByRole("button", { name: "Cancel" })).toHaveCSS(
    "font-size",
    "14px",
  );
  await page.keyboard.press("Escape");
  await expect(deleteDialog).not.toBeVisible();
  await expect(rail.locator(".review-staged-card")).toHaveCount(1);
  await deleteComment.click();
  await expect(deleteDialog).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(deleteDialog).not.toBeVisible();
  await expect(rail.locator(".review-staged-card")).toHaveCount(0);
});

test("should comment image-only and mixed image selections", async ({
  page,
  imageSelectionViewerUrl,
}) => {
  await page.goto(imageSelectionViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const image = page.locator("[data-block-kind='image']").first();
  const imageComment = image.locator(
    "xpath=following-sibling::*[@data-review-image-host][1]//button",
  );
  await expect(imageComment).toBeVisible();
  await expect(imageComment).toHaveCSS("opacity", "1");
  await expect(imageComment).toHaveCSS("pointer-events", "auto");
  const imageTooltip = page.getByRole("tooltip", { name: "Comment on image" });
  await expect(imageTooltip).not.toBeVisible();
  await imageComment.hover();
  await expect(imageTooltip).not.toBeVisible({ timeout: 250 });
  await expect(imageTooltip).toBeVisible({ timeout: 1_500 });

  await image.evaluate((element) => {
    const range = document.createRange();
    range.selectNode(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const imageChip = page.getByRole("button", {
    name: "Comment on selected text and image",
  });
  await expect(imageChip).toBeVisible();
  await imageChip.click();
  const imageComposer = page.getByRole("dialog", {
    name: /Comment on Selected text and image in/u,
  });
  await expect(imageComposer).toBeVisible();
  await imageComposer.getByLabel("Add a comment").fill("Review this image.");
  await imageComposer
    .getByRole("switch", { name: "Submit right away" })
    .click();
  await imageComposer.getByRole("button", { name: "Add Comment" }).click();

  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });
  const mixed = await image.evaluate((element) => {
    const slide = element.closest("[data-slide]");
    const paragraphs = Array.from(
      slide?.querySelectorAll("p[data-authored-prose]") ?? [],
    );
    const imageParagraph = element.parentElement;
    const startParagraph = paragraphs.find(
      (paragraph) =>
        paragraph !== imageParagraph &&
        (paragraph.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
    );
    const start = startParagraph?.firstChild;
    if (!(start instanceof Text)) return false;
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEndAfter(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return range.intersectsNode(element);
  });
  expect(mixed).toBe(true);
  await expect(imageChip).toBeVisible();
  await imageChip.click();
  await expect(
    page.getByRole("dialog", {
      name: /Comment on Selected text and image in/u,
    }),
  ).toBeVisible();
});

test("should offer selection comments after double-clicking Markdown and component prose", async ({
  page,
  allComponentsViewerUrl,
}) => {
  await page.goto(allComponentsViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const cases = [
    {
      name: "Markdown paragraph",
      target: page.locator("[data-block-kind='paragraph']").first(),
    },
    {
      name: "Markdown list item",
      target: page.locator("[data-block-id] li").first(),
    },
    {
      name: "Markdown table cell",
      target: page.locator("[data-block-kind='table-cell']").first(),
    },
    {
      name: "Quick summary facet",
      target: page.locator("[data-commentable-label='How'] dd").first(),
    },
    {
      name: "Callout body",
      target: page.locator("[data-block-kind='callout'] .callout-body").first(),
    },
  ];
  const selectionComment = page.getByRole("button", {
    name: "Comment on selected text",
  });

  for (const candidate of cases) {
    await test.step(candidate.name, async () => {
      await candidate.target.scrollIntoViewIfNeeded();
      const point = await candidate.target.evaluate((element) => {
        const walker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) =>
              /[\p{L}\p{N}]/u.test(node.textContent ?? "")
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_SKIP,
          },
        );
        const text = walker.nextNode();
        if (!(text instanceof Text)) return null;
        const match = /[\p{L}\p{N}]+/u.exec(text.data);
        if (match === null) return null;
        const range = document.createRange();
        range.setStart(text, match.index);
        range.setEnd(text, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + Math.min(4, rect.width / 2),
          y: rect.top + rect.height / 2,
        };
      });
      if (point === null) throw new Error(`${candidate.name} has no text`);
      await page.mouse.dblclick(point.x, point.y, { delay: 40 });
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .not.toBe("");
      await expect(selectionComment).toBeVisible();
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await expect(selectionComment).toHaveCount(0);
    });
  }
});

test("should offer comments for whole-line and same-slide multi-block selections", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const slideId = await page.evaluate(() => {
    const slide = Array.from(
      document.querySelectorAll<HTMLElement>("[data-slide]"),
    ).find((candidate) => {
      const heading = candidate.querySelector<HTMLElement>(
        "[data-collapse-header] h2, [data-collapse-header] h3",
      );
      const bodyBlock = candidate.querySelector<HTMLElement>(
        "[data-block-kind='paragraph'], [data-block-kind='list-item']",
      );
      return (
        heading?.closest("[data-slide]") === candidate &&
        bodyBlock?.closest("[data-slide]") === candidate
      );
    });
    return slide?.dataset.collapseId ?? null;
  });
  expect(slideId).not.toBeNull();
  const slide = page.locator(
    `[data-slide][data-collapse-id="${slideId ?? "missing"}"]`,
  );
  await slide.scrollIntoViewIfNeeded();
  const wholeHeading = await slide.evaluate((element) => {
    const heading = element.querySelector<HTMLElement>(
      "[data-collapse-header] h2, [data-collapse-header] h3",
    );
    const text =
      heading === null
        ? null
        : document.createTreeWalker(heading, NodeFilter.SHOW_TEXT).nextNode();
    if (!(text instanceof Text) || heading?.parentNode === null) return "";
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEndAfter(heading);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return selection?.toString() ?? "";
  });
  expect(wholeHeading.trim()).not.toBe("");
  const chip = page.getByRole("button", { name: "Comment on selected text" });
  await expect(chip).toBeVisible();

  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(chip).toHaveCount(0);

  const crossBlock = await slide.evaluate((element) => {
    const heading = element.querySelector<HTMLElement>(
      "[data-collapse-header] h2, [data-collapse-header] h3",
    );
    const endBlock = element.querySelector<HTMLElement>(
      "[data-block-kind='paragraph'], [data-block-kind='list-item']",
    );
    const headingText =
      heading === null
        ? null
        : document.createTreeWalker(heading, NodeFilter.SHOW_TEXT).nextNode();
    const endText =
      endBlock === null
        ? null
        : document.createTreeWalker(endBlock, NodeFilter.SHOW_TEXT).nextNode();
    if (!(headingText instanceof Text) || !(endText instanceof Text)) {
      return null;
    }
    const range = document.createRange();
    range.setStart(headingText, 0);
    range.setEnd(endText, Math.min(24, endText.length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return {
      quote: selection?.toString() ?? "",
      startBlockId: heading?.dataset.blockId ?? "",
      endBlockId: endBlock?.dataset.blockId ?? "",
      startSlide:
        heading?.closest<HTMLElement>("[data-slide]")?.dataset.collapseId,
      endSlide:
        endBlock?.closest<HTMLElement>("[data-slide]")?.dataset.collapseId,
      rect: {
        width: range.getBoundingClientRect().width,
        height: range.getBoundingClientRect().height,
      },
    };
  });
  expect(crossBlock).not.toBeNull();
  expect(crossBlock?.quote.trim()).not.toBe("");
  await expect(chip).toBeVisible();
  await chip.click();
  const composer = page.getByRole("dialog", { name: /Comment on/u });
  await composer
    .getByLabel("Add a comment")
    .fill("Keep this heading and context together.");
  await composer.getByRole("switch", { name: "Submit right away" }).click();
  await composer.getByRole("button", { name: "Add Comment" }).click();

  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("big-plan:review:drafts:"),
    );
    return key === undefined ? null : localStorage.getItem(key);
  });
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored ?? "[]")[0]?.target).toMatchObject({
    type: "selection",
    blockId: crossBlock?.startBlockId,
    endBlockId: crossBlock?.endBlockId,
    quote: crossBlock?.quote,
  });
  await expect(slide).toHaveAttribute("data-review-has-comment", "");
  await expect(
    slide
      .locator("[data-collapse-header] h2, [data-collapse-header] h3")
      .first(),
  ).not.toHaveAttribute("data-review-has-comment", "");
});

// Regression: a selection longer than the stored quote limit used to return
// no control at all, so a reviewer who highlighted a little more than a
// paragraph watched the Comment button vanish with nothing said.
test("should offer a comment for a selection longer than the stored quote", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const selectWholeSlide = () =>
    page.evaluate(() => {
      const slide = Array.from(
        document.querySelectorAll<HTMLElement>("[data-slide]"),
      ).find(
        (candidate) =>
          candidate.querySelector("[data-slide]") === null &&
          (candidate.textContent ?? "").length > 500,
      );
      const blocks = Array.from(
        slide?.querySelectorAll<HTMLElement>(
          '[data-block-id]:not([data-block-kind="part"])',
        ) ?? [],
      ).filter((block) => block.closest("[data-slide]") === slide);
      const first = blocks[0];
      const last = blocks.at(-1);
      if (first === undefined || last === undefined) return null;
      const start = document
        .createTreeWalker(first, NodeFilter.SHOW_TEXT)
        .nextNode();
      const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
      let end: Node | null = null;
      let node = walker.nextNode();
      while (node !== null) {
        end = node;
        node = walker.nextNode();
      }
      if (!(start instanceof Text) || !(end instanceof Text)) return null;
      const range = document.createRange();
      range.setStart(start, 0);
      range.setEnd(end, end.data.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return {
        quote: selection?.toString() ?? "",
        slideId: slide?.dataset.collapseId ?? "",
        startBlockId: first.dataset.blockId ?? "",
        endBlockId: last.dataset.blockId ?? "",
      };
    });

  const selected = await selectWholeSlide();
  expect(selected).not.toBeNull();
  // The old ceiling: anything past 400 characters was dropped silently.
  expect((selected?.quote ?? "").length).toBeGreaterThan(400);

  const chip = page.getByRole("button", { name: "Comment on selected text" });
  await expect(chip).toBeVisible();
  await chip.click();
  const composer = page.getByRole("dialog", { name: /Comment on/u });
  await expect(composer).not.toContainText("characters of this highlight");
  await composer.getByLabel("Add a comment").fill("Tighten this whole slide.");
  await composer.getByRole("switch", { name: "Submit right away" }).click();
  await composer.getByRole("button", { name: "Add Comment" }).click();

  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("big-plan:review:drafts:"),
    );
    return key === undefined ? null : localStorage.getItem(key);
  });
  expect(JSON.parse(stored ?? "[]")[0]?.target).toMatchObject({
    type: "selection",
    blockId: selected?.startBlockId,
    endBlockId: selected?.endBlockId,
    quote: selected?.quote,
    isQuoteExcerpt: false,
  });
  await expect(
    page.locator(`[data-slide][data-collapse-id="${selected?.slideId ?? ""}"]`),
  ).toHaveAttribute("data-review-has-comment", "");
});

test("should confirm deleting every staged comment from Comments", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const slides = page.locator("[data-slide]");
  for (const [index, body] of [
    [0, "Clarify ownership."],
    [1, "Name the recovery boundary."],
  ] as const) {
    await slides
      .nth(index)
      .getByRole("button", { name: "Comment on slide" })
      .click();
    const composer = page.getByRole("dialog", { name: /Comment on/u });
    await composer.getByLabel("Add a comment").fill(body);
    const submitRightAway = composer.getByRole("switch", {
      name: "Submit right away",
    });
    if ((await submitRightAway.getAttribute("aria-checked")) === "true") {
      await submitRightAway.click();
    }
    await composer.getByRole("button", { name: "Add Comment" }).click();
  }

  await page.getByRole("button", { name: /Feedback 2/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(
    rail.getByRole("button", { name: /Expand staged comment:/u }),
  ).toHaveCount(2);
  const deleteAll = rail.getByRole("button", {
    name: "Delete all comments",
  });
  await expect(deleteAll.locator("..")).toHaveCSS("margin-top", "12px");
  await expect(deleteAll.locator("svg")).toHaveCount(1);
  await slides
    .first()
    .locator("p")
    .first()
    .evaluate((paragraph) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .not.toBe("");
  await deleteAll.click();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("");
  const deleteDialog = page.getByRole("alertdialog", {
    name: "Delete all comments?",
  });
  await expect(deleteDialog).toContainText(
    "This permanently removes all 2 staged comments.",
  );
  await page.keyboard.press("Escape");
  await expect(deleteDialog).not.toBeVisible();
  await expect(
    rail.getByRole("button", { name: /Expand staged comment:/u }),
  ).toHaveCount(2);

  await deleteAll.click();
  await expect(deleteDialog).toBeFocused();
  await deleteDialog.dispatchEvent("keydown", { key: "Enter", repeat: true });
  await expect(deleteDialog).toBeVisible();
  await expect(
    rail.getByRole("button", { name: /Expand staged comment:/u }),
  ).toHaveCount(2);
  await page.keyboard.press("Enter");
  await expect(deleteDialog).not.toBeVisible();
  await expect(rail.locator(".review-staged-card")).toHaveCount(0);
  await expect(rail.getByRole("status")).toHaveText(
    "All staged comments deleted.",
  );
});

test("should treat QuickSummary as one target without adding table scroll", async ({
  page,
  allComponentsViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(allComponentsViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
  });

  await expect(
    page.locator("[data-block-kind='table-cell']").first(),
  ).toBeVisible();
  await expect(
    page.locator("[data-block-kind='table-column']").first(),
  ).toBeVisible();
  const quickSummary = page.locator("[data-quick-summary]");
  const quickSummaryComment = quickSummary.getByRole("button", {
    name: "Comment on quick summary",
  });
  await expect(quickSummaryComment).toBeVisible();
  // The quick summary keeps the same upper-right comment gutter every other
  // card uses: one closed spacing step outside its own right edge.
  await expect
    .poll(async () => {
      const summaryRect = await quickSummary.boundingBox();
      const buttonRect = await quickSummaryComment.boundingBox();
      return Math.round(
        (buttonRect?.x ?? 0) -
          ((summaryRect?.x ?? 0) + (summaryRect?.width ?? 0)),
      );
    })
    .toBe(11);
  await expect(
    quickSummary.locator("button[data-review-block-button]"),
  ).toHaveCount(0);
  await expect(
    quickSummary.locator("[data-block-kind='quick-summary-facet']"),
  ).toHaveCount(3);
  // A comment control that stands alone rests quieter than one sitting in a
  // control bar: the slide gutter and header forms take the comment-rest
  // colour while a control-bar form keeps the shared muted control colour.
  await expect(quickSummaryComment).toHaveCSS("color", "rgb(138, 130, 116)");
  for (const kind of ["callout", "decision-analysis", "file-tree"] as const) {
    const component = page.locator(`[data-block-kind='${kind}']`).first();
    await expect(component.locator(".review-toolbar-comment")).toBeVisible();
    await expect(component.locator(".review-toolbar-comment")).toHaveCSS(
      "color",
      "rgb(138, 130, 116)",
    );
    await expect(
      component.locator("button[data-review-block-button]"),
    ).toHaveCount(0);
  }
  const controlBarComment = page
    .locator(
      "[data-review-toolbar-host]:not([data-review-toolbar-inline]):not([data-review-toolbar-overlay]) .review-toolbar-comment",
    )
    .first();
  await expect(controlBarComment).toHaveCSS("color", "rgb(79, 74, 63)");
  // The field-bearing protocol cards expose their declared fields as
  // additional comment targets, so the whole-card control is found by its
  // accessible name rather than being the only control in the card.
  for (const [kind, rootName] of [
    ["http-endpoint", "Comment on Http endpoint"],
    ["graphql-operation", "Comment on Graphql operation"],
    ["grpc-method", "Comment on Grpc method"],
  ] as const) {
    const component = page.locator(`[data-block-kind='${kind}']`).first();
    await expect(
      component.getByRole("button", { name: rootName, exact: true }),
    ).toBeVisible();
  }
  const copyControl = page
    .locator("[data-copy-source], [data-copy-code]")
    .first();
  await expect
    .poll(() =>
      copyControl.evaluate((button) =>
        button.previousElementSibling?.matches("[data-review-toolbar-host]"),
      ),
    )
    .toBe(true);
  await quickSummaryComment.click();
  const summaryComposer = page.getByRole("dialog", {
    name: "Comment on Quick summary",
  });
  await expect(summaryComposer).toBeVisible();
  await expect
    .poll(async () => {
      const summaryRect = await quickSummary.boundingBox();
      const composerRect = await summaryComposer.boundingBox();
      return (
        (composerRect?.x ?? 0) -
        ((summaryRect?.x ?? 0) + (summaryRect?.width ?? 0))
      );
    })
    .toBe(-12);
  await summaryComposer.getByRole("button", { name: "Cancel" }).click();
  await expect(quickSummary).not.toHaveAttribute(
    "data-review-slide-selected",
    "",
  );

  const feedback = page.getByRole("button", {
    name: "Feedback",
    exact: true,
  });
  await feedback.click();
  await quickSummary
    .getByRole("button", { name: "Comment on quick summary" })
    .click();
  await expect(summaryComposer).toHaveClass(/review-comment-composer-inline/u);
  await expect
    .poll(async () => {
      const summaryRect = await quickSummary.boundingBox();
      const composerRect = await summaryComposer.boundingBox();
      return {
        leftDelta: Math.abs(
          (summaryRect?.x ?? Number.MAX_VALUE) -
            (composerRect?.x ?? -Number.MAX_VALUE),
        ),
        width: composerRect?.width ?? Number.MAX_VALUE,
      };
    })
    .toEqual({ leftDelta: 0, width: 512 });
  await expect
    .poll(() =>
      summaryComposer.evaluate((node) => ({
        composer: getComputedStyle(node).backgroundColor,
        page: getComputedStyle(document.body).backgroundColor,
        textarea: getComputedStyle(node.querySelector("textarea") ?? node)
          .backgroundColor,
      })),
    )
    .toEqual({
      composer: "rgb(247, 245, 240)",
      page: "rgb(247, 245, 240)",
      textarea: "rgb(255, 255, 255)",
    });
  await summaryComposer.getByRole("button", { name: "Cancel" }).click();
  await feedback.click();

  for (const componentName of ["FileTree", "FileTreeDiff"] as const) {
    const component = page
      .locator(`[data-component='${componentName}']`)
      .first();
    await expect(
      component.getByRole("button", { name: /Comment on/u }),
    ).toBeVisible();
    await expect(component.locator("[data-review-toolbar-host]")).toHaveCSS(
      "opacity",
      "1",
    );
  }

  const dataTable = page.locator("[data-block-kind='data-table']").first();
  const scrollContainer = dataTable.locator("[data-table-scroll-container]");
  const before = await scrollContainer.evaluate(
    (element) => element.scrollWidth,
  );
  await expect(
    scrollContainer.locator("button[data-review-block-button]"),
  ).toHaveCount(0);
  const tableComment = dataTable.locator(".review-table-comment");
  await expect(tableComment).toHaveCount(1);
  await expect(tableComment).toBeVisible();
  await expect(scrollContainer.locator(".review-table-comment")).toHaveCount(0);
  await expect(dataTable.locator("[data-review-toolbar-host]")).toHaveCSS(
    "opacity",
    "1",
  );
  await page.locator("[data-block-kind='table-cell']").first().hover();
  await expect(tableComment).toBeVisible();
  await tableComment.hover();
  await expect(tableComment).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(tableComment).toHaveCSS("border-color", "rgba(0, 0, 0, 0)");
  await expect
    .poll(() =>
      tableComment.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === node || (hit !== null && node.contains(hit));
      }),
    )
    .toBe(true);
  await tableComment.click();
  const tableComposer = page.getByRole("dialog", { name: /Comment on/u });
  await expect(tableComposer).toBeVisible();
  await expect(tableComposer).toHaveAttribute("aria-label", / · Table$/u);
  await tableComposer
    .getByLabel("Add a comment")
    .fill("Keep the table contract explicit.");
  const tableSubmitRightAway = tableComposer.getByRole("switch", {
    name: "Submit right away",
  });
  if ((await tableSubmitRightAway.getAttribute("aria-checked")) === "true") {
    await tableSubmitRightAway.click();
  }
  await tableComposer.getByRole("button", { name: "Add Comment" }).click();
  await page.getByRole("button", { name: /Feedback/ }).click();
  const tableRail = page.getByRole("complementary", { name: "Feedback" });
  await tableRail
    .getByRole("button", { name: /Expand staged comment:/u })
    .click();
  await expect(tableRail.locator(".review-staged-target")).toHaveText(
    /^3\.1 · (?!.*Table).+$/u,
  );
  const tableTarget = page.locator("[data-block-kind='data-table']").first();
  await tableRail.locator(".review-staged-card").hover();
  await expect(tableTarget).toHaveAttribute(
    "data-review-comment-associated",
    "",
  );
  await tableTarget.hover();
  await expect(tableRail.locator(".review-staged-card")).toHaveAttribute(
    "data-review-associated",
    "true",
  );
  await expect(
    tableRail
      .getByRole("button", { name: "Edit staged comment" })
      .locator("svg"),
  ).toHaveAttribute("stroke-width", "1.8");
  await expect(tableRail.locator(".review-staged-meta > span")).toHaveCount(0);
  await expect
    .poll(() =>
      tableRail
        .locator(".review-feedback-panel")
        .evaluate((node) => node.scrollWidth - node.clientWidth),
    )
    .toBe(0);
  expect(await scrollContainer.evaluate((element) => element.scrollWidth)).toBe(
    before,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneButton = dataTable.locator(".review-table-comment");
  await expect
    .poll(() =>
      phoneButton.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
    )
    .toBe(true);
});

test("should keep Feedback closed when QuickSummary submits offline", async ({
  page,
  allComponentsViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(allComponentsViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const quickSummary = page.locator("[data-quick-summary]");
  await quickSummary
    .getByRole("button", { name: "Comment on quick summary" })
    .click();
  const composer = page.getByRole("dialog", {
    name: "Comment on Quick summary",
  });
  await composer.getByLabel("Add a comment").fill("Keep this summary concise.");
  await composer.getByRole("button", { name: "Submit Now" }).click();

  await expect(
    page.getByRole("complementary", { name: "Feedback" }),
  ).not.toBeVisible();
  const contextualComment = page.locator(
    "[data-review-thread-side] .review-staged-card",
  );
  await expect(contextualComment).toBeVisible();
  await expect(contextualComment).toContainText("Keep this summary concise.");

  await page.evaluate(() => {
    const header = document.querySelector("body > header");
    const card = document.querySelector(
      "[data-review-thread-side] .review-staged-card",
    );
    if (!(header instanceof HTMLElement) || !(card instanceof HTMLElement)) {
      return;
    }
    window.scrollBy(
      0,
      card.getBoundingClientRect().top -
        header.getBoundingClientRect().height / 2,
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const header = document.querySelector("body > header");
        const card = document.querySelector(
          "[data-review-thread-side] .review-staged-card",
        );
        if (
          !(header instanceof HTMLElement) ||
          !(card instanceof HTMLElement)
        ) {
          return false;
        }
        const headerRect = header.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const hit = document.elementFromPoint(
          cardRect.left + 12,
          Math.max(
            headerRect.top + 8,
            Math.min(headerRect.bottom - 8, cardRect.top + 12),
          ),
        );
        const overlapsHeader =
          cardRect.top < headerRect.bottom && cardRect.bottom > headerRect.top;
        return overlapsHeader && hit !== null && header.contains(hit);
      }),
    )
    .toBe(true);
});
