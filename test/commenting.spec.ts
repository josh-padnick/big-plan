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
  await page.waitForTimeout(1_100);
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
  await expect(cancel).toHaveCSS("height", "24px");
  await expect(cancel).toHaveCSS("padding-left", "12px");
  await expect(cancel).toHaveCSS("border-top-width", "1px");
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveCSS("height", "24px");
  await expect(submit).toHaveCSS("padding-left", "12px");
  await expect(submit).toHaveCSS("background-color", "rgb(239, 236, 227)");
  await expect(submit).toHaveCSS("color", "rgb(111, 105, 92)");
  await expect(submit).toHaveCSS("border-top-color", "rgb(226, 221, 209)");
  await expect(submit).toHaveCSS("opacity", "1");
  await expect(
    dialog.getByRole("switch", { name: "Submit right away" }).locator("span"),
  ).toHaveCSS("border-top-width", "1px");
  await input.fill(
    "Keep `leaseOwner` explicit. <strong>Literal reviewer text</strong>",
  );
  await dialog.getByRole("switch", { name: "Submit right away" }).click();
  await dialog.getByRole("button", { name: "Submit Now" }).click();

  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(rail).toBeVisible();
  const staged = rail.locator(".review-staged-card").first();
  await expect(staged).toContainText("STAGED");
  await expect(staged.locator("code")).toHaveText("leaseOwner");
  await expect(staged).toContainText("<strong>Literal reviewer text</strong>");
  await expect(staged.locator("strong")).toHaveCount(0);
  await expect(staged).toHaveCSS("padding", "8px");
  await expect(staged.getByText("STAGED")).toHaveCSS(
    "color",
    "rgb(22, 101, 52)",
  );
  await expect(staged.getByText("STAGED")).toHaveCSS("font-size", "11px");
  await expect(staged.getByText("STAGED")).toHaveCSS("height", "18.5px");
  await expect(
    staged.locator(".review-staged-actions button").first(),
  ).toHaveCSS("width", "24px");
  await expect(
    staged.locator(".review-staged-actions button").first().locator("svg"),
  ).toHaveCSS("width", "14px");
  const stagedSubmit = staged.getByRole("button", { name: "Submit Now" });
  await expect(stagedSubmit).toHaveCSS("height", "24px");
  await expect(stagedSubmit).toHaveCSS("padding-left", "12px");
  await expect(stagedSubmit).toHaveCSS("font-size", "12px");
  await expect(stagedSubmit).toHaveCSS("font-weight", "600");
  await expect(
    rail.getByRole("tab", { name: "Comments" }).locator("svg"),
  ).toHaveCSS("width", "14px");
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
  await expect(sendAll).toHaveCSS("height", "36px");
  await expect(sendAll).toHaveCSS("font-size", "12px");
  await expect(sendAll).toHaveCSS("font-weight", "600");
  await expect
    .poll(() =>
      rail
        .locator(".review-feedback-panel")
        .evaluate((node) => node.scrollWidth - node.clientWidth),
    )
    .toBe(0);
  await expect(page.locator("[data-review-thread-side]")).toHaveCount(0);

  await rail.getByRole("button", { name: "Close feedback" }).click();
  const threadHost = page.locator("[data-review-thread-side]");
  await expect(threadHost).toHaveCount(1);
  const thread = threadHost.locator(
    ".review-staged-card[data-review-surface='thread']",
  );
  await expect(thread).toContainText("Just now");
  await expect(thread).toHaveCSS("background-color", "rgb(247, 245, 240)");
  await expect
    .poll(() =>
      threadHost.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return document.documentElement.clientWidth - rect.right;
      }),
    )
    .toBeGreaterThanOrEqual(23);
  const threadTop = await threadHost.evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  await page.evaluate(() => window.scrollBy(0, 200));
  await expect
    .poll(() => threadHost.evaluate((node) => node.getBoundingClientRect().top))
    .toBeLessThanOrEqual(threadTop - 190);
  await page.evaluate(() => window.scrollTo(0, 0));
  await thread.getByRole("button", { name: "Minimize staged comment" }).click();
  const minimizedThread = page.locator(
    "[data-review-thread-side] .review-staged-collapsed-thread",
  );
  await expect(minimizedThread).toBeVisible();
  await expect(minimizedThread.locator("svg")).toHaveCount(0);
  await expect(minimizedThread).toHaveCSS("font-size", "12px");
  await expect(minimizedThread).toHaveCSS(
    "background-color",
    "rgb(254, 253, 251)",
  );
  await page.getByRole("button", { name: /Feedback/ }).click();
  await expect(rail.locator(".review-staged-collapsed-rail")).toHaveCount(0);
  await expect(rail.locator(".review-staged-card")).toHaveCount(1);
  await rail.getByRole("button", { name: "Close feedback" }).click();
  await minimizedThread.click();
  await expect(thread).toBeVisible();

  await page.reload();
  const feedback = page.getByRole("button", { name: /Feedback/ });
  await feedback.click();
  await expect(rail.locator("code")).toHaveText("leaseOwner");
  await expect(rail.getByRole("tab", { name: "Comments" })).toBeVisible();
  await rail.getByRole("tab", { name: "Chat" }).click();
  await expect(rail).toContainText("Plan-wide chat");
  await rail.getByRole("tab", { name: "Agent" }).click();
  await expect(rail).toContainText("No agent work in progress");

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
  await dialog.getByRole("button", { name: "Submit Now" }).click();

  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(rail.locator("code")).toHaveText("leaseOwner");
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
  await expect(
    deleteDialog.getByRole("button", { name: "Cancel" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deleteDialog).not.toBeVisible();
  await expect(rail.locator(".review-staged-card")).toHaveCount(1);
  await deleteComment.click();
  await deleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect(deleteDialog).not.toBeVisible();
  await expect(rail.locator(".review-staged-card")).toHaveCount(0);
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
  await expect(
    quickSummary.getByRole("button", { name: "Comment on quick summary" }),
  ).toBeVisible();
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
  await quickSummary
    .getByRole("button", { name: "Comment on quick summary" })
    .click();
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
    .toBeGreaterThanOrEqual(0);
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
  await tableComposer.getByRole("button", { name: "Submit Now" }).click();
  const tableRail = page.getByRole("complementary", { name: "Feedback" });
  await expect(tableRail.locator(".review-staged-target")).toHaveText(
    /^3\.1 · .* · Table$/u,
  );
  await expect(
    tableRail.locator(".review-staged-card svg").first(),
  ).toHaveAttribute("stroke-width", "1.5");
  await expect(tableRail.locator(".review-staged-meta > span")).toHaveCSS(
    "font-weight",
    "700",
  );
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
