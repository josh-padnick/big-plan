// Critical browser journeys for the React commenting chrome over a static
// rendered document: slide and selection composition, durable staged cards,
// precision component targets, the Feedback rail, and both appearance themes.

import { expect, test } from "./fixtures";

test("should stage and restore a slide comment through the legacy chrome", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const slide = page.locator("[data-slide]").first();
  await slide.hover();
  const comment = slide.getByRole("button", { name: "Comment on slide" });
  await expect(comment).toBeVisible();

  const tooltip = comment.getByRole("tooltip");
  await expect(tooltip).not.toBeVisible();
  await comment.hover();
  await page.waitForTimeout(1_100);
  await expect(tooltip).toBeVisible();

  await comment.click();
  await expect(slide).toHaveAttribute("data-review-slide-selected", "");
  const dialog = page.getByRole("dialog", { name: /Comment on/ });
  const input = dialog.getByLabel("Add a comment");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute(
    "placeholder",
    "What should the agent change here?",
  );
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
  await expect(page.locator("[data-review-thread-for]")).toHaveCount(1);

  await staged.getByRole("button", { name: "Collapse staged comment" }).click();
  await expect(rail.locator(".review-staged-collapsed")).toBeVisible();
  await rail.locator(".review-staged-collapsed").click();
  await expect(staged).toBeVisible();

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
});

test("should expose precision targets without adding table scroll", async ({
  page,
  allComponentsViewerUrl,
}) => {
  await page.goto(allComponentsViewerUrl);

  await expect(
    page.locator("[data-block-kind='table-cell']").first(),
  ).toBeVisible();
  await expect(
    page.locator("[data-block-kind='table-column']").first(),
  ).toBeVisible();
  await expect(
    page.locator("[data-block-kind='quick-summary-facet']"),
  ).toHaveCount(3);

  const scrollContainer = page.locator("[data-table-scroll-container]").first();
  const before = await scrollContainer.evaluate(
    (element) => element.scrollWidth,
  );
  for (const kind of ["table-cell", "table-column"] as const) {
    const target = page.locator(`[data-block-kind='${kind}']`).first();
    await target.hover();
    const button = target.locator("button[data-review-block-button]");
    await expect(button).toBeVisible();
    await expect
      .poll(() =>
        button.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit === node || node.contains(hit);
        }),
      )
      .toBe(true);
  }
  expect(await scrollContainer.evaluate((element) => element.scrollWidth)).toBe(
    before,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneTarget = page.locator("[data-block-kind='table-cell']").first();
  await phoneTarget.hover();
  const phoneButton = phoneTarget.locator("button[data-review-block-button]");
  await expect
    .poll(() =>
      phoneButton.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width >= 44 && rect.height >= 44;
      }),
    )
    .toBe(true);
});
