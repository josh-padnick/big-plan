// Critical browser journeys for the React commenting chrome over a static
// rendered document: slide and selection composition, durable staged cards,
// precision component targets, the Feedback rail, and both appearance themes.

import { expect, test } from "./fixtures";

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

  const tooltip = comment.getByRole("tooltip");
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
  await expect(dialog).toHaveCSS("position", "fixed");
  const composerTop = await dialog.evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  await page.evaluate(() => window.scrollBy(0, 160));
  await expect
    .poll(() => dialog.evaluate((node) => node.getBoundingClientRect().top))
    .toBe(composerTop);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await input.fill(
    "Keep `leaseOwner` explicit. <strong>Literal reviewer text</strong>",
  );
  const shortcutTooltip = dialog.getByRole("tooltip");
  await submit.hover();
  await expect(shortcutTooltip).not.toBeVisible();
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
  await expect(staged.locator(".review-staged-target")).toHaveCSS(
    "font-size",
    "12px",
  );
  await expect(
    staged.getByRole("button", { name: "Go to comment location" }),
  ).toBeVisible();
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
  await sendAll.hover();
  await expect(sendAll).toHaveCSS("filter", "brightness(0.95)");
  await expect(sendAll).toHaveCSS(
    "transition-property",
    /background-color.*box-shadow.*filter/,
  );
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
    "rgb(164, 156, 139)",
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
  await expect(page.locator("[data-review-thread-side]")).toHaveCount(0);

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
  await expect(thread.getByRole("tooltip")).toBeVisible();
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
  const minimizedStatus = minimizedThread.getByText("STAGED");
  await expect(minimizedStatus).toHaveCSS("color", "rgb(78, 88, 145)");
  await expect(minimizedStatus).toHaveCSS("border-color", "rgb(78, 88, 145)");
  await expect(minimizedStatus).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  const minimizedDelete = minimizedThread.getByRole("button", {
    name: "Delete staged comment",
  });
  await expect(minimizedDelete.locator("svg")).toHaveCount(1);
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

test("should preserve a text selection while its compact composer is open", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const block = page.locator("[data-block-kind='paragraph']").first();
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
  await chip.click();

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
  await expect(rail.locator("code")).toHaveText("leaseOwner");
  const railCard = rail.locator(".review-staged-card").first();
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
  const selectedPoint = await block.evaluate((element) => {
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
  if (selectedPoint === null) throw new Error("Expected selected text bounds");
  await page.mouse.move(selectedPoint.x, selectedPoint.y);
  await expect(railCard).toHaveAttribute("data-review-associated", "true");
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
    await composer.getByRole("switch", { name: "Submit right away" }).click();
    await composer.getByRole("button", { name: "Add Comment" }).click();
  }

  await page.getByRole("button", { name: /Feedback 2/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(rail.locator(".review-staged-card")).toHaveCount(2);
  const deleteAll = rail.getByRole("button", {
    name: "Delete all comments",
  });
  await expect(deleteAll.locator("..")).toHaveCSS("margin-top", "12px");
  await expect(deleteAll.locator("svg")).toHaveCount(1);
  await deleteAll.click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: "Delete all comments?",
  });
  await expect(deleteDialog).toContainText(
    "This permanently removes all 2 staged comments.",
  );
  await page.keyboard.press("Escape");
  await expect(deleteDialog).not.toBeVisible();
  await expect(rail.locator(".review-staged-card")).toHaveCount(2);

  await deleteAll.click();
  await expect(deleteDialog).toBeFocused();
  await deleteDialog.dispatchEvent("keydown", { key: "Enter", repeat: true });
  await expect(deleteDialog).toBeVisible();
  await expect(rail.locator(".review-staged-card")).toHaveCount(2);
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
  await expect
    .poll(async () => {
      const summaryRect = await quickSummary.boundingBox();
      const buttonRect = await quickSummaryComment.boundingBox();
      return Math.round(
        (summaryRect?.x ?? 0) -
          ((buttonRect?.x ?? 0) + (buttonRect?.width ?? 0)),
      );
    })
    .toBe(11);
  await expect(
    quickSummary.locator("button[data-review-block-button]"),
  ).toHaveCount(0);
  await expect(
    quickSummary.locator("[data-block-kind='quick-summary-facet']"),
  ).toHaveCount(3);
  for (const kind of ["callout", "decision-analysis", "file-tree"] as const) {
    const component = page.locator(`[data-block-kind='${kind}']`).first();
    await expect(component.locator(".review-toolbar-comment")).toBeVisible();
    await expect(
      component.locator("button[data-review-block-button]"),
    ).toHaveCount(0);
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
        page: getComputedStyle(document.documentElement)
          .getPropertyValue("--bg")
          .trim(),
        textarea: getComputedStyle(node.querySelector("textarea") ?? node)
          .backgroundColor,
      })),
    )
    .toEqual({
      composer: "rgb(247, 245, 240)",
      page: "#f7f5f0",
      textarea: "rgb(255, 255, 255)",
    });
  await summaryComposer.getByRole("button", { name: "Cancel" }).click();
  await feedback.click();

  const scrollContainer = page
    .locator("[data-block-kind='data-table']")
    .first()
    .locator("[data-table-scroll-container]");
  const before = await scrollContainer.evaluate(
    (element) => element.scrollWidth,
  );
  await expect(
    scrollContainer.locator("button[data-review-block-button]"),
  ).toHaveCount(0);
  const tableComment = scrollContainer.locator(".review-table-comment");
  await expect(tableComment).toHaveCount(1);
  await expect(tableComment).toBeVisible();
  await expect(
    scrollContainer.locator(
      "[data-review-table-host][data-review-anchor-host]",
    ),
  ).toHaveCount(0);
  await expect(scrollContainer.locator("[data-review-table-host]")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
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
  const phoneButton = scrollContainer.locator(".review-table-comment");
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
