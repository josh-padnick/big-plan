// Critical browser journey for the React thin thread kernel over a static
// rendered document: block and selection composition, durable browser drafts,
// safe Markdown, keyboard focus, and both appearance themes.

import { expect, test } from "./fixtures";

test("should stage and restore a block note in the React thread kernel", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const notesToggle = page.getByRole("button", {
    name: /Review notes/,
  });

  const block = page.locator("[data-block-kind='paragraph']").first();
  await block.hover();
  const comment = block
    .getByRole("button", {
      name: "Add note",
    })
    .first();
  await expect(comment).toBeVisible();
  await comment.click();

  const dialog = page.getByRole("dialog", { name: /Comment on/ });
  await expect(dialog).toBeVisible();
  const note = dialog.getByLabel("Your note");
  await expect(note).toBeFocused();
  await note.fill(
    "Keep `leaseOwner` explicit. <strong>Literal reviewer text</strong>",
  );
  await expect(dialog).toContainText("Markdown supported");
  await expect(dialog.getByLabel("Comment preview")).toHaveCount(0);
  await note.press("Control+Enter");

  const kernel = page.getByRole("complementary", { name: "Review notes" });
  await expect(kernel).toBeVisible();
  await expect(kernel.locator("code")).toHaveText("leaseOwner");
  await expect(kernel).toContainText("<strong>Literal reviewer text</strong>");
  await expect(kernel.locator("strong")).toHaveCount(0);
  await expect(kernel).toContainText("1 staged");
  await expect(block).toHaveAttribute("data-review-note-count", "1");

  await page.reload();
  await notesToggle.click();
  await expect(kernel.locator("code")).toHaveText("leaseOwner");
  await expect(kernel).toContainText("<strong>Literal reviewer text</strong>");
  await kernel.getByRole("button", { name: "Close review notes" }).click();
  await expect(notesToggle).toBeVisible();

  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (nextTheme) =>
        document.documentElement.setAttribute("data-theme", nextTheme),
      theme,
    );
    await page.keyboard.press("Tab");
    await notesToggle.focus();
    await expect
      .poll(() =>
        notesToggle.evaluate((node) => ({
          focused: node.matches(":focus-visible"),
          outline: getComputedStyle(node).outlineStyle,
        })),
      )
      .toEqual({ focused: true, outline: "solid" });
  }
});

test("should turn an authored-text selection into a durable targeted note", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const block = page.locator("[data-block-kind='paragraph']").first();
  const selected = await block.evaluate((element) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) {
      return "";
    }
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

  const selectionButton = page.getByRole("button", {
    name: "Comment on selected text",
  });
  await expect(selectionButton).toBeVisible();
  await expect
    .poll(() =>
      selectionButton.evaluate((button) => {
        const selection = window.getSelection();
        if (selection === null || selection.rangeCount !== 1) {
          return false;
        }
        const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return buttonRect.bottom <= selectionRect.top;
      }),
    )
    .toBe(true);
  await selectionButton.click();

  const dialog = page.getByRole("dialog", {
    name: /Comment on Selected text in/,
  });
  await expect(dialog).toContainText(selected);
  await dialog.getByLabel("Your note").fill("Clarify `leaseOwner` here.");
  await dialog.getByRole("button", { name: "Add note" }).click();

  const kernel = page.getByRole("complementary", { name: "Review notes" });
  await expect(kernel).toContainText("Selected text in");
  await expect(kernel.locator("code")).toHaveText("leaseOwner");
  await expect(block).toHaveAttribute("data-review-note-count", "1");

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

test("should expose table cells, columns, and QuickSummary facets as comment targets", async ({
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

  for (const kind of ["table-cell", "table-column"] as const) {
    const targets = page.locator(`[data-block-kind='${kind}']`);
    const target = kind === "table-column" ? targets.last() : targets.first();
    await target.hover();
    const button = target.getByRole("button", { name: "Add note" });
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
    if (kind === "table-column") {
      await expect
        .poll(async () => {
          const targetBox = await target.boundingBox();
          const buttonBox = await button.boundingBox();
          return targetBox === null || buttonBox === null
            ? null
            : Math.abs(buttonBox.x - targetBox.x);
        })
        .toBeLessThanOrEqual(1);
      await expect
        .poll(() =>
          target
            .locator("xpath=ancestor::*[@data-block-id]")
            .evaluateAll((ancestors) =>
              ancestors.every((ancestor) => {
                const host = Array.from(ancestor.children).find((child) =>
                  child.hasAttribute("data-review-anchor-host"),
                );
                return (
                  host === undefined ||
                  (getComputedStyle(host).opacity === "0" &&
                    getComputedStyle(host).pointerEvents === "none")
                );
              }),
            ),
        )
        .toBe(true);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneTarget = page.locator("[data-block-kind='table-cell']").first();
  await phoneTarget.hover();
  const phoneButton = phoneTarget.getByRole("button", { name: "Add note" });
  await expect
    .poll(() =>
      phoneButton.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width >= 44 && rect.height >= 44;
      }),
    )
    .toBe(true);
});
