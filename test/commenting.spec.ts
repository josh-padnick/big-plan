// Critical browser journey for the React thin thread kernel over a static
// rendered document: block composition, durable browser drafts, literal text,
// keyboard focus, and both appearance themes.

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
  await note.fill("<strong>Literal reviewer text</strong>");
  await note.press("Control+Enter");

  const kernel = page.getByRole("complementary", { name: "Review notes" });
  await expect(kernel).toBeVisible();
  await expect(kernel).toContainText("<strong>Literal reviewer text</strong>");
  await expect(kernel.locator("strong")).toHaveCount(0);
  await expect(kernel).toContainText("1 staged");
  await expect(block).toHaveAttribute("data-review-note-count", "1");

  await page.reload();
  await notesToggle.click();
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
